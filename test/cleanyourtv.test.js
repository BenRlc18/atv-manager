'use strict';
// Tests de l'import CleanYourTV et de la reconnaissance de modèle (node --test, sans dépendance).
// L'import complet est rejoué si le clone de CleanYourTV est indiqué : CYT_DIR=/chemin/du/clone npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atvm-cyt-'));
process.env.DATA_DIR = TMP; // store.js ne doit jamais toucher aux vraies données

const ROOT = path.join(__dirname, '..');
const C = require('../server/lib/cleanyourtv');

// Vérifications communes à un fichier cleanyourtv.json
function checkData(d, expectedModels) {
  assert.strictEqual(d.source.project, 'CleanYourTV');
  assert.strictEqual(d.source.license, 'MIT');
  assert.match(d.source.copyright, /Gathin/);
  assert.match(d.source.url, /github\.com\/Gathin23\/cleanyourtv/);
  assert.match(d.source.commit, /^[0-9a-f]{40}$/);
  assert.strictEqual(d.models.length, expectedModels);
  for (const m of d.models) {
    assert.ok(m.id && m.label, `libellé manquant pour ${m.id}`);
    assert.ok(Array.isArray(m.match) && Array.isArray(m.disable) && Array.isArray(m.keep));
    const dis = new Set(m.disable.map((x) => x.pkg));
    for (const k of m.keep) assert.ok(!dis.has(k), `${m.id} : ${k} à la fois désactivé et gardé`);
  }
  const g = (id) => d.models.find((m) => m.id === id);
  // Lignes commentées « protected » et « NEVER disable » : dans keep, jamais dans disable
  const fire = g('amazon-fire-tv-stick-4k-2023');
  assert.ok(fire.keep.includes('com.amazon.device.metrics'), 'paquet protégé par Fire OS absent de keep');
  assert.ok(fire.keep.includes('com.amazon.imp'), 'paquet « kept on purpose » de l\'en-tête absent de keep');
  assert.ok(fire.disable.some((x) => x.pkg === 'com.amazon.tv.acr' && /Content Recognition/.test(x.note)));
  const coocaa = g('coocaa-k3-pro-90p3d-max');
  assert.ok(coocaa.keep.includes('com.tianci.movieplatform'), 'NEVER disable absent de keep');
  assert.ok(!coocaa.disable.some((x) => x.pkg === 'com.tianci.movieplatform'));
  assert.ok(coocaa.critical.includes('com.tianci.movieplatform'), 'NEVER disable absent de critical');
  assert.ok(fire.critical.includes('com.amazon.device.metrics'), 'paquet protégé absent de critical');
  for (const m of d.models) for (const c of m.critical) assert.ok(m.keep.includes(c), `${m.id} : ${c} critique hors keep`);
  // Index par paquet
  assert.ok(d.packages['com.google.android.feedback'].models >= 100);
  assert.ok(d.packages['com.amazon.device.metrics'].kept >= 1);
}

test('fichier server/cleanyourtv.json livré : 252 modèles, keep séparé de disable', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'cleanyourtv.json'), 'utf8'));
  checkData(d, 252);
});

test('import reproductible depuis le clone (CYT_DIR)', { skip: !process.env.CYT_DIR && 'CYT_DIR non défini' }, () => {
  const src = process.env.CYT_DIR;
  const out = path.join(TMP, 'cyt.json');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'import-cleanyourtv.js'), src, out], { stdio: 'pipe' });
  const d = JSON.parse(fs.readFileSync(out, 'utf8'));
  const folders = fs.readdirSync(path.join(src, 'examples'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(src, 'examples', e.name, 'debloat.txt'))).length;
  checkData(d, folders);
  // Même résultat que le fichier livré (hors date d'import)
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'cleanyourtv.json'), 'utf8'));
  d.source.importedAt = shipped.source.importedAt = '';
  if (d.source.commit === shipped.source.commit) assert.deepStrictEqual(d, shipped);
});

