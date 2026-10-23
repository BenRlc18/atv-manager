'use strict';
// Optimisation par niveaux (aperçu, application, restauration). Rien n'est supprimé du système :
// les applis sont désactivées pour l'utilisateur (pm disable-user) et se réactivent avec pm enable.
const path = require('path');
const fs = require('fs');
const A = require('./adb');
const store = require('./store');
const CYT = require('./cleanyourtv');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog.json'), 'utf8'));
const byPkg = new Map(catalog.apps.map((a) => [a.pkg, a]));
const protectedSet = new Set(catalog.protected);

const ANIMATION_KEYS = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'];
const ANIMATION_TARGET = '0.5';

function isProtected(pkg) {
  return protectedSet.has(pkg) || catalog.protectedPrefixes.some((p) => pkg === p || pkg.startsWith(`${p}.`) || pkg.startsWith(p));
}

async function listPackages(target) {
  const r = await A.shell(target, 'pm list packages -s; echo ---; pm list packages -3; echo ---; pm list packages -d', { timeout: 30000 });
  const [sys = '', usr = '', dis = ''] = r.out.split('---');
  const parse = (t) => new Set(t.split(/\r?\n/).map((l) => l.trim().replace(/^package:/, '')).filter(Boolean));
  return { system: parse(sys), user: parse(usr), disabled: parse(dis) };
}

// Mémoire utilisée par appli (PSS en Mo), d'après dumpsys meminfo compact
async function memoryByPackage(target) {
  const r = await A.shell(target, 'dumpsys meminfo -c | grep "^proc,"', { timeout: 45000 });
  const mem = new Map();
  for (const line of r.out.split(/\r?\n/)) {
    const f = line.split(',');
    if (f.length < 5) continue;
    const pkg = f[2].split(':')[0];
    const kb = Number(f[4]) || 0;
    mem.set(pkg, (mem.get(pkg) || 0) + kb);
  }
  return mem;
}

// Réseaux Wi-Fi enregistrés et applis qui les ont créés. Android efface un réseau quand l'appli qui l'a
// enregistré (assistant d'installation Google ou du fabricant) est retirée : la TV perd le Wi-Fi et il faut
// retaper le mot de passe. Ces applis ne sont donc jamais désactivées.
async function wifiInfo(target) {
  const r = await A.shell(target, 'dumpsys wifi | grep -E "cname=|creatorName="', { timeout: 15000 });
  const owners = new Set();
  let networks = 0;
  for (const line of r.out.split(/\r?\n/)) {
    if (/cname=|creatorName=/.test(line)) networks++;
    for (const m of line.matchAll(/(?:cname|lname|creatorName|lastUpdateName)=([\w.]+)/g)) {
      if (m[1].includes('.') && !m[1].startsWith('android.uid')) owners.add(m[1]);
    }
  }
  return { ok: r.ok, owners, networks };
}
const WIFI_WHY = "A enregistré le réseau Wi-Fi de la TV : la retirer effacerait le Wi-Fi (mot de passe à retaper).";

async function ramFreeMb(target) {
  const r = await A.shell(target, 'grep "^MemAvailable:" /proc/meminfo', { timeout: 8000 });
  const m = r.out.match(/(\d+)/);
  return m ? Math.round(Number(m[1]) / 1024) : null;
}

const component = (out) => out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[\w.]+\/[\w.$]+$/.test(l));

async function currentHome(target) {
  const r = await A.shell(target, 'cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME', { timeout: 10000 });
  const c = component(r.out).pop() || '';
  return /ResolverActivity|FallbackHome/.test(c) ? '' : c;
}

async function homeActivities(target) {
  const r = await A.shell(target, 'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME', { timeout: 10000 });
  return component(r.out).filter((c) => !/FallbackHome|ResolverActivity/.test(c));
}

// Propriétés de l'appareil utiles à la reconnaissance du modèle CleanYourTV (en plus de celles de dev)
async function modelProps(target, dev) {
  const r = await A.shell(target, 'echo name=$(getprop ro.product.name); echo product=$(getprop ro.build.product); echo fingerprint=$(getprop ro.build.fingerprint)', { timeout: 8000 });
  return CYT.deviceProps(dev, A.parseKv(r.out));
}
const CYT_CRITICAL = /webview|inputmethod|\.ime$|keyboard|packageinstaller|bluetooth|setupwraith|launcher|tvhome/i;
const CYT_LOSS = "Non documentée en français : lis la note de CleanYourTV (en anglais) avant de la retirer.";

