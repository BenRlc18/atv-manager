'use strict';
// Tests du mode « code TV » de Tailscale (demande, validation par l'administrateur, rattachement) et de la
// notification Gotify, avec une fausse API Tailscale, un faux Gotify (fetch remplacé) et une fausse TV (adb remplacé).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atvm-tsc-'));
process.env.DATA_DIR = TMP; // store.js ne doit jamais toucher aux vraies données
delete process.env.GOTIFY_URL;
delete process.env.GOTIFY_TOKEN;

const store = require('../server/lib/store');
const A = require('../server/lib/adb');
const D = require('../server/lib/devices');
const TS = require('../server/lib/tailscale');
const TSC = require('../server/lib/tscodes');
const NT = require('../server/lib/notify');

const SECRET = 'tskey-client-kTEST-secretvalue';
const GOTIFY_TOKEN = 'AgotifySECRETtoken';
const ALICE = { id: 'u-alice', username: 'alice', name: 'Alice', role: 'user' };
const BOB = { id: 'u-bob', username: 'bob', name: 'Bob', role: 'user' };
const ADMIN = { id: 'u-admin', username: 'admin', name: 'Admin', role: 'admin' };
const SAFE_POLICY = { tagOwners: { 'tag:tvbox': ['autogroup:admin'] }, acls: [{ action: 'accept', src: ['autogroup:member'], dst: ['tag:tvbox:5555'] }] };

// --- Fausse API Tailscale + faux Gotify
function fakeApi() {
  const api = { calls: [], devices: [], policy: SAFE_POLICY, tagBodies: [], keyExpiry: [], tagStatus: 200, gotify: [], gotifyStatus: 200 };
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    if (u.host === 'gotify.test') {
      api.gotify.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return json(api.gotifyStatus, { id: 1 });
    }
    const p = u.pathname.replace('/api/v2', '');
    api.calls.push(`${init.method || 'GET'} ${p}${u.search}`);
    if (p === '/oauth/token') return json(200, { access_token: 'tok1', expires_in: 3600 });
    if (init.headers.Authorization !== 'Bearer tok1') return json(401, { message: 'unauthorized' });
    if (p === '/tailnet/-/devices') return json(200, { devices: api.devices });
    if (p === '/tailnet/-/acl') return json(200, api.policy);
    let m = p.match(/^\/device\/([^/]+)\/tags$/);
    if (m) {
      if (api.tagStatus !== 200) return json(api.tagStatus, { message: 'tag not permitted for this client' });
      api.tagBodies.push({ id: m[1], body: JSON.parse(init.body) });
      const d = api.devices.find((x) => x.id === m[1]);
      if (d) d.tags = JSON.parse(init.body).tags;
      return json(200, {});
    }
    m = p.match(/^\/device\/([^/]+)\/key$/);
    if (m) { api.keyExpiry.push({ id: m[1], body: JSON.parse(init.body) }); return json(200, {}); }
    return json(404, { message: 'not found' });
  };
  return api;
}

// --- Fausse TV
const tv = { states: {}, connects: [], disconnects: [] };
A.connect = async (target) => { tv.connects.push(target); return tv.states[target] || 'absent'; };
A.disconnect = async (target) => { tv.disconnects.push(target); return { ok: true, out: '', err: '' }; };
D.identify = async (target) => (tv.states[target] === 'device' ? { id: `SER-${target}`, brand: 'Amazon', model: 'AFTKA', deviceName: 'Fire TV', android: '11', isTv: true } : null);

function reset(settings = {}) {
  for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { recursive: true, force: true });
  store.saveSettings({ tailscale: { enabled: true, oauthClientId: 'kTEST', oauthClientSecret: SECRET, tag: 'tag:tvbox' }, ...settings });
  TS._reset();
  TSC._reset();
  tv.states = {}; tv.connects = []; tv.disconnects = [];
}

const tsDevice = (id, ip, createdAt, extra = {}) => ({ id, addresses: [ip, 'fd7a::1'], created: new Date(createdAt).toISOString(), os: 'android', hostname: `tv-${id}`, name: `tv-${id}.tail1234.ts.net`, ...extra });

