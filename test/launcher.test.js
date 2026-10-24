'use strict';
// Tests du remplacement du lanceur (niveau 3) et de « Remettre le lanceur d'origine », avec une fausse TV
// (aucun adb réel). node --test, sans dépendance.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atvm-launcher-'));
process.env.DATA_DIR = TMP; // store.js ne doit jamais toucher aux vraies données

const A = require('../server/lib/adb');
const O = require('../server/lib/optimizer');

const LX = 'com.google.android.apps.tv.launcherx';
const LX_C = `${LX}/.home.HomeActivity`;
const SW = 'com.google.android.tungsten.setupwraith';
const SW_C = `${SW}/.RecoveryActivity`;
const AT = 'com.overdevs.at4k';
const AT_C = `${AT}/.MainActivity`;

// Fausse TV. homes : { comp, priority, hiddenUntil } (hiddenUntil : paquet dont la désactivation fait apparaître
// l'accueil, et lui donne la main malgré le choix de l'utilisateur, comme la RecoveryActivity de setupwraith).
function fakeTv({ system = [], user = [], disabled = [], homes = [], preferred = null, wifiOwners = [], brokenDisable = [], resumed = null, props = {} }) {
  const tv = {
    system: new Set(system), user: new Set(user), disabled: new Set(disabled), homes, preferred, calls: [],
  };
  const enabled = (p) => (tv.system.has(p) || tv.user.has(p)) && !tv.disabled.has(p);
  const visible = () => tv.homes.filter((h) => enabled(h.comp.split('/')[0]) && (!h.hiddenUntil || tv.disabled.has(h.hiddenUntil)));
  tv.resolve = () => {
    const list = visible();
    const forced = list.find((h) => h.hiddenUntil);
    if (forced) return forced.comp;
    if (tv.preferred && list.some((h) => h.comp === tv.preferred)) return tv.preferred;
    const sys = list.filter((h) => tv.system.has(h.comp.split('/')[0])).sort((a, b) => b.priority - a.priority);
    if (sys.length) return sys[0].comp;
    return list.length === 1 ? list[0].comp : 'android/com.android.internal.app.ResolverActivity';
  };
  const reply = (out = '', ok = true) => Promise.resolve({ ok, out, err: '' });
  tv.shell = (target, cmd) => {
    tv.calls.push(cmd);
    let m;
    if (cmd.startsWith('pm list packages -s')) {
      return reply([...tv.system].map((p) => `package:${p}`).join('\n') + '\n---\n' + [...tv.user].map((p) => `package:${p}`).join('\n') + '\n---\n' + [...tv.disabled].map((p) => `package:${p}`).join('\n'));
    }
    if (cmd.startsWith('dumpsys meminfo')) return reply('');
    if (cmd.startsWith('dumpsys wifi')) return reply(wifiOwners.map((o, i) => `  ID: ${i} SSID: "Maison" ... cname=${o} cuid=10042`).join('\n'));
    if (cmd.includes('getprop')) return reply(`name=${props.name || 'generic'}\nproduct=${props.product || 'generic'}\nfingerprint=${props.fingerprint || 'x/y/z'}`);
    if (cmd.includes('settings get global')) return reply(['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'].map((k) => `${k}=0.5`).join('\n'));
    if (cmd.includes('MemAvailable')) return reply('MemAvailable:     800000 kB');
    if ((m = cmd.match(/^pm disable-user --user 0 (\S+)/))) {
      if (brokenDisable.includes(m[1])) return reply('Error: java.lang.SecurityException: refusé', false);
      tv.disabled.add(m[1]);
      return reply(`Package ${m[1]} new state: disabled-user`);
    }
    if ((m = cmd.match(/^pm enable (\S+)/))) { tv.disabled.delete(m[1]); return reply(`Package ${m[1]} new state: enabled`); }
    if (cmd.startsWith('cmd package query-activities --brief --query-flags')) {
      return reply(tv.homes.filter((h) => tv.disabled.has(h.comp.split('/')[0])).map((h) => `priority=${h.priority}\n${h.comp}`).join('\n'));
    }
    if (cmd.startsWith('cmd package query-activities')) return reply(visible().map((h) => `priority=${h.priority} preferredOrder=0\n${h.comp}`).join('\n'));
    if (cmd.startsWith('cmd package resolve-activity')) return reply(`priority=0 preferredOrder=0\n${tv.resolve()}`);
    if ((m = cmd.match(/^cmd package set-home-activity (\S+)/))) {
      if (!visible().some((h) => h.comp === m[1])) return reply('Error: component not found', false);
      tv.preferred = m[1];
      return reply('Success');
    }
    if (cmd.startsWith('dumpsys activity activities')) return reply(`  topResumedActivity=ActivityRecord{a1b2 u0 ${resumed || tv.resolve()} t12}`);
    return reply('');
  };
  return tv;
}

