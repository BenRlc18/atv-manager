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
// Recherche Wi-Fi et Bluetooth permanente (sert à la localisation) : inutile sur une TV ; les télécommandes ne sont pas concernées
const SCAN_KEYS = ['wifi_scan_always_enabled', 'ble_scan_always_enabled'];
// DNS anti-pub (option) : DNS privé d'Android 9 et plus, bloque pubs et pisteurs sans rien installer
const DNS_KEYS = ['private_dns_mode', 'private_dns_specifier'];
const DNS = { host: 'dns.adguard-dns.com', name: 'AdGuard DNS' };
const SETTING_LABELS = {
  wifi_scan_always_enabled: 'Recherche Wi-Fi en arrière-plan',
  ble_scan_always_enabled: 'Recherche Bluetooth en arrière-plan',
  private_dns_mode: 'DNS privé',
  private_dns_specifier: 'Serveur DNS privé',
};
const settingLabel = (key) => SETTING_LABELS[key] || `Animation ${key}`;

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

// Claviers de la TV (par défaut et activés) : jamais coupés, sinon plus aucune saisie possible
async function imeInfo(target) {
  const r = await A.shell(target, 'settings get secure default_input_method; settings get secure enabled_input_methods', { timeout: 8000 });
  return new Set([...r.out.matchAll(/([\w.]+)\//g)].map((m) => m[1]));
}
const IME_WHY = 'Clavier de la TV : le couper empêcherait toute saisie (recherche, mots de passe).';

// Applis système mises à jour (copie dans /data/app) et place prise par la mise à jour, en Mo
async function updatedSizes(target, pkgs) {
  const list = [...pkgs].filter((p) => /^[\w.]+$/.test(p));
  if (!list.length) return new Map();
  const r = await A.shell(target, `for p in ${list.join(' ')}; do f=$(pm path $p 2>/dev/null | grep -m1 /data/app/ | cut -d: -f2); [ -n "$f" ] && echo "$p=$(du -sk "\${f%/*}" | cut -f1)"; done`, { timeout: 60000 });
  return new Map(Object.entries(A.parseKv(r.out)).map(([p, kb]) => [p, Math.round((Number(kb) || 0) / 1024)]));
}

// Applis autorisées ou non à tourner en arrière-plan (appop RUN_ANY_IN_BACKGROUND)
async function backgroundState(target, pkgs) {
  const list = [...pkgs].filter((p) => /^[\w.]+$/.test(p));
  if (!list.length) return new Map();
  const r = await A.shell(target, `for p in ${list.join(' ')}; do echo "$p=$(cmd appops get $p RUN_ANY_IN_BACKGROUND 2>/dev/null | head -1)"; done`, { timeout: 30000 });
  return new Map(Object.entries(A.parseKv(r.out)).map(([p, v]) => [p, /ignore|deny/.test(v)]));
}
const plural2 = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const BG = catalog.background || { suggested: [], never: [] };
const bgSuggested = new Map(BG.suggested.map((b) => [b.pkg, b]));
const bgNever = new Set(BG.never);

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

// Activité au premier plan (après un appui sur Accueil), ex. « com.overdevs.at4k/.MainActivity » ; '' si illisible
async function resumedActivity(target) {
  const r = await A.shell(target, 'dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity"', { timeout: 10000 });
  const m = r.out.match(/u\d+ ([\w.]+\/[\w.$]+)/);
  return m ? m[1] : '';
}

const stockLabel = (p) => (!p ? 'inconnu' : p.includes('launcherx') ? 'Google TV' : p.includes('tvlauncher') || p.includes('leanback') ? 'Android TV' : p);

// Applis système connues pour reprendre le bouton Accueil quand l'accueil d'origine est désactivé.
// setupwraith (Google TV) : sa RecoveryActivity (HOME, priorité 1) passe devant tout lanceur ajouté (CleanYourTV :
// xiaomi-mitv-afmu1, chromecast-gtv, kirkwood...). Il faut la désactiver AVANT l'accueil d'origine, mais si elle a
// enregistré le réseau Wi-Fi, Android l'efface avec elle : la TV distante serait perdue.
const HOME_RIVALS = {
  'com.google.android.tungsten.setupwraith': "à réactiver pour réappairer la télécommande",
};
const isRemote = (dev) => !!dev && (dev.transport === 'agent' || !!dev.remote);

// Peut-on désactiver l'accueil d'origine sans risque de bloquer la TV ?
// Renvoie { ok, rivals (à désactiver d'abord), why }. pkg : nouveau lanceur (null pour l'aperçu).
function stockCheck({ dev, pk, wifi, homes, pkg, stock, models = [] }) {
  const launcherPkgs = new Set(catalog.launchers.map((l) => l.pkg));
  const active = (p) => pk.system.has(p) && !pk.disabled.has(p);
  const rivals = new Set(homes.map((c) => c.split('/')[0]).filter((p) => active(p) && p !== stock && p !== pkg && !launcherPkgs.has(p)));
  for (const p of Object.keys(HOME_RIVALS)) if (active(p) && p !== stock) rivals.add(p);
  const keep = (why) => ({ ok: false, rivals: [], why: `Accueil d'origine conservé : ${why}` });
  const limit = `Le nouveau lanceur reste l'accueil par défaut, mais le bouton Accueil peut parfois rouvrir ${stockLabel(stock)}.`;
  if (stock && wifi.owners.has(stock)) return keep(`il a enregistré le réseau Wi-Fi de la TV. ${limit}`);
  if (!rivals.size) return { ok: true, rivals: [], why: '' };
  const list = [...rivals];
  const name = (p) => byPkg.get(p)?.name || p;
  const wifiOwner = list.find((p) => wifi.owners.has(p));
  if (wifiOwner) {
    return keep(`${name(wifiOwner)} reprendrait le bouton Accueil si l'accueil d'origine était désactivé, et il a enregistré le réseau Wi-Fi de la TV (le désactiver effacerait le Wi-Fi). ${limit} Pour aller plus loin : oublie puis ressaisis le réseau Wi-Fi dans les paramètres de la TV, devant elle.`);
  }
  if (!wifi.ok) return keep(`${list.map(name).join(', ')} reprendrai${list.length > 1 ? 'ent' : 't'} le bouton Accueil et le Wi-Fi de la TV n'a pas pu être vérifié. ${limit}`);
  const unknown = list.find((p) => !HOME_RIVALS[p] || isProtected(p) || CYT.criticalFor(models, p));
  if (unknown) return keep(`${name(unknown)} déclare aussi un écran d'accueil et pourrait reprendre le bouton Accueil ; on ne la désactive pas sans la connaître. ${limit}`);
  if (isRemote(dev)) return keep(`${list.map(name).join(', ')} reprendrai${list.length > 1 ? 'ent' : 't'} le bouton Accueil si l'accueil d'origine était désactivé, et ${list.length > 1 ? 'les' : 'le'} désactiver à distance est trop risqué. ${limit}`);
  return { ok: true, rivals: list, why: '' };
}

// Propriétés de l'appareil utiles à la reconnaissance du modèle CleanYourTV (en plus de celles de dev)
async function modelProps(target, dev) {
  const r = await A.shell(target, 'echo name=$(getprop ro.product.name); echo product=$(getprop ro.build.product); echo fingerprint=$(getprop ro.build.fingerprint)', { timeout: 8000 });
  return CYT.deviceProps(dev, A.parseKv(r.out));
}
const CYT_CRITICAL = /webview|inputmethod|\.ime$|keyboard|packageinstaller|bluetooth|setupwraith|launcher|tvhome/i;
const CYT_LOSS = "Non documentée en français : lis la note de CleanYourTV (en anglais) avant de la retirer.";

async function getSettings(target) {
  const keys = [...ANIMATION_KEYS, ...SCAN_KEYS, ...DNS_KEYS];
  const r = await A.shell(target, `${keys.map((k) => `echo ${k}=$(settings get global ${k})`).join('; ')}; echo sdk=$(getprop ro.build.version.sdk)`, { timeout: 8000 });
  return A.parseKv(r.out);
}

// État du DNS anti-pub : disponible (Android 9+), déjà actif, ou un autre DNS privé choisi par la personne
function dnsState(settings) {
  const custom = settings.private_dns_mode === 'hostname' ? settings.private_dns_specifier || '' : '';
  return { name: DNS.name, host: DNS.host, available: Number(settings.sdk) >= 28, active: custom === DNS.host, other: custom && custom !== DNS.host ? custom : '' };
}

const LEVELS = {
  1: {
    title: 'Léger',
    summary: "Accélère la TV sans retirer d'applis.",
    gains: ['Menus et transitions plus rapides (animations à 0,5x)', 'Applis recompilées : elles démarrent plus vite', 'Recherche Wi-Fi et Bluetooth en arrière-plan coupée', 'Télémétrie coupée', 'En option : DNS anti-pub'],
    losses: ['Pratiquement rien : les statistiques envoyées au fabricant et à Google'],
  },
  2: {
    title: 'Moyen',
    summary: 'Niveau léger + désactivation des applis inutiles.',
    gains: ['Tout le niveau léger', 'Mémoire libérée durablement : les applis désactivées ne tournent plus du tout', 'Applis gardées mais peu utilisées bloquées en arrière-plan (au choix)', "Moins de mises à jour et de publicité en arrière-plan", 'En option : stockage récupéré (mises à jour des applis désactivées)'],
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
  const [pk, mem, settings, ramFree, wifi, props, ime] = await Promise.all([listPackages(target), memoryByPackage(target), getSettings(target), ramFreeMb(target), wifiInfo(target), modelProps(target, dev), imeInfo(target)]);
  const installed = new Set([...pk.system, ...pk.user]);
  const memMb = (pkg) => Math.round(((mem.get(pkg) || 0) / 1024) * 10) / 10;
  const wifiLock = (a) => (a.disabled ? a
    : wifi.owners.has(a.pkg) ? { ...a, risk: 'protected', why: WIFI_WHY, checked: false, locked: true }
      : ime.has(a.pkg) ? { ...a, risk: 'protected', why: IME_WHY, checked: false, locked: true } : a);

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
      stockName: stockLabel(stockPkg),
      options: catalog.launchers.map((l) => ({ ...l, installed: installed.has(l.pkg) && !pk.disabled.has(l.pkg), isHome: homePkgs.has(l.pkg), current: stockPkg === l.pkg })),
      others: homes.filter((c) => !catalog.launchers.some((l) => c.startsWith(`${l.pkg}/`)) && !c.startsWith(`${stockPkg}/`)),
      // Sur Fire TV, Amazon empêche de remplacer durablement l'écran d'accueil
      fireTv: isFireTv(dev),
    };
    // L'accueil d'origine peut-il être désactivé sans bloquer le bouton Accueil ? (sinon : case à griser, raison affichée)
    const chk = stockCheck({ dev, pk, wifi, homes, pkg: null, stock: stockPkg, models: detected.models });
    launcher.stockDisable = { allowed: chk.ok, why: chk.why, rivals: chk.rivals };
  }

  // Niveau 2 et plus : stockage récupérable (mises à jour des applis système désactivées) et applis gardées
  // qu'on peut empêcher de tourner en arrière-plan
  let storage = null;
  let background = [];
  if (level >= 2) {
    // Seulement les applis système : une appli installée par l'utilisateur n'a pas de « version d'usine »
    const sysCandidates = new Set([...apps.filter((a) => !a.locked).map((a) => a.pkg), ...pk.disabled].filter((p) => pk.system.has(p)));
    for (const p of sysCandidates) if (isProtected(p) || wifi.owners.has(p) || ime.has(p)) sysCandidates.delete(p);
    const upd = await updatedSizes(target, sysCandidates);
    for (const a of apps) if (upd.has(a.pkg)) a.updMb = upd.get(a.pkg);
    const already = [...pk.disabled].filter((p) => upd.has(p));
    storage = { sdk: Number(settings.sdk) || 0, disabledMb: already.reduce((s, p) => s + upd.get(p), 0), disabledCount: already.length };

    const keep = [...pk.user].filter((p) => !pk.disabled.has(p) && !bgNever.has(p) && !homePkgs.has(p) && !ime.has(p) && !isProtected(p));
    const state = await backgroundState(target, keep);
    background = keep.map((p) => {
      const s = bgSuggested.get(p);
      return { pkg: p, name: s ? s.name : p, why: s ? s.why : '', memMb: memMb(p), restricted: !!state.get(p), checked: !state.get(p) && !!(s && s.default) };
    }).sort((x, y) => Number(!!bgSuggested.get(y.pkg)) - Number(!!bgSuggested.get(x.pkg)) || x.name.localeCompare(y.name));
  }

  const checkedMem = apps.filter((a) => a.checked).reduce((s, a) => s + a.memMb, 0);
  const scanChanges = SCAN_KEYS.filter((k) => settings[k] !== '0').map((k) => ({ key: k, label: SETTING_LABELS[k], from: settings[k] && settings[k] !== 'null' ? settings[k] : 'défaut', to: '0' }));
  return {
    level, mode, info: LEVELS[level], levels: LEVELS, settingsChanges, scanChanges, dns: dnsState(settings), animSkipped, apps, launcher, storage, background,
    ramFreeMb: ramFree, estimateMb: Math.round(checkedMem), cleanyourtv: CYT.summary(detected),
  };
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
    const [pk, wifi, props, ime] = await Promise.all([listPackages(target), wifiInfo(target), modelProps(target, dev), imeInfo(target)]);
    const installed = new Set([...pk.system, ...pk.user]);
    const detected = CYT.detect(props);
    const cytKept = (pkg) => CYT.keptBy(detected.models, pkg);
    const homesNow = new Set((await homeActivities(target)).map((c) => c.split('/')[0]));
    // Applis gardées à bloquer en arrière-plan : seulement des applis installées, jamais une appli indispensable
    const bgWanted = Array.isArray(body.background) ? [...new Set(body.background.map(String))]
      .filter((p) => pk.user.has(p) && !pk.disabled.has(p) && !bgNever.has(p) && !homesNow.has(p) && !ime.has(p) && !isProtected(p)) : [];

    // Validation avant toute modification
    const refused = [];
    const toDisable = [];
    const wifiKept = [];
    for (const pkg of wanted) {
      const meta = byPkg.get(pkg);
      if (!installed.has(pkg)) refused.push({ pkg, reason: 'non installée' });
      else if (pk.disabled.has(pkg)) continue;
      else if (wifi.owners.has(pkg)) wifiKept.push(pkg); // jamais : la TV perdrait son Wi-Fi
      else if (ime.has(pkg)) refused.push({ pkg, reason: 'clavier de la TV' });
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

    const snap = { id: Date.now().toString(36), at: new Date().toISOString(), level, settings: {}, secure: {}, apps: [], background: [], reclaimed: [], home: null, log: [], restored: false };
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

    // 1 bis. Recherche Wi-Fi / Bluetooth en arrière-plan coupée
    for (const key of SCAN_KEYS) {
      if (before[key] === '0') continue;
      const r = await A.shell(target, `settings put global ${key} 0`);
      if (r.ok) { snap.settings[key] = before[key] || 'null'; log(true, `${SETTING_LABELS[key]} coupée`); } else log(false, `${SETTING_LABELS[key]} : ${r.err || 'échec'}`);
    }

    // 2. Nettoyage mémoire et caches : effet immédiat mais temporaire (Android relance une partie des applis)
    const trim = await A.shell(target, 'pm trim-caches 999G', { timeout: 60000 });
    log(trim.ok, trim.ok ? 'Caches des applis vidés (temporaire : ils se reconstituent à l’usage)' : `Vidage des caches : ${trim.err || 'échec'}`);
    const kill = await A.shell(target, 'am kill-all');
    log(kill.ok, kill.ok ? 'Applis en arrière-plan fermées (temporaire : Android en relance certaines)' : `Fermeture des applis : ${kill.err || 'échec'}`);
    // Fichiers laissés sur la TV par d'anciennes versions d'ATVM (captures, inspection d'écran)
    await A.shell(target, 'rm -f /sdcard/atvm.png /sdcard/ui.xml');

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

    // 3 bis. Économiseur d'écran : s'il pointe vers une appli désactivée (Mode Ambiant coupé), on passe sur
    // l'économiseur basique ; s'il est coupé lui aussi, on désactive l'économiseur plutôt que de laisser un réglage cassé
    const disabledNow = (await listPackages(target)).disabled;
    const ss = await A.shell(target, 'echo c=$(settings get secure screensaver_components); echo e=$(settings get secure screensaver_enabled)');
    const ssKv = A.parseKv(ss.out);
    const ssPkg = (ssKv.c || '').split('/')[0];
    if (ssPkg && ssPkg !== 'null' && disabledNow.has(ssPkg)) {
      snap.secure.screensaver_components = ssKv.c;
      if (!disabledNow.has('com.android.dreams.basic')) {
        await A.shell(target, 'settings put secure screensaver_components com.android.dreams.basic/.Colors');
        log(true, "Économiseur d'écran : Mode Ambiant coupé, remplacé par l'économiseur basique (très léger)");
      } else {
        snap.secure.screensaver_enabled = ssKv.e || 'null';
        await A.shell(target, 'settings put secure screensaver_enabled 0');
        log(true, "Économiseur d'écran désactivé : aucun économiseur n'est plus actif sur la TV");
      }
    }

    // 3 ter. Applis gardées : plus de démarrage en arrière-plan (elles marchent normalement quand on les ouvre)
    for (const pkg of bgWanted) {
      const r = await A.shell(target, `cmd appops set ${pkg} RUN_ANY_IN_BACKGROUND ignore && am set-standby-bucket ${pkg} restricted`);
      if (r.ok) snap.background.push(pkg);
      log(r.ok, `${bgSuggested.get(pkg)?.name || pkg} ${r.ok ? 'ne tourne plus en arrière-plan' : `: ${r.err || 'échec'}`}`);
    }

    // 3 quater. Stockage (option) : les applis système désactivées reviennent à leur version d'usine,
    // ce qui supprime leurs mises à jour de /data. Réactivées, elles se remettent à jour par le Play Store
    if (body.reclaim && level >= 2) {
      const pkAfter = await listPackages(target);
      const cands = [...pkAfter.disabled].filter((p) => pkAfter.system.has(p) && !isProtected(p) && !wifi.owners.has(p) && !ime.has(p));
      const upd = await updatedSizes(target, cands);
      let freed = 0;
      for (const [pkg, mb] of upd) {
        const r = await A.shell(target, `pm uninstall-system-updates ${pkg}`, { timeout: 60000 });
        if (!/Success/i.test(r.out)) { log(false, `${byPkg.get(pkg)?.name || pkg} : mise à jour non retirée (${r.err || r.out || 'échec'})`); continue; }
        // Revenir à la version d'usine peut réactiver l'appli : on la désactive de nouveau
        const st = await A.shell(target, `pm list packages -d | grep -qx "package:${pkg}" || pm disable-user --user 0 ${pkg}`);
        snap.reclaimed.push(pkg);
        freed += mb;
        log(st.ok, `${byPkg.get(pkg)?.name || pkg} : mise à jour retirée (${mb} Mo)`);
      }
      log(true, upd.size ? `Stockage récupéré : environ ${freed} Mo` : 'Stockage : aucune mise à jour à retirer');
    }

    // 3 quinquies. DNS anti-pub (option) ; annulé tout de suite si la TV n'arrive plus à joindre Internet
    if (body.dns) {
      const dns = dnsState(before);
      if (!dns.available) log(false, 'DNS anti-pub : demande Android 9 ou plus récent');
      else if (dns.active) log(true, `DNS anti-pub déjà actif (${DNS.name})`);
      else {
        for (const key of DNS_KEYS) snap.settings[key] = before[key] || 'null';
        await A.shell(target, `settings put global private_dns_specifier ${DNS.host}; settings put global private_dns_mode hostname`);
        const t = await A.shell(target, 'sleep 3; ping -c 1 -W 5 www.google.com >/dev/null 2>&1 && echo ok || echo ko', { timeout: 20000 });
        if (/ok/.test(t.out)) log(true, `DNS anti-pub activé (${DNS.name}) : pubs et pisteurs bloqués dans la plupart des applis`);
        else {
          await A.shell(target, DNS_KEYS.map((k) => (snap.settings[k] === 'null' ? `settings delete global ${k}` : `settings put global ${k} ${snap.settings[k]}`)).join('; '));
          for (const key of DNS_KEYS) delete snap.settings[key];
          log(false, "DNS anti-pub annulé : la TV n'arrivait plus à joindre Internet avec ce DNS");
        }
      }
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
          snap.home = { before: previous, after: comp, stockDisabled: null, rivalsDisabled: [] };
          await launcherStep(target, dev, { pkg, comp, previous, homes, wifi, models: detected.models, disableStock: !!body.launcher.disableStock, snap, log });
        } else {
          log(false, `Changement de lanceur refusé par la TV : ${r.err || r.out || 'échec'}. Choisis-le à la main avec le bouton Accueil.`);
        }
      }
    }

    await A.sleep(3000);
    snap.ramAfter = await ramFreeMb(target);

    // 5. Recompilation des applis, détachée sur la TV : plusieurs minutes, sans bloquer les autres commandes
    const dex = await A.shell(target, "nohup sh -c 'cmd package bg-dexopt-job' >/dev/null 2>&1 &", { timeout: 10000 });
    log(dex.ok, dex.ok ? 'Recompilation des applis lancée : elles démarreront plus vite (quelques minutes, la TV peut ralentir pendant ce temps)' : `Recompilation des applis : ${dex.err || 'échec'}`);
    const hist = store.history(dev.id);
    hist.unshift(snap);
    store.saveHistory(dev.id, hist);
    return { snapshot: snap, refused };
  });
}