async function getSettings(target) {
  const r = await A.shell(target, ANIMATION_KEYS.map((k) => `echo ${k}=$(settings get global ${k})`).join('; '), { timeout: 8000 });
  return A.parseKv(r.out);
}

const LEVELS = {
  1: {
    title: 'Léger',
    summary: "Allège la mémoire sans retirer d'applis.",
    gains: ['Menus et transitions plus rapides (animations à 0,5x)', 'Mémoire libérée (caches vidés, applis en arrière-plan fermées)', 'Télémétrie coupée'],
    losses: ['Pratiquement rien : les statistiques envoyées au fabricant et à Google'],
  },
  2: {
    title: 'Moyen',
    summary: 'Niveau léger + désactivation des applis inutiles.',
    gains: ['Tout le niveau léger', 'Plus de mémoire et de stockage libres', "Moins de mises à jour et de publicité en arrière-plan"],
    losses: ['Les fonctions des applis désactivées (indiquées pour chacune)', 'Tout reste réactivable depuis l\'historique'],
  },
  3: {
    title: 'Avancé',
    summary: 'Niveau moyen + remplacement du lanceur (écran d\'accueil).',
    gains: ['Tout le niveau moyen', 'Accueil sans publicité ni recommandations', 'Accueil beaucoup plus léger et rapide'],
    losses: ['Les recommandations de l\'accueil d\'origine', 'Parfois la recherche vocale depuis l\'accueil', 'Selon le modèle, un bouton de télécommande peut rouvrir l\'ancien accueil'],
  },
};

