'use strict';
// Tests du libre-service Tailscale (clés pour les TV, rattachement, contrôle de la politique), avec une fausse
// API Tailscale (fetch remplacé) et une fausse TV (adb remplacé). node --test, sans dépendance.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atvm-ts-'));
process.env.DATA_DIR = TMP; // store.js ne doit jamais toucher aux vraies données
delete process.env.TAILSCALE_DOWNLOADER_CODE;

const store = require('../server/lib/store');
const A = require('../server/lib/adb');
const D = require('../server/lib/devices');
const TS = require('../server/lib/tailscale');

const SECRET = 'tskey-client-kTEST-secretvalue';
const ALICE = { id: 'u-alice', username: 'alice', role: 'user' };
const BOB = { id: 'u-bob', username: 'bob', role: 'user' };

// Politique qui isole les TV : déclarées dans tagOwners, aucune règle au départ d'une TV
const SAFE_POLICY = { tagOwners: { 'tag:tvbox': ['autogroup:admin'] }, acls: [{ action: 'accept', src: ['autogroup:member'], dst: ['tag:tvbox:5555'] }] };

// --- Fausse API Tailscale
function fakeApi() {
  const api = { calls: [], devices: [], policy: SAFE_POLICY, aclStatus: 200, keySeq: 0, tokens: 0, keyBodies: [], keyExpiry: [] };
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace('/api/v2', '');
    api.calls.push(`${init.method || 'GET'} ${p}`);
    const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    if (p === '/oauth/token') {
      const f = new URLSearchParams(init.body);
      if (f.get('client_secret') !== SECRET) return json(401, { message: 'invalid client' });
      api.tokens++;
      return json(200, { access_token: `tok${api.tokens}`, expires_in: 3600, token_type: 'Bearer' });
    }
    if (!/^Bearer tok\d+$/.test(init.headers.Authorization)) return json(401, { message: 'unauthorized' });
    if (p === '/tailnet/-/keys' && init.method === 'POST') {
      const b = JSON.parse(init.body);
      api.keyBodies.push(b);
      const now = Date.now();
      return json(200, { id: `k${++api.keySeq}`, key: `tskey-auth-k${api.keySeq}-SECRET`, created: new Date(now).toISOString(), expires: new Date(now + b.expirySeconds * 1000).toISOString() });
    }
    if (p === '/tailnet/-/devices') return json(200, { devices: api.devices });
    const m = p.match(/^\/device\/([^/]+)\/key$/);
    if (m) { api.keyExpiry.push(m[1]); return json(200, {}); }
    if (p === '/tailnet/-/acl') return api.aclStatus === 200 ? json(200, api.policy) : json(api.aclStatus, { message: 'insufficient scope' });
    return json(404, { message: 'not found' });
  };
  return api;
}

// --- Fausse TV : état ADB par adresse
const tv = { states: {}, connects: [], disconnects: [] };
A.connect = async (target) => { tv.connects.push(target); return tv.states[target] || 'absent'; };
A.disconnect = async (target) => { tv.disconnects.push(target); return { ok: true, out: '', err: '' }; };
D.identify = async (target) => (tv.states[target] === 'device' ? { id: `SER-${target}`, brand: 'Amazon', model: 'AFTKA', deviceName: 'Fire TV', android: '11', isTv: true } : null);

function reset() {
  for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { recursive: true, force: true });
  store.saveSettings({ tailscale: { enabled: true, oauthClientId: 'kTEST', oauthClientSecret: SECRET, tag: 'tag:tvbox' } });
  TS._reset();
  tv.states = {}; tv.connects = []; tv.disconnects = [];
}

const tvDevice = (id, ip, createdAt, tags = ['tag:tvbox']) => ({ id, nodeId: `n${id}`, addresses: [ip, 'fd7a::1'], created: new Date(createdAt).toISOString(), tags, hostname: `firetv-${id}` });
const pending = (user) => TS.pendingFor(user);