// Nouveau lanceur choisi (set-home-activity accepté) : vérifie qui résout réellement HOME, puis désactive
// éventuellement l'accueil d'origine, avec contrôle après coup et retour arrière automatique.
async function launcherStep(target, dev, { pkg, comp, previous, homes, wifi, models, disableStock, snap, log }) {
  const short = (c) => (c ? c.split('/')[0] : 'aucun accueil');
  await A.sleep(1000);
  const now = await currentHome(target);
  const stock = previous ? previous.split('/')[0] : '';
  if (now !== comp) {
    log(false, `La TV a accepté ${pkg} comme accueil, mais le bouton Accueil mène encore à ${short(now)}. Choisis le lanceur à la main avec le bouton Accueil.${disableStock && stock && stock !== pkg ? " L'accueil d'origine n'a pas été désactivé." : ''}`);
    await A.shell(target, 'input keyevent KEYCODE_HOME');
    return;
  }
  log(true, `Nouveau lanceur par défaut : ${pkg} (vérifié)`);
  if (!disableStock || !stock || stock === pkg) { await A.shell(target, 'input keyevent KEYCODE_HOME'); return; }

  // État à jour (des applis viennent peut-être d'être désactivées à l'étape 3)
  const pk = await listPackages(target);
  const chk = stockCheck({ dev, pk, wifi, homes, pkg, stock, models });
  if (!chk.ok) { log(false, chk.why); await A.shell(target, 'input keyevent KEYCODE_HOME'); return; }

  const name = (p) => byPkg.get(p)?.name || p;
  // Retour arrière : accueil d'origine et applis rivales réactivés, nouveau lanceur remis par défaut (sinon l'ancien)
  const rollback = async (reason) => {
    const back = [];
    if (snap.home.stockDisabled) back.push(snap.home.stockDisabled);
    back.push(...[...snap.home.rivalsDisabled].reverse());
    const failed = [];
    for (const p of back) {
      const e = await A.shell(target, `pm enable ${p}`);
      if (!/enabled/.test(e.out)) failed.push(p);
    }
    snap.home.stockDisabled = null;
    snap.home.rivalsDisabled = [];
    await A.shell(target, `cmd package set-home-activity ${comp}`);
    await A.sleep(1000);
    let home = await currentHome(target);
    if (home !== comp && previous) {
      await A.shell(target, `cmd package set-home-activity ${previous}`);
      await A.sleep(1000);
      home = await currentHome(target);
    }
    if (home !== comp) snap.home.after = home || previous;
    log(false, `Échec : ${reason}. Retour arrière automatique : ${back.map(name).join(', ')} réactivé${back.length > 1 ? 's' : ''}${failed.length ? ` (sauf ${failed.join(', ')} : à réactiver d'urgence depuis l'historique)` : ''} ; le bouton Accueil mène maintenant à ${short(home)}.`);
  };

  // Applis qui reprendraient le bouton Accueil : désactivées AVANT l'accueil d'origine (TV locale seulement)
  for (const p of chk.rivals) {
    const d = await A.shell(target, `pm disable-user --user 0 ${p}`, { timeout: 20000 });
    if (!/disabled/.test(d.out)) {
      await rollback(`${name(p)} (qui reprendrait le bouton Accueil) n'a pas pu être désactivée (${d.err || d.out || 'échec'}) ; l'accueil d'origine n'a pas été touché`);
      await A.shell(target, 'input keyevent KEYCODE_HOME');
      return;
    }
    snap.home.rivalsDisabled.push(p);
    log(true, `${name(p)} désactivée : elle reprenait le bouton Accueil${HOME_RIVALS[p] ? ` (${HOME_RIVALS[p]})` : ''}`);
  }
  if (chk.rivals.length && wifi.ok && wifi.networks) {
    const w = await wifiInfo(target);
    if (w.ok && w.networks < wifi.networks) log(false, `Wi-Fi : ${wifi.networks - w.networks} réseau(x) enregistré(s) perdu(s), à ressaisir dans les paramètres`);
  }

  const d = await A.shell(target, `pm disable-user --user 0 ${stock}`);
  if (!/disabled/.test(d.out)) {
    log(false, `Désactivation du lanceur d'origine : ${d.err || d.out || 'échec'}`);
    if (snap.home.rivalsDisabled.length) await rollback("l'accueil d'origine n'a pas pu être désactivé");
    await A.shell(target, 'input keyevent KEYCODE_HOME');
    return;
  }
  snap.home.stockDisabled = stock;

  // Android peut oublier le choix d'accueil quand la liste des accueils change : on le redonne, puis on contrôle
  await A.shell(target, `cmd package set-home-activity ${comp}`);
  await A.sleep(1000);
  const after = await currentHome(target);
  if (after !== comp) {
    await rollback(`une fois l'accueil d'origine (${stock}) désactivé, le bouton Accueil menait à ${short(after)} au lieu de ${pkg}`);
    await A.shell(target, 'input keyevent KEYCODE_HOME');
    return;
  }

  // Contrôle réel : appui sur Accueil puis activité au premier plan. Une autre appli d'accueil au premier plan
  // (assistant d'installation...) veut dire que la TV est bloquée hors du nouveau lanceur.
  await A.shell(target, 'input keyevent KEYCODE_HOME');
  await A.sleep(2000);
  const top = await resumedActivity(target);
  const topPkg = top.split('/')[0];
  const homesNow = await homeActivities(target);
  const suspects = new Set([...homesNow.map((c) => c.split('/')[0]), ...Object.keys(HOME_RIVALS)]);
  suspects.delete(pkg);
  if (topPkg && suspects.has(topPkg)) {
    await rollback(`après un appui sur Accueil, la TV affichait ${top} au lieu de ${pkg}`);
    await A.shell(target, 'input keyevent KEYCODE_HOME');
    return;
  }
  log(true, `Lanceur d'origine désactivé (${stock}) ; le bouton Accueil mène bien à ${pkg}`);
}