// Aperçu de ce que ferait un niveau
async function plan(target, dev, level, mode = 'recommended') {
  level = Math.min(3, Math.max(1, Number(level) || 1));
  const [pk, mem, settings, ramFree, wifi, props] = await Promise.all([listPackages(target), memoryByPackage(target), getSettings(target), ramFreeMb(target), wifiInfo(target), modelProps(target, dev)]);
  const installed = new Set([...pk.system, ...pk.user]);
  const memMb = (pkg) => Math.round(((mem.get(pkg) || 0) / 1024) * 10) / 10;
  const wifiLock = (a) => (wifi.owners.has(a.pkg) && !a.disabled ? { ...a, risk: 'protected', why: WIFI_WHY, checked: false, locked: true } : a);

  const animSkipped = isFireTv(dev);
  const settingsChanges = animSkipped ? [] : ANIMATION_KEYS.map((k) => ({ key: k, from: settings[k] && settings[k] !== 'null' ? settings[k] : '1.0', to: ANIMATION_TARGET }))
    .filter((s) => s.from !== ANIMATION_TARGET);

  // CleanYourTV : modèle reconnu, puis suggestions pour les applis système absentes du catalogue maison.
  // Garde-fous : catalogue prioritaire, isProtected(), lanceurs (écran d'accueil), applis critiques, keep du modèle.
  const detected = CYT.detect(props);
  const homes = level >= 2 ? await homeActivities(target) : [];
  const homePkgs = new Set(homes.map((c) => c.split('/')[0]));
  const cyt = level >= 2
    ? CYT.suggestions(detected, pk.system, (pkg) => byPkg.has(pkg) || isProtected(pkg) || homePkgs.has(pkg) || CYT_CRITICAL.test(pkg) || pk.user.has(pkg))
    : { list: new Map(), isKept: () => false };
  const cytEntry = (pkg, s) => {
    const disabled = pk.disabled.has(pkg);
    const risk = s.safe ? 'safe' : 'info';
    return wifiLock({
      pkg, name: pkg, level: 2, risk, category: 'Suggestions CleanYourTV',
      why: s.why, loss: CYT_LOSS,
      source: 'CleanYourTV', sourceModel: s.sourceModel, cytModels: s.models,
      memMb: memMb(pkg), disabled, checked: !disabled && mode === 'recommended' && risk === 'safe', locked: false,
    });
  };

  const apps = [];
  for (const meta of catalog.apps) {
    if (!installed.has(meta.pkg)) continue;
    if (meta.level > level) continue;
    const disabled = pk.disabled.has(meta.pkg);
    const entry = {
      ...meta,
      memMb: memMb(meta.pkg),
      disabled,
      checked: !disabled && (meta.level === 1 || (mode === 'recommended' && meta.risk === 'safe')),
      locked: false,
    };
    // Information seulement : CleanYourTV déconseille fortement de la retirer sur ce modèle (« NEVER disable »,
    // paquet protégé...). L'entrée du catalogue ne change pas, c'est au catalogue maison d'être corrigé si besoin.
    if (CYT.criticalFor(detected.models, meta.pkg)) entry.cytKept = true;
    apps.push(wifiLock(entry));
  }
  if (level >= 2 && mode === 'recommended') {
    for (const [pkg, s] of [...cyt.list].sort((a, b) => a[0].localeCompare(b[0]))) apps.push(cytEntry(pkg, s));
  }
  if (level >= 2 && mode === 'manual') {
    for (const pkg of [...installed].sort()) {
      if (byPkg.has(pkg)) continue;
      if (cyt.list.has(pkg)) { apps.push(cytEntry(pkg, cyt.list.get(pkg))); continue; }
      if (detected.models.length && cyt.isKept(pkg) && !isProtected(pkg)) {
        apps.push(wifiLock({
          pkg, name: pkg, level: 2, risk: 'protected', category: pk.user.has(pkg) ? 'Applis installées' : 'Autres applis système',
          why: `Gardée par CleanYourTV sur ce modèle (${detected.models[0].label}).`, loss: '',
          source: 'CleanYourTV', sourceModel: detected.models[0].label,
          memMb: memMb(pkg), disabled: pk.disabled.has(pkg), checked: false, locked: true, user: pk.user.has(pkg),
        }));
        continue;
      }
      const prot = isProtected(pkg);
      apps.push(wifiLock({
        pkg, name: pkg, level: 2, risk: prot ? 'protected' : 'unknown', category: pk.user.has(pkg) ? 'Applis installées' : 'Autres applis système',
        why: prot ? 'Essentielle au fonctionnement de la TV.' : "Pas encore dans notre catalogue : à ne retirer que si tu sais ce qu'elle fait.",
        loss: prot ? '' : 'Inconnue.',
        memMb: memMb(pkg), disabled: pk.disabled.has(pkg), checked: false, locked: prot, user: pk.user.has(pkg),
      }));
    }
  }

  let launcher = null;
  if (level >= 3) {
    const current = await currentHome(target);
    const stockPkg = current ? current.split('/')[0] : '';
    launcher = {
      current, stockPkg,
      stockName: stockPkg ? (stockPkg.includes('launcherx') ? 'Google TV' : stockPkg.includes('tvlauncher') || stockPkg.includes('leanback') ? 'Android TV' : stockPkg) : 'inconnu',
      options: catalog.launchers.map((l) => ({ ...l, installed: installed.has(l.pkg) && !pk.disabled.has(l.pkg), isHome: homePkgs.has(l.pkg), current: stockPkg === l.pkg })),
      others: homes.filter((c) => !catalog.launchers.some((l) => c.startsWith(`${l.pkg}/`)) && !c.startsWith(`${stockPkg}/`)),
      // Sur Fire TV, Amazon empêche de remplacer durablement l'écran d'accueil
      fireTv: isFireTv(dev),
    };
  }

  const checkedMem = apps.filter((a) => a.checked).reduce((s, a) => s + a.memMb, 0);
  return { level, mode, info: LEVELS[level], levels: LEVELS, settingsChanges, animSkipped, apps, launcher, ramFreeMb: ramFree, estimateMb: Math.round(checkedMem), cleanyourtv: CYT.summary(detected) };
}

// Fire TV (Amazon) : on ne touche pas aux animations, sinon les paramètres de la Fire TV deviennent inaccessibles
function isFireTv(dev) {
  return /amazon/i.test(`${(dev && dev.manufacturer) || ''} ${(dev && dev.brand) || ''}`);
}

// --- Application
const locks = new Map();
async function withLock(id, fn) {
  if (locks.get(id)) throw Object.assign(new Error('Une opération est déjà en cours sur cette TV.'), { code: 409 });
  locks.set(id, true);
  try { return await fn(); } finally { locks.delete(id); }
}