test('analyse d\'une liste : actives, gardées, notes sur plusieurs lignes, en-tête', () => {
  const { parseList } = require('../tools/import-cleanyourtv');
  const f = path.join(TMP, 'debloat.txt');
  fs.writeFileSync(f, [
    '# Exemple TV (device demo1, product DEMO_4K_GB), Android 12',
    '# Kept on purpose: com.example.keepme and com.example.tv.settings.*',
    '',
    '# Télémétrie',
    'com.example.telemetry          # usage stats',
    '                               # uploaded every hour',
    '# com.example.protected        # Cannot disable a protected package',
    'com.example.tv.settings.extra  # optional',
    'com.example.ads',
    '',
  ].join('\n'));
  const r = parseList(f);
  assert.deepStrictEqual(r.disable.map((x) => x.pkg), ['com.example.telemetry', 'com.example.tv.settings.extra', 'com.example.ads']);
  assert.strictEqual(r.disable[0].note, 'usage stats uploaded every hour');
  assert.deepStrictEqual(r.keep, ['com.example.keepme', 'com.example.protected', 'com.example.tv.settings.*']);
});

// --- Reconnaissance de modèle
const TCL = C.deviceProps({ brand: 'TCL', manufacturer: 'TCL', model: 'Smart TV Pro', device: 'G10' },
  { name: 'G10_4K_GB', product: 'G10', fingerprint: 'TCL/G10_4K_GB/G10:12/STT2.230203.001/AS16:user/release-keys' });
const FIRE = C.deviceProps({ brand: 'Amazon', manufacturer: 'Amazon', model: 'AFTKM', device: 'karat' },
  { name: 'karat', product: 'karat', fingerprint: 'Amazon/karat/karat:11/RS8185.3891N/0033018557316:user/amz-p,release-keys' });
const UNKNOWN = C.deviceProps({ brand: 'Acme', manufacturer: 'Acme', model: 'Vision X1000', device: 'x1000' },
  { name: 'x1000_eu', product: 'x1000', fingerprint: 'Acme/x1000_eu/x1000:11/RP1A/1:user/release-keys' });

test('TCL Google TV (G10) : modèles TCL G10 reconnus', () => {
  const d = C.detect(TCL);
  assert.ok(d.models.length >= 1);
  for (const m of d.models) assert.match(m.id, /^tcl-/);
  assert.ok(d.models.some((m) => m.match.includes('G10')));
  assert.match(d.matchedBy, /G10/);
  const s = C.summary(d);
  assert.match(s.model, /TCL/);
  assert.match(s.source, /Gathin23\/cleanyourtv/);
});

test('Fire TV Stick 4K 2023 (AFTKM) : un seul modèle, le bon', () => {
  const d = C.detect(FIRE);
  assert.deepStrictEqual(d.models.map((m) => m.id), ['amazon-fire-tv-stick-4k-2023']);
  assert.match(d.matchedBy, /AFTKM/);
});

test('appareil inconnu : aucun modèle', () => {
  const d = C.detect(UNKNOWN);
  assert.strictEqual(d.models.length, 0);
  assert.strictEqual(C.summary(d).model, null);
});

test('suggestions : jamais un paquet gardé, repli à 10 modèles sans modèle reconnu', () => {
  const all = new Set(Object.keys(C.data.packages));
  // Fire TV : ACR proposé, paquets protégés par Fire OS jamais proposés
  const fire = C.suggestions(C.detect(FIRE), all);
  assert.ok(fire.list.has('com.amazon.tv.acr'));
  assert.strictEqual(fire.list.get('com.amazon.tv.acr').sourceModel, C.data.models.find((m) => m.id === 'amazon-fire-tv-stick-4k-2023').label);
  for (const p of ['com.amazon.device.metrics', 'com.amazon.imp', 'com.amazon.tv.launcher']) assert.ok(!fire.list.has(p), p);
  // Aucun paquet gardé par un des modèles reconnus n'est proposé
  for (const props of [TCL, FIRE]) {
    const d = C.detect(props);
    const s = C.suggestions(d, all);
    for (const pkg of s.list.keys()) assert.ok(!C.keptBy(d.models, pkg), `${pkg} gardé mais proposé`);
  }
  // Sans modèle : seulement des paquets désactivés sur au moins 10 modèles, jamais pré-cochés
  const none = C.suggestions(C.detect(UNKNOWN), all);
  assert.ok(none.list.size > 0);
  for (const [pkg, s] of none.list) {
    assert.ok(C.data.packages[pkg].models >= 10, pkg);
    assert.strictEqual(s.safe, false);
    assert.strictEqual(s.sourceModel, null);
  }
  // Le filtre de l'appelant (catalogue, protégées...) est respecté
  const filtered = C.suggestions(C.detect(FIRE), all, (pkg) => pkg === 'com.amazon.tv.acr');
  assert.ok(!filtered.list.has('com.amazon.tv.acr'));
});