// --- Restauration : un instantané, une appli d'un instantané, ou tout
async function restore(target, dev, { snapshot = 'all', pkg = null } = {}) {
  return withLock(dev.id, async () => {
    const hist = store.history(dev.id);
    const todo = hist.filter((s) => !s.restored && s.type !== 'reset-launcher' && (snapshot === 'all' || s.id === snapshot));
    if (!todo.length) throw Object.assign(new Error('Rien à restaurer.'), { code: 400 });
    const log = [];

    if (pkg) {
      const snap = todo[0];
      const rivals = snap.home?.rivalsDisabled || [];
      if (!snap.apps.includes(pkg) && snap.home?.stockDisabled !== pkg && !rivals.includes(pkg)) throw Object.assign(new Error("Cette appli ne fait pas partie de l'instantané."), { code: 400 });
      const r = await A.shell(target, `pm enable ${pkg}`);
      const ok = /enabled/.test(r.out);
      log.push({ ok, text: `${byPkg.get(pkg)?.name || pkg} ${ok ? 'réactivée' : `: ${r.err || r.out}`}` });
      if (ok) {
        snap.apps = snap.apps.filter((p) => p !== pkg);
        if (snap.home?.stockDisabled === pkg) snap.home.stockDisabled = null;
        if (snap.home) snap.home.rivalsDisabled = rivals.filter((p) => p !== pkg);
        // Une appli réactivée (assistant d'installation...) peut reprendre le bouton Accueil : on le vérifie
        await keepHome(target, hist, log);
      }
      store.saveHistory(dev.id, hist);
      return { log };
    }

    for (const snap of todo) { // du plus récent au plus ancien
      if (snap.type === 'plume') { // lanceur Plume : il rend le bouton Accueil au lanceur d'origine
        await require('./plume').undo(target, (ok, text) => log.push({ ok, text }));
        snap.restored = true;
        snap.restoredAt = new Date().toISOString();
        continue;
      }
      const pkgs = [...snap.apps];
      if (snap.home?.stockDisabled) pkgs.push(snap.home.stockDisabled);
      if (snap.home?.rivalsDisabled) pkgs.push(...snap.home.rivalsDisabled);
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
        log.push({ ok: r.ok, text: `${settingLabel(key)} → ${!old || old === 'null' ? 'valeur par défaut' : old}` });
      }
      for (const [key, old] of Object.entries(snap.secure || {})) {
        const r = await A.shell(target, !old || old === 'null' ? `settings delete secure ${key}` : `settings put secure ${key} ${old}`);
        log.push({ ok: r.ok, text: "Économiseur d'écran d'origine remis" });
      }
      for (const p of snap.background || []) {
        const r = await A.shell(target, `cmd appops set ${p} RUN_ANY_IN_BACKGROUND allow && am set-standby-bucket ${p} active`);
        log.push({ ok: r.ok, text: `${bgSuggested.get(p)?.name || p} de nouveau autorisée en arrière-plan` });
      }
      if ((snap.reclaimed || []).length) {
        log.push({ ok: true, text: `${plural2(snap.reclaimed.length, 'appli réactivée revient', 'applis réactivées reviennent')} en version d'usine : le Play Store les remettra à jour` });
      }
      snap.restored = true;
      snap.restoredAt = new Date().toISOString();
    }
    store.saveHistory(dev.id, hist);
    if (todo.some((s) => s.home)) await A.shell(target, 'input keyevent KEYCODE_HOME');
    return { log };
  });
}