async function apply(target, dev, body) {
  const level = Math.min(3, Math.max(1, Number(body.level) || 1));
  const wanted = Array.isArray(body.apps) ? [...new Set(body.apps.map(String))] : [];
  return withLock(dev.id, async () => {
    const [pk, wifi, props] = await Promise.all([listPackages(target), wifiInfo(target), modelProps(target, dev)]);
    const installed = new Set([...pk.system, ...pk.user]);
    const detected = CYT.detect(props);
    const cytKept = (pkg) => CYT.keptBy(detected.models, pkg);

    // Validation avant toute modification
    const refused = [];
    const toDisable = [];
    const wifiKept = [];
    for (const pkg of wanted) {
      const meta = byPkg.get(pkg);
      if (!installed.has(pkg)) refused.push({ pkg, reason: 'non installée' });
      else if (pk.disabled.has(pkg)) continue;
      else if (wifi.owners.has(pkg)) wifiKept.push(pkg); // jamais : la TV perdrait son Wi-Fi
      else if (isProtected(pkg) && !meta) refused.push({ pkg, reason: 'protégée' });
      else if (!meta && cytKept(pkg)) refused.push({ pkg, reason: 'gardée par CleanYourTV sur ce modèle' });
      else if (meta && meta.level > level) refused.push({ pkg, reason: `réservée au niveau ${meta.level}` });
      else if (!meta && level < 2) refused.push({ pkg, reason: 'réservée au niveau 2' });
      else if (meta && meta.risk === 'warn' && !body.allowWarn) refused.push({ pkg, reason: 'déconseillée : confirmation requise' });
      else toDisable.push(pkg);
    }
    if (refused.length && !body.skipRefused) {
      throw Object.assign(new Error(`Certaines applis ne peuvent pas être retirées : ${refused.map((r) => `${r.pkg} (${r.reason})`).join(', ')}`), { code: 400, refused });
    }

    const snap = { id: Date.now().toString(36), at: new Date().toISOString(), level, settings: {}, apps: [], home: null, log: [], restored: false };
    snap.ramBefore = await ramFreeMb(target);
    const log = (ok, text) => snap.log.push({ ok, text });

    // 1. Animations (jamais sur une Fire TV)
    const before = await getSettings(target);
    if (isFireTv(dev)) log(true, 'Animations conservées (Fire TV : nécessaire pour accéder à ses paramètres)');
    for (const key of isFireTv(dev) ? [] : ANIMATION_KEYS) {
      if (before[key] === ANIMATION_TARGET) continue;
      const r = await A.shell(target, `settings put global ${key} ${ANIMATION_TARGET}`);
      if (r.ok) { snap.settings[key] = before[key] || 'null'; log(true, `Animation ${key} → ${ANIMATION_TARGET}`); } else log(false, `Animation ${key} : ${r.err || 'échec'}`);
    }

    // 2. Nettoyage mémoire et caches (sans effet durable, pas besoin de restauration)
    const trim = await A.shell(target, 'pm trim-caches 999G', { timeout: 60000 });
    log(trim.ok, trim.ok ? 'Caches des applis vidés' : `Vidage des caches : ${trim.err || 'échec'}`);
    const kill = await A.shell(target, 'am kill-all');
    log(kill.ok, kill.ok ? 'Applis en arrière-plan fermées' : `Fermeture des applis : ${kill.err || 'échec'}`);

    // 3. Applis
    for (const pkg of wifiKept) log(true, `${byPkg.get(pkg)?.name || pkg} conservée : elle a enregistré le Wi-Fi de la TV`);
    for (const pkg of toDisable) {
      const r = await A.shell(target, `pm disable-user --user 0 ${pkg}`, { timeout: 20000 });
      const ok = /disabled/.test(r.out);
      if (ok) snap.apps.push(pkg);
      log(ok, `${byPkg.get(pkg)?.name || pkg} ${ok ? 'désactivée' : `: ${r.err || r.out || 'échec'}`}`);
    }
    if (toDisable.length && wifi.ok && wifi.networks) {
      const after = await wifiInfo(target);
      if (after.ok) log(after.networks >= wifi.networks, after.networks >= wifi.networks ? 'Wi-Fi : réseaux enregistrés conservés' : `Wi-Fi : ${wifi.networks - after.networks} réseau(x) enregistré(s) perdu(s), à ressaisir dans les paramètres`);
    }

    // 4. Lanceur
    if (level >= 3 && body.launcher && body.launcher.pkg) {
      const pkg = String(body.launcher.pkg);
      const homes = await homeActivities(target);
      const comp = homes.find((c) => c.startsWith(`${pkg}/`));
      const previous = await currentHome(target);
      if (!comp) {
        log(false, `Le lanceur ${pkg} n'est pas installé sur la TV`);
      } else {
        const r = await A.shell(target, `cmd package set-home-activity ${comp}`);
        if (/Success/i.test(r.out)) {
          snap.home = { before: previous, after: comp, stockDisabled: null };
          log(true, `Nouveau lanceur par défaut : ${comp.split('/')[0]}`);
          const stock = previous ? previous.split('/')[0] : '';
          if (body.launcher.disableStock && stock && stock !== pkg) {
            const d = await A.shell(target, `pm disable-user --user 0 ${stock}`);
            if (/disabled/.test(d.out)) { snap.home.stockDisabled = stock; log(true, `Lanceur d'origine désactivé (${stock})`); } else log(false, `Désactivation du lanceur d'origine : ${d.err || d.out || 'échec'}`);
          }
          await A.shell(target, 'input keyevent KEYCODE_HOME');
        } else {
          log(false, `Changement de lanceur refusé par la TV : ${r.err || r.out || 'échec'}. Choisis-le à la main avec le bouton Accueil.`);
        }
      }
    }

    await A.sleep(3000);
    snap.ramAfter = await ramFreeMb(target);
    const hist = store.history(dev.id);
    hist.unshift(snap);
    store.saveHistory(dev.id, hist);
    return { snapshot: snap, refused };
  });
}

