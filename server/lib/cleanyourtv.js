'use strict';
// Listes de paquets par modèle du projet CleanYourTV (Gathin, licence MIT) :
// https://github.com/Gathin23/cleanyourtv — données importées par tools/import-cleanyourtv.js dans
// server/cleanyourtv.json. Ce module reconnaît le modèle d'une TV et propose les paquets que CleanYourTV
// désactive sur ce modèle. Le catalogue maison (catalog.json) reste prioritaire : il n'est jamais modifié ici.
const path = require('path');
const fs = require('fs');

const FILE = path.join(__dirname, '..', 'cleanyourtv.json');
let data = { source: null, models: [], packages: {} };
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.log(`[CleanYourTV] listes absentes ou illisibles (${e.message}) : suggestions désactivées`); }

// Seuils
const MIN_SCORE = 2.5; // score minimal pour retenir un modèle
const TIE_GAP = 1; // modèles à moins d'un point du meilleur : gardés aussi
const FALLBACK_MIN = 10; // sans modèle reconnu : paquet désactivé sur au moins 10 modèles
const SAFE_MIN = 20; // pré-coché seulement si désactivé sur au moins 20 modèles et de type télémétrie/pub
const SAFE_RE = /telemetr|metric|analytic|logger|logkit|log ?upload|crash ?report|bug ?report|tracking|tracker|\bacr\b|\.acr\b|automatic content recognition|samba|feedback|advert|\bads?\b|\.ads?\.|adservice|ad sdk|sponsor|promo/i;
// Poids des propriétés de l'appareil comparées aux identifiants CleanYourTV
const FIELD_WEIGHT = { name: 4, model: 3, device: 3, product: 3, fingerprint: 2 };
const FIELD_LABEL = { name: 'produit', model: 'modèle', device: 'appareil', product: 'produit', fingerprint: 'empreinte' };

const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-]+/g, '');

// Index : identifiant normalisé → nombre de modèles qui le citent (un identifiant partagé compte moins)
const idCount = new Map();
for (const m of data.models) for (const id of new Set(m.match.map(norm))) idCount.set(id, (idCount.get(id) || 0) + 1);
const rarity = (k) => (k <= 1 ? 1 : k <= 3 ? 0.75 : k <= 8 ? 0.5 : 0.25);

// Propriétés utiles à la reconnaissance : celles déjà connues de dev + quelques getprop lus par plan()
function deviceProps(dev = {}, extra = {}) {
  const fp = String(extra.fingerprint || '');
  const seg = fp.split(':')[0].split('/'); // marque/produit/appareil
  return {
    brand: dev.brand || '', manufacturer: dev.manufacturer || '',
    model: dev.model || '', device: dev.device || extra.device || '',
    name: extra.name || '', product: extra.product || '',
    fingerprint: seg.length >= 3 ? [seg[1], seg[2]] : [],
  };
}

// Score d'un modèle CleanYourTV pour un appareil : somme des propriétés égales à un identifiant du modèle
function scoreModel(m, props) {
  const values = {};
  for (const f of ['name', 'model', 'device', 'product']) if (props[f]) values[f] = [norm(props[f])];
  if (props.fingerprint.length) values.fingerprint = props.fingerprint.map(norm);
  let score = 0;
  const hits = [];
  const used = new Set();
  for (const id of m.match) {
    const n = norm(id);
    if (n.length < 2) continue;
    let best = null;
    for (const [f, vals] of Object.entries(values)) {
      if (used.has(f) || !vals.includes(n)) continue;
      if (!best || FIELD_WEIGHT[f] > FIELD_WEIGHT[best]) best = f;
    }
    if (!best) continue;
    used.add(best);
    score += FIELD_WEIGHT[best] * rarity(idCount.get(n) || 1);
    hits.push(`${FIELD_LABEL[best]} ${id}`);
  }
  if (!hits.length) return { score: 0, hits };
  // Marque cohérente avec le modèle (Fire TV : fabricant Amazon même si la TV est d'une autre marque)
  const text = `${m.id} ${m.label}`.toLowerCase();
  const brands = [props.brand, props.manufacturer].map((b) => String(b).toLowerCase()).filter((b) => b.length >= 3);
  if (brands.some((b) => text.includes(b)) || (brands.includes('amazon') && /fire tv/.test(text))) {
    score += 1;
    hits.push('marque');
  }
  return { score: Math.round(score * 100) / 100, hits };
}