// Après une réactivation isolée : le bouton Accueil doit toujours mener au lanceur choisi. Sinon, le choix
// est redonné ; s'il ne tient toujours pas et que l'accueil d'origine est désactivé, celui-ci est réactivé.
async function keepHome(target, hist, log) {
  const snap = hist.find((s) => !s.restored && s.home && s.home.after);
  if (!snap) return;
  let home = await currentHome(target);
  if (home === snap.home.after) return;
  await A.shell(target, `cmd package set-home-activity ${snap.home.after}`);
  await A.sleep(1000);
  home = await currentHome(target);
  if (home === snap.home.after) { log.push({ ok: true, text: `Accueil remis sur ${snap.home.after.split('/')[0]}` }); return; }
  for (const s of hist.filter((x) => !x.restored && x.home && x.home.stockDisabled)) {
    const p = s.home.stockDisabled;
    const r = await A.shell(target, `pm enable ${p}`);
    if (/enabled/.test(r.out)) s.home.stockDisabled = null;
    log.push({ ok: /enabled/.test(r.out), text: `Accueil d'origine réactivé (${p}) : sans lui, le bouton Accueil ne menait plus au lanceur choisi` });
  }
  await A.shell(target, `cmd package set-home-activity ${snap.home.after}`);
  await A.sleep(1000);
  home = await currentHome(target);
  log.push({ ok: !!home, text: `Le bouton Accueil mène à ${home ? home.split('/')[0] : 'aucun accueil'}` });
}