// --- Restauration : un instantané, une appli d'un instantané, ou tout
async function restore(target, dev, { snapshot = 'all', pkg = null } = {}) {
  return withLock(dev.id, async () => {
    const hist = store.history(dev.id);
    const todo = hist.filter((s) => !s.restored && (snapshot === 'all' || s.id === snapshot));
    if (!todo.length) throw Object.assign(new Error('Rien à restaurer.'), { code: 400 });
    const log = [];

    if (pkg) {
      const snap = todo[0];
      if (!snap.apps.includes(pkg) && snap.home?.stockDisabled !== pkg) throw Object.assign(new Error("Cette appli ne fait pas partie de l'instantané."), { code: 400 });
      const r = await A.shell(target, `pm enable ${pkg}`);
      const ok = /enabled/.test(r.out);
      log.push({ ok, text: `${byPkg.get(pkg)?.name || pkg} ${ok ? 'réactivée' : `: ${r.err || r.out}`}` });
      if (ok) {
        snap.apps = snap.apps.filter((p) => p !== pkg);
        if (snap.home?.stockDisabled === pkg) snap.home.stockDisabled = null;
      }
      store.saveHistory(dev.id, hist);
      return { log };
    }

    for (const snap of todo) { // du plus récent au plus ancien
      const pkgs = [...snap.apps];
      if (snap.home?.stockDisabled) pkgs.push(snap.home.stockDisabled);
      for (const p of pkgs) {
        const r = await A.shell(target, `pm enable ${p}`);
        const ok = /enabled/.test(r.out);
        log.push({ ok, text: `${byPkg.get(p)?.name || p} ${ok ? 'réactivée' : `: ${r.err || r.out}`}` });
      }
      if (snap.home?.before) {
        const r = await A.shell(target, `cmd package set-home-activity ${snap.home.before}`);
        log.push({ ok: /Success/i.test(r.out), text: `Lanceur d'origine remis par défaut (${snap.home.before.split('/')[0]})` });
      }
      for (const [key, old] of Object.entries(snap.settings)) {
        const cmd = !old || old === 'null' ? `settings delete global ${key}` : `settings put global ${key} ${old}`;
        const r = await A.shell(target, cmd);
        log.push({ ok: r.ok, text: `Animation ${key} → ${!old || old === 'null' ? 'valeur par défaut' : old}` });
      }
      snap.restored = true;
      snap.restoredAt = new Date().toISOString();
    }
    store.saveHistory(dev.id, hist);
    if (todo.some((s) => s.home)) await A.shell(target, 'input keyevent KEYCODE_HOME');
    return { log };
  });
}

