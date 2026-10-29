'use strict';
// Lanceur « Plume » (dev.plume) : il prend le bouton Accueil grâce à son service d'accessibilité HomeOverride.
// Le lanceur d'origine n'est jamais désactivé : si Plume plante, la TV reste utilisable.
// Marche en ADB direct comme par ATVM Connect (A.shell), et sur Fire TV.
const A = require('./adb');
const store = require('./store');

const PKG = 'dev.plume';
const SVC = 'dev.plume/dev.plume.HomeOverride';
const PERM = 'android.permission.WRITE_SECURE_SETTINGS';

const err = (message, code = 400) => Object.assign(new Error(message), { code });
// Valeur passée au shell de la TV entre apostrophes
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// Liste des services d'accessibilité (« null » ou vide = aucun)
const parseList = (v) => {
  const t = String(v || '').trim();
  return !t || t === 'null' ? [] : t.split(':').map((s) => s.trim()).filter(Boolean);
};

async function readList(target) {
  const r = await A.shell(target, 'settings get secure enabled_accessibility_services');
  return parseList(r.out);
}

// État de Plume sur la TV : { installed, version, active, granted, disabled }
async function status(target) {
  const r = await A.shell(target, `pm list packages ${PKG}; echo ---; pm list packages -d ${PKG}; echo ---; dumpsys package ${PKG} | grep -E "versionName=|${PERM}"; echo ---; settings get secure enabled_accessibility_services`, { timeout: 20000 });
  const [pkgs = '', dis = '', dump = '', list = ''] = r.out.split('---');
  const has = (t) => t.split(/\r?\n/).some((l) => l.trim() === `package:${PKG}`);
  const installed = has(pkgs);
  const v = dump.match(/versionName=(\S+)/);
  return {
    installed,
    version: installed && v ? v[1] : null,
    active: parseList(list).includes(SVC),
    granted: installed && new RegExp(`${PERM.replace(/\./g, '\\.')}: granted=true`).test(dump),
    disabled: installed && has(dis),
  };
}

// Retire Plume du bouton Accueil (sans historique) : service retiré, accessibilité coupée si plus rien, permission reprise
async function undo(target, log) {
  const cur = await readList(target);
  const rest = cur.filter((s) => s !== SVC);
  if (rest.length !== cur.length) {
    await A.shell(target, `settings put secure enabled_accessibility_services ${rest.length ? q(rest.join(':')) : '""'}`);
    if (!rest.length) await A.shell(target, 'settings put secure accessibility_enabled 0');
  }
  const after = await readList(target);
  const active = after.includes(SVC);
  log(!active, active ? "Le service Accueil de Plume n'a pas pu être retiré" : rest.length !== cur.length
    ? "Service Accueil de Plume retiré : le lanceur d'origine reprend le bouton Accueil" : "Service Accueil de Plume déjà inactif");
  if (rest.length !== cur.length && rest.length) log(true, `Autres services d'accessibilité conservés (${rest.length})`);
  const g = await A.shell(target, `pm revoke ${PKG} ${PERM}`);
  const gOk = g.ok && !/Exception|Error/i.test(`${g.out} ${g.err}`);
  log(gOk, gOk ? 'Permission système reprise' : `Permission système : ${(g.err || g.out || 'échec').slice(0, 120)}`);
  return { active };
}

// Plume prend le bouton Accueil, puis on vérifie qu'un appui sur Accueil l'ouvre bien
async function setup(target, log) {
  const st = await status(target);
  if (!st.installed) throw err("Plume n'est pas installé sur cette TV", 409);
  log(true, `Plume ${st.version || ''} installé`.replace('  ', ' '));
  if (st.disabled) {
    const r = await A.shell(target, `pm enable ${PKG}`);
    log(/enabled/.test(r.out), /enabled/.test(r.out) ? 'Plume réactivé (il était désactivé)' : `Plume désactivé : ${r.err || r.out || 'échec'}`);
  }
  const g = await A.shell(target, `pm grant ${PKG} ${PERM}`);
  const gOk = g.ok && !/Exception|Error/i.test(`${g.out} ${g.err}`);
  log(gOk, gOk ? 'Permission système accordée' : `Permission système refusée : ${(g.err || g.out || 'échec').slice(0, 120)}`);

  const cur = await readList(target);
  if (cur.includes(SVC)) log(true, 'Service Accueil de Plume déjà actif');
  else {
    await A.shell(target, `settings put secure enabled_accessibility_services ${q([...cur, SVC].join(':'))}`);
    if (cur.length) log(true, `Autres services d'accessibilité conservés (${cur.length})`);
  }
  await A.shell(target, 'settings put secure accessibility_enabled 1');
  const active = (await readList(target)).includes(SVC);
  if (!cur.includes(SVC)) log(active, active ? 'Service Accueil de Plume activé' : "La TV a refusé d'activer le service Accueil de Plume");

  // Test : Accueil, puis quelle fenêtre a le focus ?
  let homeOk = null;
  if (active) {
    await A.shell(target, 'input keyevent KEYCODE_HOME');
    await A.sleep(3000);
    const f = await A.shell(target, 'dumpsys window | grep -m1 mCurrentFocus');
    const line = f.out.trim();
    if (line) {
      homeOk = line.includes(`${PKG}/`) || line.includes(` ${PKG}`);
      const m = line.match(/u\d+ ([^\s}]+)/);
      log(homeOk, homeOk ? 'Test : le bouton Accueil ouvre bien Plume'
        : `Le bouton Accueil n'ouvre pas Plume (${m ? m[1] : 'autre écran'}) : ouvre Plume une fois sur la TV, termine sa configuration, puis réessaie`);
    } else log(true, "Test du bouton Accueil impossible sur cette TV : appuie sur Accueil pour vérifier");
  }
  return { active, homeOk };
}

// Action demandée par le site, enregistrée dans l'historique de la TV (comme les optimisations)
async function run(target, dev, action) {
  if (action !== 'enable' && action !== 'disable') throw err('Action inconnue (enable ou disable).');
  // Même verrou que l'optimisation : une seule opération à la fois sur une TV
  return require('./optimizer').withLock(dev.id, async () => {
    const log = [];
    const add = (ok, text) => log.push({ ok, text });
    const r = action === 'enable' ? await setup(target, add) : { ...(await undo(target, add)), homeOk: null };
    const hist = store.history(dev.id);
    const at = new Date().toISOString();
    if (action === 'disable') {
      // Les activations précédentes sont annulées
      for (const s of hist.filter((x) => x.type === 'plume' && x.action === 'enable' && !x.restored)) Object.assign(s, { restored: true, restoredAt: at });
    }
    // Une activation reste « active » (annulable par Restaurer) ; une désactivation est une simple trace
    hist.unshift({
      id: Date.now().toString(36), type: 'plume', action, at, level: 0, settings: {}, apps: [], home: null,
      plume: { active: r.active, homeOk: r.homeOk }, log,
      restored: action === 'disable' || !r.active, ...(action === 'disable' || !r.active ? { restoredAt: at } : {}),
    });
    store.saveHistory(dev.id, hist);
    return { ok: action === 'enable' ? r.active : !r.active, active: r.active, homeOk: r.homeOk, log: log.map((l) => l.text), steps: log };
  });
}

module.exports = { PKG, SVC, status, setup, undo, run, parseList };