// --- Remettre le lanceur d'origine, à tout moment et sans passer par l'historique.
// Réactive les accueils d'origine désactivés (Google TV / Android TV, sinon celui du constructeur) et setupwraith
// (sans risque : il rend le Wi-Fi et l'appairage de la télécommande), redonne l'accueil au lanceur d'origine et
// vérifie. Le lanceur tiers reste installé et activé.
const GOOGLE_STOCK = ['com.google.android.apps.tv.launcherx', 'com.google.android.tvlauncher', 'com.google.android.leanbacklauncher'];

// Accueils déclarés par des applis désactivées (activités désactivées comprises) ; liste vide si la TV refuse l'option
async function disabledHomes(target, disabled) {
  const r = await A.shell(target, 'cmd package query-activities --brief --query-flags 0x8200 -a android.intent.action.MAIN -c android.intent.category.HOME', { timeout: 10000 });
  return [...new Set(component(r.out).map((c) => c.split('/')[0]))].filter((p) => disabled.has(p));
}

async function resetLauncher(target, dev) {
  return withLock(dev.id, async () => {
    const log = [];
    const add = (ok, text) => log.push({ ok, text });
    const pk = await listPackages(target);
    const installed = new Set([...pk.system, ...pk.user]);
    const hist = store.history(dev.id);
    // Accueils d'origine connus par l'historique (y compris celui d'un constructeur)
    const fromHist = hist.flatMap((s) => (s.home ? [s.home.stockDisabled, s.home.before && s.home.before.split('/')[0]] : [])).filter(Boolean);
    const googleStock = [...new Set([...GOOGLE_STOCK, ...STOCK_LAUNCHERS])].filter((p) => installed.has(p));
    const launcherPkgs = new Set(catalog.launchers.map((l) => l.pkg));
    // Accueils constructeur : seulement s'il n'y a pas d'accueil Google (ex. ne pas rallumer PatchWall sur un Mi Stick)
    const vendor = googleStock.length ? [] : (await disabledHomes(target, pk.disabled)).filter((p) => pk.system.has(p) && !launcherPkgs.has(p));
    const candidates = [...new Set([...googleStock, ...fromHist.filter((p) => installed.has(p) && !launcherPkgs.has(p)), ...vendor])];
    const toEnable = candidates.filter((p) => pk.disabled.has(p));
    for (const p of Object.keys(HOME_RIVALS)) if (pk.disabled.has(p)) toEnable.push(p);

    const enabled = [];
    for (const p of toEnable) {
      const r = await A.shell(target, `pm enable ${p}`);
      const ok = /enabled/.test(r.out);
      if (ok) enabled.push(p);
      add(ok, `${byPkg.get(p)?.name || p} ${ok ? 'réactivée' : `: ${r.err || r.out || 'échec'}`}`);
    }
    if (!toEnable.length) add(true, "Aucun accueil d'origine désactivé");

    // Accueil d'origine présent, par ordre de préférence : Google TV, Android TV, Leanback, puis constructeur
    const homes = await homeActivities(target);
    const order = [...GOOGLE_STOCK, ...candidates.filter((p) => !GOOGLE_STOCK.includes(p))];
    let comp = '';
    for (const p of order) { comp = homes.find((c) => c.startsWith(`${p}/`)) || ''; if (comp) break; }
    if (!comp) {
      add(false, "Aucun accueil d'origine trouvé sur la TV : choisis l'accueil à la main avec le bouton Accueil.");
    } else {
      const r = await A.shell(target, `cmd package set-home-activity ${comp}`);
      add(/Success/i.test(r.out), /Success/i.test(r.out) ? `Accueil par défaut : ${stockLabel(comp.split('/')[0])} (${comp.split('/')[0]})` : `Changement d'accueil refusé par la TV : ${r.err || r.out || 'échec'}`);
    }
    await A.sleep(1000);
    const home = await currentHome(target);
    const ok = !!comp && home === comp;
    add(ok, ok ? `Vérifié : le bouton Accueil mène à ${stockLabel(home.split('/')[0])}` : `Le bouton Accueil mène à ${home ? home.split('/')[0] : 'aucun accueil (choix demandé à l\'appui)'}`);
    await A.shell(target, 'input keyevent KEYCODE_HOME');

    // Historique : les instantanés actifs ne comptent plus ces applis comme désactivées
    for (const s of hist.filter((x) => !x.restored)) {
      s.apps = (s.apps || []).filter((p) => !enabled.includes(p));
      if (s.home) {
        if (enabled.includes(s.home.stockDisabled)) s.home.stockDisabled = null;
        s.home.rivalsDisabled = (s.home.rivalsDisabled || []).filter((p) => !enabled.includes(p));
        if (comp) s.home.after = comp;
      }
    }
    const at = new Date().toISOString();
    hist.unshift({ id: Date.now().toString(36), type: 'reset-launcher', at, level: 0, settings: {}, apps: [], enabled, home: { before: null, after: home || null }, log, restored: true, restoredAt: at });
    store.saveHistory(dev.id, hist);
    return { ok, home: home || '', log };
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
    checks: {
      animations: { ok: animOk, skipped: animSkipped, values: ANIMATION_KEYS.map((k) => settings[k] && settings[k] !== 'null' ? settings[k] : '1.0') },
      scans: { ok: SCAN_KEYS.every((k) => settings[k] === '0') },
      dns: dnsState(settings),
      telemetry, safe, optional, launcher,
    },
    next,
  };
}

module.exports = { plan, apply, restore, resetLauncher, openStore, audit, withLock, LEVELS, catalog, isProtected };
