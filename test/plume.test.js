'use strict';
// Tests du lanceur Plume (service d'accessibilité HomeOverride), avec une fausse TV : aucun adb réel.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atvm-plume-'));
process.env.DATA_DIR = TMP; // store.js ne doit jamais toucher aux vraies données

const A = require('../server/lib/adb');
const store = require('../server/lib/store');
const O = require('../server/lib/optimizer');
const P = require('../server/lib/plume');

const SVC = 'dev.plume/dev.plume.HomeOverride';
const OTHER = 'com.example.tts/com.example.tts.Service';

// Fausse TV : interprète les quelques commandes utilisées par plume.js
function fakeTv({ installed = true, list = 'null', a11y = '0', focusPlume = true, focus = null } = {}) {
  const tv = { installed, list, a11y, granted: false, calls: [], disabled: false };
  const unq = (v) => (v === '""' ? '' : v.replace(/^'(.*)'$/s, '$1').replace(/'\\''/g, "'"));
  tv.shell = (target, cmd) => {
    tv.calls.push(cmd);
    const reply = (out = '', ok = true) => Promise.resolve({ ok, out, err: '' });
    let m;
    if (cmd.startsWith('pm list packages dev.plume')) {
      const parts = cmd.split('; echo ---; ');
      const outs = parts.map((c) => {
        if (c === 'pm list packages dev.plume') return tv.installed ? 'package:dev.plume\npackage:dev.plume.extra' : '';
        if (c === 'pm list packages -d dev.plume') return tv.disabled ? 'package:dev.plume' : '';
        if (c.startsWith('dumpsys package')) return tv.installed ? `    versionName=1.2.0\n      android.permission.WRITE_SECURE_SETTINGS: granted=${tv.granted}` : '';
        if (c.startsWith('settings get secure enabled_accessibility_services')) return tv.list;
        return '';
      });
      return reply(outs.join('\n---\n'));
    }
    if (cmd === 'settings get secure enabled_accessibility_services') return reply(tv.list);
    if ((m = cmd.match(/^settings put secure enabled_accessibility_services (.*)$/s))) { tv.list = unq(m[1]); return reply(); }
    if ((m = cmd.match(/^settings put secure accessibility_enabled (\d)$/))) { tv.a11y = m[1]; return reply(); }
    if (cmd.startsWith('pm grant dev.plume')) { if (!tv.installed) return reply('', false); tv.granted = true; return reply(); }
    if (cmd.startsWith('pm revoke dev.plume')) { tv.granted = false; return reply(); }
    if (cmd.startsWith('pm enable dev.plume')) { tv.disabled = false; return reply('Package dev.plume new state: enabled'); }
    if (cmd === 'input keyevent KEYCODE_HOME') return reply();
    if (cmd.startsWith('dumpsys window')) {
      const comp = focus || (focusPlume && tv.list.split(':').includes(SVC) ? 'dev.plume/dev.plume.MainActivity' : 'com.google.android.apps.tv.launcherx/.home.HomeActivity');
      return reply(`  mCurrentFocus=Window{1a2b3c u0 ${comp}}`);
    }
    return reply('');
  };
  return tv;
}

let tv;
A.shell = (target, cmd, opts) => tv.shell(target, cmd, opts);
A.sleep = () => Promise.resolve();
const dev = (id) => ({ id, host: '10.0.0.2', port: 5555, manufacturer: 'Amazon', brand: 'Amazon', model: 'AFTKA' });

test('état : absent, puis installé et inactif (« null » = liste vide)', async () => {
  tv = fakeTv({ installed: false });
  assert.deepStrictEqual(await P.status('agent:x'), { installed: false, version: null, active: false, granted: false, disabled: false });
  tv = fakeTv();
  const s = await P.status('10.0.0.2:5555');
  assert.strictEqual(s.installed, true);
  assert.strictEqual(s.version, '1.2.0');
  assert.strictEqual(s.active, false);
  assert.strictEqual(s.granted, false);
});

test('activation sur liste vide (null) : service seul, accessibilité activée, Accueil vérifié, historique', async () => {
  tv = fakeTv({ list: 'null' });
  const r = await P.run('t', dev('d1'), 'enable');
  assert.strictEqual(tv.list, SVC);
  assert.strictEqual(tv.a11y, '1');
  assert.strictEqual(tv.granted, true);
  assert.deepStrictEqual([r.ok, r.active, r.homeOk], [true, true, true]);
  assert.ok(r.log.every((l) => typeof l === 'string'));
  const h = store.history('d1');
  assert.strictEqual(h[0].type, 'plume');
  assert.strictEqual(h[0].action, 'enable');
  assert.strictEqual(h[0].restored, false);
  const s = await P.status('t');
  assert.deepStrictEqual([s.active, s.granted], [true, true]);
});

test('liste vide "" aussi traitée comme vide', async () => {
  tv = fakeTv({ list: '' });
  await P.run('t', dev('d1b'), 'enable');
  assert.strictEqual(tv.list, SVC);
});

test('activation : services existants conservés', async () => {
  tv = fakeTv({ list: OTHER, a11y: '1' });
  const r = await P.run('t', dev('d2'), 'enable');
  assert.strictEqual(tv.list, `${OTHER}:${SVC}`);
  assert.strictEqual(r.active, true);
});

test('déjà actif : idempotent (aucune réécriture de la liste)', async () => {
  tv = fakeTv({ list: `${OTHER}:${SVC}`, a11y: '1' });
  const r = await P.run('t', dev('d3'), 'enable');
  assert.strictEqual(tv.list, `${OTHER}:${SVC}`);
  assert.ok(!tv.calls.some((c) => c.startsWith('settings put secure enabled_accessibility_services')));
  assert.ok(r.log.some((l) => /déjà actif/.test(l)));
  assert.strictEqual(r.active, true);
});

test('Plume absent : erreur 409, rien de modifié', async () => {
  tv = fakeTv({ installed: false, list: OTHER });
  await assert.rejects(P.run('t', dev('d4'), 'enable'), (e) => e.code === 409 && /n'est pas installé/.test(e.message));
  assert.strictEqual(tv.list, OTHER);
  assert.ok(!tv.calls.some((c) => c.startsWith('settings put') || c.startsWith('pm grant')));
  assert.deepStrictEqual(store.history('d4'), []);
});

test('annulation : seul Plume est retiré, permission reprise, activation marquée restaurée', async () => {
  tv = fakeTv({ list: OTHER });
  await P.run('t', dev('d5'), 'enable');
  const r = await P.run('t', dev('d5'), 'disable');
  assert.strictEqual(tv.list, OTHER);
  assert.strictEqual(tv.a11y, '1'); // un autre service reste actif
  assert.strictEqual(tv.granted, false);
  assert.deepStrictEqual([r.ok, r.active, r.homeOk], [true, false, null]);
  const h = store.history('d5');
  assert.deepStrictEqual(h.map((x) => [x.action, x.restored]), [['disable', true], ['enable', true]]);
});

test('annulation : liste devenue vide → accessibilité coupée', async () => {
  tv = fakeTv({ list: SVC, a11y: '1' });
  await P.run('t', dev('d6'), 'disable');
  assert.strictEqual(tv.list, '');
  assert.strictEqual(tv.a11y, '0');
  assert.ok(!tv.calls.some((c) => /disable-user/.test(c)), "le lanceur d'origine n'est jamais désactivé");
});

test('test Accueil raté : homeOk false, service quand même actif', async () => {
  tv = fakeTv({ focus: 'com.google.android.apps.tv.launcherx/.home.HomeActivity' });
  const r = await P.run('t', dev('d7'), 'enable');
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.homeOk, false);
  assert.ok(r.log.some((l) => /n'ouvre pas Plume/.test(l)));
});

test('Restaurer (historique) annule aussi Plume', async () => {
  tv = fakeTv({ list: OTHER });
  await P.run('t', dev('d8'), 'enable');
  const r = await O.restore('t', dev('d8'), { snapshot: 'all' });
  assert.strictEqual(tv.list, OTHER);
  assert.ok(r.log.some((l) => /retiré/.test(l.text)));
  assert.strictEqual(store.history('d8')[0].restored, true);
});

test('action inconnue refusée', async () => {
  tv = fakeTv();
  await assert.rejects(P.run('t', dev('d9'), 'boom'), (e) => e.code === 400);
});

test("l'optimisation ne peut jamais désactiver dev.plume", () => {
  assert.strictEqual(O.isProtected('dev.plume'), true);
  assert.ok(O.catalog.background.never.includes('dev.plume'));
  assert.ok(!O.catalog.apps.some((a) => a.pkg === 'dev.plume'));
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