test.after(() => { TS._reset(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('libre-service : disponible seulement si activé avec des accès', () => {
  reset();
  assert.strictEqual(TS.selfService(), true);
  assert.strictEqual(TS.downloaderCode(), '4723177');
  store.saveSettings({ tailscale: { enabled: true } });
  assert.strictEqual(TS.selfService(), false);
  store.saveSettings({ tailscale: { enabled: false, apiKey: 'tskey-api-x' } });
  assert.strictEqual(TS.selfService(), false);
  store.saveSettings({ tailscale: { enabled: true, apiKey: 'tskey-api-x' }, tailscaleDownloaderCode: '12-34' });
  assert.strictEqual(TS.selfService(), true);
  assert.strictEqual(TS.downloaderCode(), '1234');
});

test('création de clé : usage unique, préautorisée, étiquetée, 1 h, seul keyId enregistré', async () => {
  reset();
  const api = fakeApi();
  const r = await TS.createAuthKey({ ...ALICE, username: 'élodie.o\'neil' });
  assert.match(r.key, /^tskey-auth-/);
  assert.ok(r.expiresAt > Date.now() + 3500 * 1000);
  const b = api.keyBodies[0];
  assert.deepStrictEqual(b.capabilities.devices.create, { reusable: false, ephemeral: false, preauthorized: true, tags: ['tag:tvbox'] });
  assert.strictEqual(b.expirySeconds, 3600);
  assert.strictEqual(b.description, 'atvm elodieoneil');
  const saved = fs.readFileSync(path.join(TMP, 'tskeys.json'), 'utf8');
  assert.ok(!saved.includes('tskey-auth'), 'la clé ne doit pas être stockée');
  assert.ok(!saved.includes(SECRET));
  const list = JSON.parse(saved);
  assert.strictEqual(list[0].keyId, 'k1');
  assert.strictEqual(list[0].claimedDeviceId, null);
  // Jeton OAuth réutilisé (cache)
  await TS.createAuthKey(ALICE);
  assert.strictEqual(api.tokens, 1);
});

test('limite : 3 clés par utilisateur et par heure', async () => {
  reset();
  fakeApi();
  for (let i = 0; i < 3; i++) await TS.createAuthKey(ALICE);
  await assert.rejects(TS.createAuthKey(ALICE), (e) => e.code === 429);
  await TS.createAuthKey(BOB); // les autres utilisateurs ne sont pas bloqués
  // Une clé de plus d'une heure ne compte plus
  const list = store.read('tskeys.json', []);
  list[0].createdAt -= 3601 * 1000;
  store.write('tskeys.json', list);
  await TS.createAuthKey(ALICE);
});

test('refus si le libre-service est indisponible (409)', async () => {
  reset();
  fakeApi();
  store.saveSettings({ tailscale: { enabled: false, oauthClientId: 'kTEST', oauthClientSecret: SECRET } });
  await assert.rejects(TS.createAuthKey(ALICE), (e) => e.code === 409);
});

test('rattachement non ambigu : expiration désactivée, ADB, TV ajoutée pour son utilisateur', async () => {
  reset();
  const api = fakeApi();
  await TS.createAuthKey(ALICE);
  let p = await pending(ALICE);
  assert.strictEqual(p[0].state, 'waiting-device');
  // Appareils hors sujet : non étiqueté récent, étiqueté ancien
  api.devices.push(tvDevice('old', '100.64.0.9', Date.now() - 86400e3));
  api.devices.push(tvDevice('pc', '100.64.0.8', Date.now(), []));
  api.devices.push(tvDevice('1001', '100.64.0.10', Date.now() + 1000));
  tv.states['100.64.0.10:5555'] = 'unauthorized';
  await TS.sync({ force: true });
  assert.deepStrictEqual(api.keyExpiry, ['1001']);
  assert.ok(!tv.connects.includes('100.64.0.8:5555') && !tv.connects.includes('100.64.0.9:5555'));
  p = await pending(ALICE);
  assert.strictEqual(p[0].state, 'waiting-auth');
  assert.deepStrictEqual(await pending(BOB), []);
  // La TV est autorisée : la synchronisation suivante l'ajoute
  tv.states['100.64.0.10:5555'] = 'device';
  await TS.sync({ force: true });
  p = await pending(ALICE);
  assert.strictEqual(p[0].state, 'done');
  assert.strictEqual(p[0].deviceId, 'SER-100.64.0.10:5555');
  const dev = store.devices()['SER-100.64.0.10:5555'];
  assert.deepStrictEqual(dev.users, ['u-alice']);
  assert.strictEqual(dev.remote, true);
  assert.strictEqual(dev.tsTagged, true);
  assert.strictEqual(dev.host, '100.64.0.10');
});

test('rattachement ambigu : deux clés en attente dans la même fenêtre, rien n\'est rattaché', async () => {
  reset();
  const api = fakeApi();
  await TS.createAuthKey(ALICE);
  await TS.createAuthKey(BOB);
  api.devices.push(tvDevice('2001', '100.64.0.20', Date.now() + 1000));
  tv.states['100.64.0.20:5555'] = 'device';
  const r = await TS.sync({ force: true });
  assert.strictEqual(r.claimed, 0);
  assert.strictEqual(r.ambiguous, 1);
  assert.deepStrictEqual(api.keyExpiry, []);
  assert.deepStrictEqual(tv.connects, []);
  assert.deepStrictEqual(store.devices(), {});
});

test('rattachement ambigu : deux nouveaux appareils pour une seule clé', async () => {
  reset();
  const api = fakeApi();
  await TS.createAuthKey(ALICE);
  api.devices.push(tvDevice('3001', '100.64.0.30', Date.now() + 1000), tvDevice('3002', '100.64.0.31', Date.now() + 2000));
  const r = await TS.sync({ force: true });
  assert.strictEqual(r.claimed, 0);
  assert.deepStrictEqual(api.keyExpiry, []);
});

test('clé expirée et relance de la fenêtre d\'autorisation', async () => {
  reset();
  const api = fakeApi();
  await TS.createAuthKey(ALICE);
  await TS.createAuthKey(ALICE);
  const list = store.read('tskeys.json', []);
  list[0].createdAt -= 2 * 3600e3; list[0].expiresAt -= 2 * 3600e3; // k1 : expirée depuis 1 h
  store.write('tskeys.json', list);
  api.devices.push(tvDevice('4001', '100.64.0.40', Date.now() + 1000));
  tv.states['100.64.0.40:5555'] = 'offline';
  await TS.sync({ force: true });
  const p = await pending(ALICE);
  assert.strictEqual(p.find((k) => k.keyId === 'k1').state, 'expired');
  assert.strictEqual(p.find((k) => k.keyId === 'k2').state, 'offline');
  // Relance : propriétaire seulement (ou admin)
  await assert.rejects(TS.prompt('k2', BOB), (e) => e.code === 404);
  await assert.rejects(TS.prompt('k1', ALICE), (e) => e.code === 409);
  tv.states['100.64.0.40:5555'] = 'unauthorized';
  assert.strictEqual((await TS.prompt('k2', ALICE)).state, 'waiting-auth');
  assert.ok(tv.disconnects.includes('100.64.0.40:5555'));
  tv.states['100.64.0.40:5555'] = 'device';
  const r = await TS.prompt('k2', { id: 'admin', role: 'admin' });
  assert.strictEqual(r.state, 'done');
  assert.deepStrictEqual(store.devices()['SER-100.64.0.40:5555'].users, ['u-alice']);
});

test('jeton OAuth refusé : renouvelé une fois ; secret faux : erreur claire sans secret', async () => {
  reset();
  const api = fakeApi();
  await TS.createAuthKey(ALICE);
  const orig = global.fetch;
  let first = true;
  global.fetch = async (url, init) => {
    if (first && url.endsWith('/tailnet/-/keys')) { first = false; return { ok: false, status: 401, text: async () => '{}' }; }
    return orig(url, init);
  };
  await TS.createAuthKey(ALICE);
  assert.strictEqual(api.tokens, 2);
  global.fetch = orig;
  await assert.rejects(TS.testOAuth('kTEST', 'tskey-client-wrong'), (e) => e.code === 403 && !e.message.includes('tskey'));
});

test('contrôle de la politique : étiquette déclarée et aucune règle depuis les TV', async () => {
  reset();
  const api = fakeApi();
  api.policy = {
    tagOwners: { 'tag:tvbox': ['autogroup:admin'] },
    acls: [{ action: 'accept', src: ['autogroup:member'], dst: ['tag:tvbox:5555'] }],
    grants: [{ src: ['group:admins'], dst: ['*'], ip: ['*'] }],
  };
  assert.deepStrictEqual(await TS.checkPolicy(), { ok: true, warnings: [] });
  api.policy = {
    tagOwners: {},
    acls: [{ action: 'accept', src: ['tag:tvbox'], dst: ['*:*'] }, { action: 'accept', src: ['*'], dst: ['tag:nas:443'] }],
    grants: [{ src: ['tag:tvbox'], dst: ['autogroup:internet'], ip: ['*'] }, { src: ['tag:tvbox'], dst: [] }],
  };
  const r = await TS.checkPolicy();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.warnings.length, 4);
  assert.match(r.warnings[0], /tagOwners/);
  assert.ok(api.calls.every((c) => c.startsWith('GET') || c.includes('oauth')), 'lecture seule');
});

test('HuJSON : commentaires et virgules finales', () => {
  const p = TS.parseHujson('{\n // commentaire\n "tagOwners": {"tag:tvbox": ["a//b"],}, /* bloc */ "acls": [],\n}');
  assert.deepStrictEqual(p, { tagOwners: { 'tag:tvbox': ['a//b'] }, acls: [] });
});

test('clés refusées tant que la politique n\'isole pas les TV (contrôle gardé 10 min)', async () => {
  reset();
  const api = fakeApi();
  api.policy = { tagOwners: { 'tag:tvbox': [] }, acls: [{ action: 'accept', src: ['tag:tvbox'], dst: ['*:*'] }] };
  await assert.rejects(TS.createAuthKey(ALICE), (e) => e.code === 409 && /n'isolent pas les TV/.test(e.message));
  assert.ok(!api.calls.includes('POST /tailnet/-/keys'));
  // Politique corrigée : le résultat en cache est encore utilisé…
  api.policy = SAFE_POLICY;
  await assert.rejects(TS.createAuthKey(ALICE), (e) => e.code === 409);
  assert.strictEqual(api.calls.filter((c) => c === 'GET /tailnet/-/acl').length, 1);
  // … jusqu'à un nouveau contrôle par l'administrateur (ou un changement de réglages)
  assert.strictEqual((await TS.checkPolicy()).ok, true);
  await TS.createAuthKey(ALICE);
  api.policy = { tagOwners: {} };
  TS.invalidatePolicy();
  await assert.rejects(TS.createAuthKey(ALICE), (e) => e.code === 409);
});

test('politique illisible (droit Policy File : Read manquant) : clés refusées', async () => {
  reset();
  const api = fakeApi();
  api.aclStatus = 403;
  await assert.rejects(TS.createAuthKey(ALICE), (e) => e.code === 409 && /Policy File : Read/.test(e.message));
  await assert.rejects(TS.checkPolicy(), (e) => e.code === 409 && /Policy File : Read/.test(e.message));
  assert.ok(!api.calls.includes('POST /tailnet/-/keys'));
});