// --- plan() de bout en bout, avec un faux adb (aucune TV contactée)
test('plan() : suggestions CleanYourTV, garde-fous et résumé', async () => {
  const A = require('../server/lib/adb');
  const O = require('../server/lib/optimizer');
  const system = ['com.amazon.tv.acr', 'com.amazon.device.metrics', 'com.amazon.imp', 'com.amazon.tv.launcher', 'com.amazon.wifilocker',
    'com.google.android.feedback', 'com.android.adservices.api', 'com.amazon.client.metrics.api'];
  const realShell = A.shell;
  A.shell = async (target, cmd) => {
    if (cmd.startsWith('pm list packages')) return { ok: true, out: `${system.map((p) => `package:${p}`).join('\n')}\n---\npackage:com.netflix.ninja\n---\n`, err: '' };
    if (cmd.includes('ro.product.name')) return { ok: true, out: 'name=karat\nproduct=karat\nfingerprint=Amazon/karat/karat:11/RS8185/1:user/release-keys', err: '' };
    if (cmd.includes('dumpsys wifi')) return { ok: true, out: 'creatorName=com.amazon.wifilocker', err: '' };
    if (cmd.includes('query-activities')) return { ok: true, out: 'com.amazon.tv.launcher/.ui.HomeActivity_vNext', err: '' };
    return { ok: true, out: '', err: '' };
  };
  try {
    const dev = { id: 'test', brand: 'Amazon', manufacturer: 'Amazon', model: 'AFTKM', device: 'karat' };
    const r = await O.plan('test:5555', dev, 2, 'recommended');
    assert.strictEqual(r.cleanyourtv.models[0].id, 'amazon-fire-tv-stick-4k-2023');
    assert.match(r.cleanyourtv.source, /github\.com\/Gathin23\/cleanyourtv/);
    const by = new Map(r.apps.map((a) => [a.pkg, a]));
    const acr = by.get('com.amazon.tv.acr');
    assert.ok(acr, 'ACR non proposé');
    assert.strictEqual(acr.source, 'CleanYourTV');
    assert.strictEqual(acr.level, 2);
    assert.match(acr.sourceModel, /Fire TV Stick 4K/);
    assert.ok(['info', 'safe'].includes(acr.risk));
    assert.strictEqual(acr.checked, acr.risk === 'safe');
    // Gardés, protégés, lanceur : absents ; Wi-Fi : verrouillé ; catalogue : entrée d'origine
    for (const p of ['com.amazon.device.metrics', 'com.amazon.imp', 'com.amazon.tv.launcher', 'com.android.adservices.api']) assert.ok(!by.has(p), p);
    const wifi = by.get('com.amazon.wifilocker');
    assert.ok(!wifi || (wifi.locked && wifi.risk === 'protected'));
    assert.ok(!by.get('com.google.android.feedback').source);
    assert.ok(!by.has('com.netflix.ninja'), 'appli installée par l\'utilisateur proposée');
    // Niveau 1 : pas de suggestion CleanYourTV
    const r1 = await O.plan('test:5555', dev, 1, 'recommended');
    assert.ok(!r1.apps.some((a) => a.source === 'CleanYourTV'));
  } finally {
    A.shell = realShell;
  }
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