// Lanceur de la galerie : APK installée directement s'il n'est pas sur les stores, sinon fiche du store ouverte
async function openStore(target, pkg, dev) {
  const l = catalog.launchers.find((x) => x.pkg === pkg);
  if (!l) throw Object.assign(new Error('Appli inconnue.'), { code: 400 });
  if (l.apk) {
    await require('./apps').installApk(target, l.apk);
    return { ok: true, mode: 'apk' };
  }
  await require('./apps').openStore(target, dev, pkg);
  return { ok: true, mode: 'store' };
}

// --- Contrôle : niveau d'optimisation réellement atteint par la TV (même si elle a été optimisée ailleurs)
const STOCK_LAUNCHERS = new Set(['com.google.android.apps.tv.launcherx', 'com.google.android.tvlauncher', 'com.google.android.leanbacklauncher']);

async function audit(target, dev) {
  const [pk, settings, home] = await Promise.all([listPackages(target), getSettings(target), currentHome(target)]);
  const installed = new Set([...pk.system, ...pk.user]);
  const scale = (k) => { const v = parseFloat(settings[k]); return Number.isFinite(v) ? v : 1; };
  const animSkipped = isFireTv(dev);
  const animOk = animSkipped || ANIMATION_KEYS.every((k) => scale(k) <= 0.5);

  const count = (filter) => {
    const list = catalog.apps.filter((a) => installed.has(a.pkg) && filter(a));
    return { total: list.length, done: list.filter((a) => pk.disabled.has(a.pkg)).length, left: list.filter((a) => !pk.disabled.has(a.pkg)).map((a) => a.name) };
  };
  const telemetry = count((a) => a.level === 1);
  const safe = count((a) => a.level === 2 && a.risk === 'safe');
  const optional = count((a) => a.level === 2 && a.risk !== 'safe');

  const homePkg = home ? home.split('/')[0] : '';
  const altLauncher = catalog.launchers.find((l) => l.pkg === homePkg);
  const launcher = { pkg: homePkg, alternative: !!altLauncher || (!!homePkg && !STOCK_LAUNCHERS.has(homePkg) && !/launcher|home|tvhome/i.test(homePkg)), name: altLauncher ? altLauncher.name : homePkg };

  // Un niveau est atteint quand tout ce qu'il recommande est fait ; « partiel » quand une partie seulement l'est
  const n1 = animOk && telemetry.done === telemetry.total;
  const n1Partial = !n1 && (animOk || telemetry.done > 0);
  const n2 = n1 && safe.done === safe.total && safe.total + optional.done > 0;
  const n2Partial = !n2 && safe.done + optional.done > 0;
  const n3 = n2 && launcher.alternative;
  const level = n3 ? 3 : n2 ? 2 : n1 ? 1 : 0;
  const partial = level === 0 ? n1Partial || n2Partial : level === 1 ? n2Partial : level === 2 ? launcher.alternative : false;

  // Recommandation : le prochain gain possible
  let next = null;
  if (!animOk || telemetry.done < telemetry.total) next = { level: 1, text: `${!animOk ? 'Accélérer les animations' : ''}${!animOk && telemetry.done < telemetry.total ? ' et ' : ''}${telemetry.done < telemetry.total ? `couper ${telemetry.total - telemetry.done} service${telemetry.total - telemetry.done > 1 ? 's' : ''} de télémétrie` : ''}.` };
  else if (safe.done < safe.total) next = { level: 2, text: `${safe.total - safe.done} appli${safe.total - safe.done > 1 ? 's' : ''} inutile${safe.total - safe.done > 1 ? 's' : ''} sans risque encore active${safe.total - safe.done > 1 ? 's' : ''}.` };
  else if (!launcher.alternative) next = { level: 3, text: "Remplacer l'écran d'accueil d'origine par un lanceur léger, sans publicité (optionnel)." };

  return {
    at: new Date().toISOString(),
    level, partial,
    checks: { animations: { ok: animOk, skipped: animSkipped, values: ANIMATION_KEYS.map((k) => settings[k] && settings[k] !== 'null' ? settings[k] : '1.0') }, telemetry, safe, optional, launcher },
    next,
  };
}

module.exports = { plan, apply, restore, openStore, audit, LEVELS, catalog, isProtected };
