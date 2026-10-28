'use strict';
// Tests du canal « webhook » des notifications (Home Assistant par exemple) et de l'envoi multi-canal,
// avec un faux serveur HTTP local qui joue à la fois Gotify et le webhook.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atvm-hook-'));
process.env.DATA_DIR = TMP; // store.js ne doit jamais toucher aux vraies données
for (const k of ['GOTIFY_URL', 'GOTIFY_TOKEN', 'NOTIFY_WEBHOOK_URL', 'PUBLIC_URL']) delete process.env[k];

const store = require('../server/lib/store');
const NT = require('../server/lib/notify');

const HOOK_ID = 'webhookSECRETid-1234';
const GOTIFY_TOKEN = 'AgotifySECRETtoken';
const fake = { calls: [], hookStatus: 200, gotifyStatus: 200 };
let server, base;

test.before(async () => {
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      fake.calls.push({ path: req.url, headers: req.headers, body: data ? JSON.parse(data) : null });
      const status = req.url.startsWith('/api/webhook/') ? fake.hookStatus : fake.gotifyStatus;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

function reset(notify, extra = {}) {
  store.saveSettings({ ...(notify ? { notify } : {}), ...extra });
  fake.calls = []; fake.hookStatus = 200; fake.gotifyStatus = 200;
}
// Capture console.log / console.error pendant fn
async function captureLogs(fn) {
  const logs = [];
  const o = { log: console.log, error: console.error };
  console.log = console.error = (...a) => logs.push(a.join(' '));
  try { await fn(); } finally { console.log = o.log; console.error = o.error; }
  return logs;
}
const hookUrl = () => `${base}/api/webhook/${HOOK_ID}`;

test("validation de l'adresse du webhook (sans la recopier dans l'erreur)", () => {
  assert.strictEqual(NT.validWebhookUrl(''), '');
  assert.strictEqual(NT.validWebhookUrl('  https://ha.exemple.fr/api/webhook/abc  '), 'https://ha.exemple.fr/api/webhook/abc');
  for (const bad of ['ftp://ha/api/webhook/x', 'pas une adresse', 'https://u:p@ha.exemple.fr/api/webhook/x', 'https://ha/x#y']) {
    assert.throws(() => NT.validWebhookUrl(bad), (e) => e.code === 400 && !e.message.includes(bad));
  }
});

test("publicConfig n'expose que hasWebhook", () => {
  reset({ webhookUrl: hookUrl() });
  const pc = NT.publicConfig();
  assert.deepStrictEqual(pc, { hasGotify: false, gotifyUrl: '', hasWebhook: true });
  assert.ok(!JSON.stringify(pc).includes(HOOK_ID));
});

test('webhook seul : POST JSON {title, message, url}', async () => {
  reset({ webhookUrl: hookUrl() }, { publicUrl: 'https://optitv.exemple.fr' });
  const r = await NT.send('Titre', 'Corps', 6);
  assert.deepStrictEqual(r, { ok: true, gotify: 'absent', webhook: 'ok' });
  assert.strictEqual(fake.calls.length, 1);
  const c = fake.calls[0];
  assert.strictEqual(c.path, `/api/webhook/${HOOK_ID}`);
  assert.match(c.headers['content-type'], /^application\/json/);
  assert.deepStrictEqual(c.body, { title: 'Titre', message: 'Corps', url: 'https://optitv.exemple.fr' });
});

test('adresse publique inconnue : url omise ; PUBLIC_URL prioritaire', async () => {
  reset({ webhookUrl: hookUrl() });
  await NT.send('t', 'm');
  assert.deepStrictEqual(fake.calls[0].body, { title: 't', message: 'm' });
  process.env.PUBLIC_URL = 'https://env.exemple.fr/';
  try {
    await NT.send('t', 'm');
    assert.strictEqual(fake.calls[1].body.url, 'https://env.exemple.fr');
  } finally { delete process.env.PUBLIC_URL; }
});

test("rememberSite retient l'adresse vue par l'administrateur", () => {
  reset();
  NT.rememberSite({ headers: { host: 'optitv.exemple.fr', 'x-forwarded-proto': 'https' }, socket: {} });
  assert.strictEqual(NT.siteUrl(), 'https://optitv.exemple.fr');
  NT.rememberSite({ headers: { host: 'mauvais hôte/<x>' }, socket: {} }); // ignoré
  assert.strictEqual(NT.siteUrl(), 'https://optitv.exemple.fr');
});

test('variable NOTIFY_WEBHOOK_URL', async () => {
  reset();
  assert.strictEqual(NT.hasWebhook(), false);
  process.env.NOTIFY_WEBHOOK_URL = hookUrl();
  try {
    assert.strictEqual(NT.hasWebhook(), true);
    await NT.send('t', 'm');
    assert.strictEqual(fake.calls.length, 1);
  } finally { delete process.env.NOTIFY_WEBHOOK_URL; }
});

test('deux canaux : envoi aux deux, test par canal', async () => {
  reset({ gotifyUrl: base, gotifyToken: GOTIFY_TOKEN, webhookUrl: hookUrl() });
  assert.deepStrictEqual(await NT.testAll(), { gotify: 'ok', webhook: 'ok' });
  assert.deepStrictEqual(fake.calls.map((c) => c.path).sort(), ['/api/webhook/' + HOOK_ID, '/message'].sort());
  // Webhook en erreur : Gotify passe quand même, journal sans l'adresse
  fake.calls = []; fake.hookStatus = 500;
  let res;
  const logs = await captureLogs(async () => { res = await NT.testAll(); });
  assert.deepStrictEqual(res, { gotify: 'ok', webhook: 'erreur' });
  assert.strictEqual(await captureLogs(async () => assert.strictEqual(await NT.notifyAdmin('t', 'm'), true)).then((l) => l.length), 1);
  assert.ok(logs.length === 1 && logs.every((l) => !l.includes(HOOK_ID) && !l.includes(base) && !l.includes(GOTIFY_TOKEN)));
  // Les deux en erreur : send lève, notifyAdmin renvoie false
  fake.gotifyStatus = 500;
  await captureLogs(async () => {
    await assert.rejects(NT.send('t', 'm'), (e) => e.code === 502 && !e.message.includes(HOOK_ID));
    assert.strictEqual(await NT.notifyAdmin('t', 'm'), false);
  });
});

test('aucun canal : test « absent », send 409', async () => {
  reset();
  assert.deepStrictEqual(await NT.testAll(), { gotify: 'absent', webhook: 'absent' });
  await assert.rejects(NT.send('t', 'm'), (e) => e.code === 409);
  assert.strictEqual(await NT.notifyAdmin('t', 'm'), false);
  assert.strictEqual(fake.calls.length, 0);
});

test('webhook injoignable : échec silencieux sans adresse dans le journal', async () => {
  reset({ webhookUrl: 'http://127.0.0.1:1/api/webhook/' + HOOK_ID });
  let res;
  const logs = await captureLogs(async () => { res = await NT.testAll(); });
  assert.deepStrictEqual(res, { gotify: 'absent', webhook: 'erreur' });
  assert.ok(logs.length === 1 && !logs[0].includes(HOOK_ID) && !logs[0].includes('127.0.0.1'));
});