// Reconnaît le ou les modèles CleanYourTV d'un appareil. Plusieurs modèles à égalité : tous sont gardés.
function detect(props) {
  const scored = data.models.map((m) => ({ m, ...scoreModel(m, props) })).filter((s) => s.score >= MIN_SCORE);
  if (!scored.length) return { models: [], matchedBy: null, score: 0 };
  const best = Math.max(...scored.map((s) => s.score));
  // Écart toléré d'un point : un identifiant générique (« Smart TV Pro ») ne doit pas départager seul
  const top = scored.filter((s) => s.score >= best - TIE_GAP).sort((a, b) => b.score - a.score);
  return { models: top.map((s) => s.m), matchedBy: top[0].hits.join(', '), score: best };
}

// Jokers d'un keep (« com.amazon.tv.settings.* ») : préfixe
function inKeep(keep, pkg) {
  return keep.some((k) => (k.endsWith('*') ? pkg.startsWith(k.replace(/\*$/, '')) : k === pkg));
}

// Paquet gardé par l'un des modèles reconnus (un modèle qui le désactive lui-même ne compte pas, cas des jokers)
const disabledSet = new WeakMap();
function disables(m, pkg) {
  if (!disabledSet.has(m)) disabledSet.set(m, new Set(m.disable.map((d) => d.pkg)));
  return disabledSet.get(m).has(pkg);
}
function keptBy(models, pkg) {
  return models.some((m) => !disables(m, pkg) && inKeep(m.keep, pkg));
}
// Mention forte (« NEVER disable », « protected », écran noir, réinitialisation...) sur l'un des modèles reconnus
function criticalFor(models, pkg) {
  return models.some((m) => !disables(m, pkg) && inKeep(m.critical || [], pkg));
}

// Suggestions pour une TV. installed : Set des paquets installés ; skip(pkg) : garde-fous de l'appelant
// (catalogue, isProtected, lanceur...). Renvoie { list: Map pkg → { why, sourceModel, models, safe }, isKept(pkg) }.
function suggestions(detected, installed, skip = () => false) {
  const out = new Map();
  const models = detected.models;
  const isKept = (pkg) => keptBy(models, pkg);

  if (models.length) {
    // Modèle(s) reconnu(s) : union des listes si 1 à 3 modèles, sinon paquets désactivés par au moins la moitié
    const count = new Map();
    for (const m of models) for (const d of m.disable) {
      const c = count.get(d.pkg) || { n: 0, first: null };
      c.n++;
      if (!c.first) c.first = { m, note: d.note };
      if (!c.first.note && d.note) c.first.note = d.note;
      count.set(d.pkg, c);
    }
    const need = models.length <= 3 ? 1 : Math.ceil(models.length / 2);
    for (const [pkg, c] of count) {
      if (c.n < need || !installed.has(pkg) || isKept(pkg) || skip(pkg)) continue;
      const p = data.packages[pkg] || { models: 0, notes: [] };
      const notes = `${pkg} ${c.first.note} ${p.notes.join(' ')}`;
      out.set(pkg, {
        why: c.first.note || `Désactivé par CleanYourTV sur ${p.models} modèle${p.models > 1 ? 's' : ''}.`,
        sourceModel: c.first.m.label,
        models: p.models,
        safe: p.models >= SAFE_MIN && SAFE_RE.test(notes),
      });
    }
  } else {
    // Aucun modèle reconnu : paquets désactivés sur beaucoup de modèles (et plus souvent désactivés que gardés)
    for (const pkg of installed) {
      const p = data.packages[pkg];
      if (!p || p.models < FALLBACK_MIN || p.kept * 2 >= p.models || skip(pkg)) continue;
      out.set(pkg, { why: `Désactivé sur ${p.models} modèles par CleanYourTV.`, sourceModel: null, models: p.models, safe: false });
    }
  }
  return { list: out, isKept };
}

// Résumé exposé au navigateur
function summary(detected) {
  const s = data.source || {};
  return {
    model: detected.models.length ? detected.models[0].label : null,
    models: detected.models.map((m) => ({ id: m.id, label: m.label, os: m.os })),
    matchedBy: detected.matchedBy,
    source: s.url || 'https://github.com/Gathin23/cleanyourtv',
    project: s.project || 'CleanYourTV',
    license: s.license || 'MIT',
    commit: s.commit || '',
  };
}

module.exports = { data, deviceProps, detect, scoreModel, suggestions, summary, inKeep, keptBy, criticalFor, norm, SAFE_RE, FALLBACK_MIN, SAFE_MIN };