let tv;
A.shell = (target, cmd, opts) => tv.shell(target, cmd, opts);
A.sleep = () => Promise.resolve();

const agentDev = (id) => ({ id, transport: 'agent', agentId: 'ag1', remote: true, manufacturer: 'Xiaomi', brand: 'Xiaomi', model: 'MiTV-AFMU1' });
const localDev = (id) => ({ id, host: '10.0.0.2', port: 5555, remote: false, manufacturer: 'Generic', brand: 'Generic', model: 'X' });
const body = { level: 3, apps: [], launcher: { pkg: AT, disableStock: true } };
// setupwraith : RecoveryActivity qui prend la main dès que launcherx est désactivé (CleanYourTV, xiaomi-mitv-afmu1)
const xiaomiHomes = () => [{ comp: SW_C, priority: 1, hiddenUntil: LX }, { comp: LX_C, priority: 2 }, { comp: AT_C, priority: 0 }];
const texts = (snap) => snap.log.map((l) => `${l.ok ? 'OK' : 'KO'} ${l.text}`).join('\n');

test('Xiaomi AFMU1 via ATVM Connect : setupwraith a le Wi-Fi → accueil d\'origine gardé, nouveau lanceur par défaut', async () => {
  tv = fakeTv({ system: [LX, SW], user: [AT], homes: xiaomiHomes(), preferred: LX_C, wifiOwners: [SW] });
  const dev = agentDev('afmu1');
  const plan = await O.plan(`agent:ag1`, dev, 3);
  assert.strictEqual(plan.launcher.stockDisable.allowed, false);
  assert.match(plan.launcher.stockDisable.why, /Wi-Fi/);

  const { snapshot } = await O.apply('agent:ag1', dev, body);
  assert.ok(!tv.calls.some((c) => c === `pm disable-user --user 0 ${LX}`), 'launcherx ne doit pas être désactivé');
  assert.ok(!tv.calls.some((c) => c === `pm disable-user --user 0 ${SW}`), 'setupwraith ne doit pas être désactivé');
  assert.strictEqual(snapshot.home.stockDisabled, null);
  assert.strictEqual(tv.resolve(), AT_C);
  const t = texts(snapshot);
  assert.match(t, /OK Nouveau lanceur par défaut : com\.overdevs\.at4k \(vérifié\)/);
  assert.match(t, /KO Accueil d'origine conservé : .*Wi-Fi/);
  assert.match(t, /peut parfois rouvrir Google TV/);
  assert.doesNotMatch(t, /OK Lanceur d'origine désactivé/);
});

test('TV distante, setupwraith sans Wi-Fi : option prudente, accueil d\'origine gardé', async () => {
  tv = fakeTv({ system: [LX, SW], user: [AT], homes: xiaomiHomes(), preferred: LX_C, wifiOwners: ['android'] });
  const { snapshot } = await O.apply('agent:ag1', agentDev('afmu1b'), body);
  assert.strictEqual(snapshot.home.stockDisabled, null);
  assert.ok(!tv.disabled.has(LX) && !tv.disabled.has(SW));
  assert.match(texts(snapshot), /KO Accueil d'origine conservé : .*à distance est trop risqué/);
});

test('HOME repris par un assistant après désactivation → retour arrière automatique', async () => {
  // Assistant invisible au départ (activité HOME qui n'apparaît qu'une fois l'accueil d'origine désactivé)
  const WIZ = 'com.vendor.setupwizard';
  tv = fakeTv({
    system: [LX, WIZ], user: [AT], preferred: LX_C,
    homes: [{ comp: LX_C, priority: 2 }, { comp: AT_C, priority: 0 }, { comp: `${WIZ}/.RecoveryActivity`, priority: 1, hiddenUntil: LX }],
  });
  const { snapshot } = await O.apply('10.0.0.2:5555', localDev('loc1'), body);
  assert.ok(tv.calls.includes(`pm disable-user --user 0 ${LX}`), 'tentative de désactivation attendue');
  assert.ok(tv.calls.includes(`pm enable ${LX}`), 'launcherx doit être réactivé');
  assert.ok(!tv.disabled.has(LX));
  assert.strictEqual(snapshot.home.stockDisabled, null);
  assert.strictEqual(tv.resolve(), AT_C, 'le nouveau lanceur reste l\'accueil');
  const t = texts(snapshot);
  assert.match(t, /KO Échec : une fois l'accueil d'origine .* menait à com\.vendor\.setupwizard au lieu de com\.overdevs\.at4k\. Retour arrière automatique/);
  assert.doesNotMatch(t, /OK Lanceur d'origine désactivé/);
});

test('Filet de sécurité : setupwraith au premier plan après Accueil → retour arrière (accueil et setupwraith réactivés)', async () => {
  tv = fakeTv({ system: [LX, SW], user: [AT], homes: xiaomiHomes(), preferred: LX_C, wifiOwners: ['android'], resumed: SW_C });
  const { snapshot } = await O.apply('10.0.0.3:5555', localDev('loc2'), body);
  assert.ok(!tv.disabled.has(LX) && !tv.disabled.has(SW));
  assert.strictEqual(snapshot.home.stockDisabled, null);
  assert.deepStrictEqual(snapshot.home.rivalsDisabled, []);
  assert.match(texts(snapshot), /KO Échec : après un appui sur Accueil, la TV affichait com\.google\.android\.tungsten\.setupwraith/);
});

test('setupwraith refuse d\'être désactivé → accueil d\'origine jamais touché', async () => {
  tv = fakeTv({ system: [LX, SW], user: [AT], homes: xiaomiHomes(), preferred: LX_C, brokenDisable: [SW] });
  const { snapshot } = await O.apply('10.0.0.4:5555', localDev('loc3'), body);
  assert.ok(!tv.calls.includes(`pm disable-user --user 0 ${LX}`));
  assert.strictEqual(snapshot.home.stockDisabled, null);
  assert.match(texts(snapshot), /KO Échec : Assistant de configuration Google TV .* n'a pas pu être désactivée/);
});

test('TV locale, setupwraith sans Wi-Fi : désactivé AVANT l\'accueil d\'origine, puis restauration complète', async () => {
  tv = fakeTv({ system: [LX, SW], user: [AT], homes: xiaomiHomes(), preferred: LX_C, wifiOwners: ['android'] });
  const dev = localDev('loc4');
  const { snapshot } = await O.apply('10.0.0.5:5555', dev, body);
  const iSw = tv.calls.indexOf(`pm disable-user --user 0 ${SW}`);
  const iLx = tv.calls.indexOf(`pm disable-user --user 0 ${LX}`);
  assert.ok(iSw >= 0 && iLx > iSw, 'setupwraith doit partir avant launcherx');
  assert.strictEqual(snapshot.home.stockDisabled, LX);
  assert.deepStrictEqual(snapshot.home.rivalsDisabled, [SW]);
  assert.strictEqual(tv.resolve(), AT_C);
  assert.match(texts(snapshot), /OK Lanceur d'origine désactivé \(com\.google\.android\.apps\.tv\.launcherx\) ; le bouton Accueil mène bien/);

  const r = await O.restore('10.0.0.5:5555', dev, { snapshot: 'all' });
  assert.ok(!tv.disabled.has(LX) && !tv.disabled.has(SW));
  assert.strictEqual(tv.resolve(), LX_C);
  assert.ok(r.log.every((l) => l.ok), JSON.stringify(r.log));
});

test('Réactivation isolée de setupwraith : il reprendrait l\'Accueil → accueil d\'origine réactivé, nouveau lanceur gardé', async () => {
  tv = fakeTv({ system: [LX, SW], user: [AT], homes: xiaomiHomes(), preferred: LX_C, wifiOwners: ['android'] });
  const dev = localDev('loc5');
  const { snapshot } = await O.apply('10.0.0.6:5555', dev, body);
  assert.strictEqual(snapshot.home.stockDisabled, LX);
  const r = await O.restore('10.0.0.6:5555', dev, { snapshot: snapshot.id, pkg: SW });
  assert.ok(!tv.disabled.has(SW) && !tv.disabled.has(LX), JSON.stringify(r.log));
  assert.strictEqual(tv.resolve(), AT_C);
  assert.match(r.log.map((l) => l.text).join('\n'), /Accueil d'origine réactivé/);
});

test('Cas nominal (TV distante sans accueil concurrent) : accueil d\'origine désactivé et vérifié', async () => {
  tv = fakeTv({ system: [LX], user: [AT], homes: [{ comp: LX_C, priority: 2 }, { comp: AT_C, priority: 0 }], preferred: LX_C });
  const { snapshot } = await O.apply('agent:ag1', agentDev('nom1'), body);
  assert.strictEqual(snapshot.home.stockDisabled, LX);
  assert.ok(tv.disabled.has(LX));
  assert.strictEqual(tv.resolve(), AT_C);
  const t = texts(snapshot);
  assert.match(t, /OK Lanceur d'origine désactivé .* le bouton Accueil mène bien à com\.overdevs\.at4k/);
  assert.doesNotMatch(t, /KO/);
});

test('Remettre le lanceur d\'origine : launcherx désactivé, HOME sur setupwraith → launcherx réactivé, HOME sur launcherx', async () => {
  tv = fakeTv({ system: [LX, SW], user: [AT], homes: xiaomiHomes(), disabled: [LX], preferred: AT_C });
  assert.strictEqual(tv.resolve(), SW_C, 'situation de départ : la TV est bloquée sur setupwraith');
  const dev = agentDev('reset1');
  const r = await O.resetLauncher('agent:ag1', dev);
  assert.strictEqual(r.ok, true, JSON.stringify(r.log));
  assert.strictEqual(r.home, LX_C);
  assert.ok(!tv.disabled.has(LX));
  assert.ok(tv.user.has(AT) && !tv.disabled.has(AT), 'le lanceur tiers reste installé et activé');
  assert.ok(Array.isArray(r.log) && r.log.every((l) => typeof l.ok === 'boolean' && typeof l.text === 'string'));
  const hist = require('../server/lib/store').history(dev.id);
  assert.strictEqual(hist[0].type, 'reset-launcher');
  assert.deepStrictEqual(hist[0].enabled, [LX]);
});

test('Remettre le lanceur d\'origine : setupwraith désactivé aussi → réactivé', async () => {
  tv = fakeTv({ system: [LX, SW], user: [AT], homes: xiaomiHomes(), disabled: [LX, SW], preferred: AT_C });
  const r = await O.resetLauncher('agent:ag1', agentDev('reset2'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.home, LX_C);
  assert.ok(!tv.disabled.has(SW));
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