test.after(() => { TS._reset(); TSC._reset(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('demande : code normalisé et validé, enregistrée en attente de l\'administrateur', async () => {
  reset();
  fakeApi();
  assert.strictEqual(TSC.normalize(' abcd-ef 12 34 '), 'ABCDEF1234');
  for (const bad of ['', 'AB12', 'A'.repeat(25), 'ABCDEF12!']) assert.throws(() => TSC.normalize(bad), (e) => e.code === 400);
  await assert.rejects(TSC.create(ALICE, 'abc'), (e) => e.code === 400);
  const r = await TSC.create(ALICE, 'abcd-efgh-12');
  assert.strictEqual(r.status, 'waiting-admin');
  assert.match(r.id, /^[0-9a-f]{16}$/);
  const saved = store.read('tscodes.json', []);
  assert.strictEqual(saved.length, 1);
  assert.deepStrictEqual({ ...saved[0], createdAt: 0 }, { id: r.id, userId: 'u-alice', userName: 'Alice', code: 'ABCDEFGH12', createdAt: 0, status: 'waiting-admin' });
  // Listes : la sienne pour l'utilisateur, toutes pour l'administrateur (avec le nom)
  assert.deepStrictEqual((await TSC.listFor(ALICE)).map((x) => [x.code, x.status, x.userName]), [['ABCDEFGH12', 'waiting-admin', undefined]]);
  assert.deepStrictEqual(await TSC.listFor(BOB), []);
  assert.strictEqual((await TSC.listFor(ADMIN))[0].userName, 'Alice');
  assert.strictEqual(TSC.waitingCount(), 1);
});

test('demande refusée : libre-service indisponible ou politique qui n\'isole pas les TV (409)', async () => {
  reset();
  const api = fakeApi();
  store.saveSettings({ tailscale: { enabled: false, oauthClientId: 'kTEST', oauthClientSecret: SECRET } });
  await assert.rejects(TSC.create(ALICE, 'ABCDEF1234'), (e) => e.code === 409);
  reset();
  api.policy = { tagOwners: {} };
  await assert.rejects(TSC.create(ALICE, 'ABCDEF1234'), (e) => e.code === 409 && /n'isolent pas les TV/.test(e.message));
  assert.deepStrictEqual(store.read('tscodes.json', []), []);
});

test('limite : 3 demandes par utilisateur et par heure ; expiration après 2 h', async () => {
  reset();
  fakeApi();
  for (let i = 0; i < 3; i++) await TSC.create(ALICE, `ABCDEF00${i}`);
  await assert.rejects(TSC.create(ALICE, 'ABCDEF0099'), (e) => e.code === 429);
  await TSC.create(BOB, 'BOBBOB1234');
  const list = store.read('tscodes.json', []);
  list[0].createdAt -= 2 * 3600e3 + 1000; // plus de 2 h : expirée, et ne compte plus dans la limite
  store.write('tscodes.json', list);
  await TSC.create(ALICE, 'ABCDEF0100');
  const mine = await TSC.listFor(ALICE);
  assert.strictEqual(mine.find((x) => x.code === 'ABCDEF000').status, 'expired');
  assert.strictEqual(TSC.waitingCount(), 4);
  await assert.rejects(TSC.candidates(list[0].id), (e) => e.code === 409);
});

test('candidats : non étiquetés, TV, récents, inconnus', async () => {
  reset();
  const api = fakeApi();
  const { id } = await TSC.create(ALICE, 'ABCDEF1234');
  const now = Date.now();
  store.upsertDevice({ id: 'SER-known', host: '100.64.0.5', port: 5555 });
  api.devices.push(
    tsDevice('ok', '100.64.0.1', now + 1000),
    tsDevice('fire', '100.64.0.2', now - 60e3, { os: 'linux', hostname: 'AFTKA-salon' }), // 1 min avant : tolérance
    tsDevice('tagged', '100.64.0.3', now + 1000, { tags: ['tag:tvbox'] }),
    tsDevice('old', '100.64.0.4', now - 10 * 60e3),
    tsDevice('known', '100.64.0.5', now + 1000),
    tsDevice('pc', '100.64.0.6', now + 1000, { os: 'windows', hostname: 'bureau', name: 'bureau.tail1234.ts.net' }),
  );
  const c = await TSC.candidates(id);
  assert.deepStrictEqual(c.map((x) => x.tsId).sort(), ['fire', 'ok']);
  assert.deepStrictEqual(Object.keys(c[0]).sort(), ['addresses', 'created', 'hostname', 'name', 'os', 'tsId']);
  assert.ok(api.calls.includes('GET /tailnet/-/devices?fields=all'));
  await assert.rejects(TSC.candidates('inconnu'), (e) => e.code === 404);
});

test('rattachement : appareil hors candidats refusé, rien n\'est modifié', async () => {
  reset();
  const api = fakeApi();
  const { id } = await TSC.create(ALICE, 'ABCDEF1234');
  api.devices.push(tsDevice('old', '100.64.0.4', Date.now() - 3600e3), tsDevice('tagged', '100.64.0.3', Date.now() + 1000, { tags: ['tag:other'] }));
  for (const tsId of ['old', 'tagged', 'absent', '']) await assert.rejects(TSC.attach(id, tsId), (e) => [400, 409].includes(e.code));
  assert.deepStrictEqual(api.tagBodies, []);
  assert.deepStrictEqual(api.keyExpiry, []);
  assert.deepStrictEqual(tv.connects, []);
  assert.strictEqual((await TSC.listFor(ALICE))[0].status, 'waiting-admin');
});

test('rattachement : étiquette, expiration désactivée, ADB puis TV ajoutée pour le demandeur', async () => {
  reset();
  const api = fakeApi();
  const { id } = await TSC.create(ALICE, 'ABCDEF1234');
  api.devices.push(tsDevice('7001', '100.64.0.70', Date.now() + 1000));
  tv.states['100.64.0.70:5555'] = 'unauthorized';
  const r = await TSC.attach(id, '7001');
  assert.strictEqual(r.status, 'waiting-auth');
  assert.deepStrictEqual(api.tagBodies, [{ id: '7001', body: { tags: ['tag:tvbox'] } }]);
  assert.deepStrictEqual(api.keyExpiry, [{ id: '7001', body: { keyExpiryDisabled: true } }]);
  assert.deepStrictEqual(tv.connects, ['100.64.0.70:5555']);
  assert.strictEqual(TSC.waitingCount(), 0);
  // Déjà traitée : ni second rattachement ni refus
  await assert.rejects(TSC.attach(id, '7001'), (e) => e.code === 409);
  assert.throws(() => TSC.reject(id), (e) => e.code === 409);
  // La TV accepte la fenêtre : la relance suivante l'ajoute pour Alice
  tv.states['100.64.0.70:5555'] = 'device';
  await TSC.sync({ force: true });
  const mine = await TSC.listFor(ALICE);
  assert.strictEqual(mine[0].status, 'done');
  assert.strictEqual(mine[0].deviceId, 'SER-100.64.0.70:5555');
  const dev = store.devices()['SER-100.64.0.70:5555'];
  assert.deepStrictEqual(dev.users, ['u-alice']);
  assert.strictEqual(dev.remote, true);
  assert.strictEqual(dev.tsTagged, true);
  assert.strictEqual(dev.host, '100.64.0.70');
  assert.strictEqual(dev.tsName, 'tv-7001');
});

test('rattachement : TV directement autorisée ; relance par le propriétaire ou l\'administrateur seulement', async () => {
  reset();
  const api = fakeApi();
  const a = await TSC.create(ALICE, 'ABCDEF1234');
  await assert.rejects(TSC.prompt(a.id, ALICE), (e) => e.code === 409); // pas encore validée
  api.devices.push(tsDevice('8001', '100.64.0.80', Date.now() + 1000));
  tv.states['100.64.0.80:5555'] = 'offline';
  assert.strictEqual((await TSC.attach(a.id, '8001')).status, 'offline');
  await assert.rejects(TSC.prompt(a.id, BOB), (e) => e.code === 404);
  tv.states['100.64.0.80:5555'] = 'unauthorized';
  assert.strictEqual((await TSC.prompt(a.id, ALICE)).status, 'waiting-auth');
  assert.ok(tv.disconnects.includes('100.64.0.80:5555'));
  tv.states['100.64.0.80:5555'] = 'device';
  const r = await TSC.prompt(a.id, ADMIN);
  assert.strictEqual(r.status, 'done');
  assert.deepStrictEqual(store.devices()['SER-100.64.0.80:5555'].users, ['u-alice']);
});

test('rattachement : étiquette refusée par Tailscale, message clair et demande toujours en attente', async () => {
  reset();
  const api = fakeApi();
  const { id } = await TSC.create(ALICE, 'ABCDEF1234');
  api.devices.push(tsDevice('9001', '100.64.0.90', Date.now() + 1000));
  api.tagStatus = 403;
  await assert.rejects(TSC.attach(id, '9001'), (e) => e.code === 502 && /tag:tvbox/.test(e.message) && /tagOwners/.test(e.message));
  api.tagStatus = 400;
  await assert.rejects(TSC.attach(id, '9001'), (e) => e.code === 502 && /client OAuth/.test(e.message));
  assert.deepStrictEqual(api.keyExpiry, []);
  assert.deepStrictEqual(tv.connects, []);
  assert.strictEqual((await TSC.listFor(ADMIN))[0].status, 'waiting-admin');
});

test('refus par l\'administrateur', async () => {
  reset();
  fakeApi();
  const { id } = await TSC.create(ALICE, 'ABCDEF1234');
  assert.deepStrictEqual(TSC.reject(id), { status: 'rejected' });
  assert.strictEqual((await TSC.listFor(ALICE))[0].status, 'rejected');
  assert.strictEqual(TSC.waitingCount(), 0);
  await assert.rejects(TSC.attach(id, 'x'), (e) => e.code === 409);
  assert.throws(() => TSC.reject('inconnu'), (e) => e.code === 404);
});

test('notification Gotify : envoyée à la demande, jeton jamais dans l\'adresse ni dans les journaux', async () => {
  reset({ notify: { gotifyUrl: 'https://gotify.test/', gotifyToken: GOTIFY_TOKEN } });
  const api = fakeApi();
  assert.deepStrictEqual(NT.publicConfig(), { hasGotify: true, gotifyUrl: 'https://gotify.test' });
  assert.ok(!JSON.stringify(NT.publicConfig()).includes(GOTIFY_TOKEN));
  await TSC.create(ALICE, 'ABCDEF1234');
  assert.strictEqual(await TSC._lastNotify(), true);
  assert.strictEqual(api.gotify.length, 1);
  const g = api.gotify[0];
  assert.strictEqual(g.url, 'https://gotify.test/message');
  assert.strictEqual(g.headers['X-Gotify-Key'], GOTIFY_TOKEN);
  assert.deepStrictEqual(g.body, { title: 'OptiTV : TV à valider', message: "Alice demande l'ajout d'une TV. Code : ABCDEF1234. Console : https://console.tailscale.com/admin/machines", priority: 6 });
  // Échec silencieux : la demande passe, le journal ne contient pas le jeton
  api.gotifyStatus = 500;
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try {
    const r = await TSC.create(ALICE, 'ABCDEF5678');
    assert.strictEqual(r.status, 'waiting-admin');
    assert.strictEqual(await TSC._lastNotify(), false);
  } finally { console.error = orig; }
  assert.ok(logs.length >= 1 && logs.every((l) => !l.includes(GOTIFY_TOKEN)));
  // Envoi de test : erreur explicite sans jeton
  api.gotifyStatus = 401;
  await assert.rejects(NT.send('t', 'm'), (e) => e.code === 502 && !e.message.includes(GOTIFY_TOKEN));
});

test('notification Gotify : absente si non configurée ; variables d\'environnement ; adresse validée', async () => {
  reset();
  const api = fakeApi();
  assert.strictEqual(NT.hasGotify(), false);
  await TSC.create(ALICE, 'ABCDEF1234');
  assert.strictEqual(await TSC._lastNotify(), false);
  assert.strictEqual(api.gotify.length, 0);
  await assert.rejects(NT.send('t', 'm'), (e) => e.code === 409);
  process.env.GOTIFY_URL = 'https://gotify.test';
  process.env.GOTIFY_TOKEN = GOTIFY_TOKEN;
  try {
    assert.strictEqual(NT.hasGotify(), true);
    await NT.send('t', 'm');
    assert.strictEqual(api.gotify.length, 1);
  } finally { delete process.env.GOTIFY_URL; delete process.env.GOTIFY_TOKEN; }
  assert.strictEqual(NT.validUrl(' https://g.example.fr/ '), 'https://g.example.fr');
  assert.strictEqual(NT.validUrl(''), '');
  for (const bad of ['ftp://x', 'pas une adresse', 'https://u:p@g.example.fr', 'https://g.example.fr/?token=x']) assert.throws(() => NT.validUrl(bad), (e) => e.code === 400);
  assert.throws(() => NT.validToken('a b'), (e) => e.code === 400);
});
