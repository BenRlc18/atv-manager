#!/usr/bin/env node
'use strict';
// Import des listes de paquets par modèle du projet CleanYourTV (Gathin, licence MIT)
// https://github.com/Gathin23/cleanyourtv
//
// Usage : node tools/import-cleanyourtv.js <chemin du clone CleanYourTV> [fichier de sortie]
// Sortie par défaut : server/cleanyourtv.json. Le script est reproductible : même clone, même résultat
// (seule la date importedAt change).
//
// Lecture de examples/<modèle>/debloat.txt :
//   - en-tête en commentaires (# ...) : description du modèle (nom, codename, modèle type AFTKM, SoC, OS)
//   - « pkg   # note » : paquet désactivé sur ce modèle
//   - « # pkg # note » : paquet gardé ou protégé sur ce modèle (jamais proposé)
//   - un paquet cité dans l'en-tête sans être désactivé est lui aussi gardé (« Kept on purpose: ... »)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PKG = '[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)+';
const ACTIVE_RE = new RegExp(`^(${PKG})\\s*(?:#\\s?(.*))?$`);
const KEPT_RE = new RegExp(`^#\\s*(${PKG})\\s*(?:#\\s?(.*))?$`);
// Mention forte : l'appli ne doit jamais être désactivée sur ce modèle (et pas seulement « gardée par choix »)
const CRITICAL_RE = /never|protected|must stay|do not disable|don't disable|cannot disable|can't disable|load-bearing|boot ?loop|boot hangs|hangs on|factory reset|crash|black screen|painted nothing|lost? (the )?wi-?fi|bricks?/i;
const PKG_IN_TEXT_RE = new RegExp(`\\b((?:com|org|net|tv|io|cn|de|fr|uk|jp|kr|ru|me|dev|android|google|amazon|fusion|mediatek|realtek|droidlogic|tcl|sdmc|cvte)\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_*]+)*)`, 'g');

// Mots écartés des identifiants (régions, fabricants de SoC, mots courants)
const STOP = new Set(['the', 'and', 'with', 'for', 'year', 'name', 'names', 'is', 'was', 'list', 'only', 'board', 'family',
  'mediatek', 'realtek', 'amlogic', 'hisilicon', 'allwinner', 'mstar', 'rockchip', 'android', 'google', 'firmware',
  'built', 'build', 'model', 'device', 'product', 'codename', 'reports', 'sold', 'also', 'same', 'stick', 'box',
  'here', 'that', 'this', 'which', 'it', 'its', 'not', 'on', 'in', 'of', 'to', 'a', 'an', 'as', 'by', 'differs', 'doc',
  'strings', 'unknown', 'label', 'owner', 'admin', 'policy', 'usage', 'lists', 'itself', 'side', 'id', 'ids']);

function git(dir, args) {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

// Identifiant de type code : lettres et chiffres mêlés (AFTKM est traité à part), ou avec « _ »
function isCode(w) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.\-]*[A-Za-z0-9]$/.test(w)) return false;
  if (/^\d+(\.\d+)?$/.test(w)) return false; // nombres, versions
  if (/^\d+(K|GB|MB|bit|p|Hz)$/i.test(w) || /^\d+-bit$/i.test(w)) return false; // 4K, 2GB, 32-bit, 1080p
  if (/^(SDK|API)\d+$/i.test(w)) return false;
  if (/_/.test(w) && /[A-Za-z]/.test(w)) return true;
  return /[A-Za-z]/.test(w) && /\d/.test(w);
}
const isCodename = (w) => /^[a-z][a-z]{2,}$/.test(w) && !STOP.has(w);
// Codes tout en majuscules sans chiffre (AFTKM, MIBOX) : seulement s'ils suivent un mot-clé ou dans la liste du README
const isUpperCode = (w) => /^[A-Z]{4,}$/.test(w) && !/^(SMART|QLED|OLED|UHD|IPTV|BRAVIA|GOOGLE|ANDROID|SMART_TV|NES|SDMC|CVTE|KTC|MTC|TPV|SCBC|SPPL|MOKA|HVCL|DVB|ISDB|ACR|LED)$/.test(w);

// Écarte les identifiants trop courts ou trompeurs (0x0304, 40-inch, nom de dossier, commandes adb)
function keepId(w) {
  if (!w || w.length < 2) return false;
  if (w.length === 2 && !(/[A-Za-z]/.test(w) && /\d/.test(w))) return false; // R1, R2 oui ; « on » non
  if (/^(Android TV|Google TV|Smart TV Android|TV)$/i.test(w)) return false; // trop générique
  if (/^0x/i.test(w) || /-inch$/i.test(w) || /\badb\b/.test(w)) return false;
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(w)) return false; // nom de dossier CleanYourTV
  if (STOP.has(w.toLowerCase())) return false;
  return true;
}

// Identifiants tirés de la colonne TV du README : éléments entre parenthèses séparés par des virgules
function idsFromLabel(label) {
  const ids = new Set();
  for (const m of label.matchAll(/\(([^)]*)\)/g)) {
    for (const raw of m[1].split(/[,;]/)) {
      const item = raw.trim().replace(/^(?:device|product|codename|model)\s+/i, '').replace(/["`“”]/g, '');
      if (!item) continue;
      const words = item.split(/[\s/+:]+/).filter(Boolean);
      if (words.length === 1) {
        const w = words[0];
        if (isCode(w) || isCodename(w) || isUpperCode(w)) ids.add(w);
      } else {
        for (const w of words) if (isCode(w)) ids.add(w);
      }
    }
  }
  return new Set([...ids].filter(keepId));
}

// Identifiants tirés de l'en-tête : « device X », « product X », « model X », « codename X », model "X", empreinte
function idsFromHeader(header) {
  const ids = new Set();
  const text = header.join(' ');
  const firstPara = [];
  for (const l of header) { if (!l.trim()) break; firstPara.push(l); }
  const intro = firstPara.join(' ');
  const KW = '(?:ro\\.product\\.)?(?:model|device|product|name|codename)';
  // Valeur entre guillemets : model "Smart TV Pro", ro.product.model="4K Google TV Stick"
  for (const m of text.matchAll(new RegExp(`\\b${KW}\\s*=?\\s*["\\x60“]([^"\\x60”,]{2,40})["\\x60”]`, 'gi'))) {
    if (/[A-Z0-9]/.test(m[1])) ids.add(m[1].trim());
  }
  // Valeur sans guillemets : codes (AFTKM, G10_4K_GB, YYT, dangalUHD) partout dans l'en-tête
  for (const m of text.matchAll(new RegExp(`\\b${KW}\\s*=?\\s*([A-Za-z0-9][\\w.\\-]*[A-Za-z0-9])`, 'g'))) {
    const w = m[1];
    if (isCode(w) || isUpperCode(w) || (/^[A-Z]{3}$/.test(w)) || (/^[a-z]+[A-Z]+$/.test(w))) ids.add(w);
  }
  // Codenames en minuscules : seulement dans le premier paragraphe (description de l'appareil)
  for (const m of intro.matchAll(/\b(?:device|codename)\s+([a-z][a-z0-9_]{2,})\b/g)) ids.add(m[1]);
  // Empreinte : marque/produit/appareil:version/...
  for (const m of text.matchAll(/fingerprint:?\s*`?([^/\s`]+)\/([^/\s`]+)\/([^:/\s`]+):/gi)) { ids.add(m[2]); ids.add(m[3]); }
  return new Set([...ids].filter(keepId));
}

function parseList(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const header = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) break;
    if (!l.startsWith('#')) break;
    if (KEPT_RE.test(l)) break; // en-tête sans ligne vide avant les paquets
    header.push(l.replace(/^#\s?/, ''));
  }
  const disable = [];
  const keep = new Set();
  const critical = new Set();
  // Paquets cités dans un texte libre : gardés, et critiques si la phrase contient « NEVER », « protected »...
  const mentions = (text) => {
    for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      for (const p of sentence.matchAll(PKG_IN_TEXT_RE)) {
        keep.add(p[1]);
        if (CRITICAL_RE.test(sentence)) critical.add(p[1]);
      }
    }
  };
  let block = []; // commentaires de section consécutifs (une liste peut tenir sur plusieurs lignes)
  const flush = () => { if (block.length) mentions(block.join(' ')); block = []; };
  let last = null; // dernière entrée active, pour les notes sur plusieurs lignes
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim();
    if (!l) { last = null; flush(); continue; }
    let m;
    if (/^\s+#/.test(raw) && last) { // suite de la note de la ligne précédente
      last.note = `${last.note} ${l.replace(/^#\s?/, '')}`.trim();
      continue;
    }
    if ((m = l.match(ACTIVE_RE))) {
      flush();
      last = { pkg: m[1], note: (m[2] || '').trim() };
      disable.push(last);
      continue;
    }
    last = null;
    if ((m = l.match(KEPT_RE))) {
      flush();
      keep.add(m[1]);
      if (CRITICAL_RE.test(m[2] || '')) critical.add(m[1]);
      continue;
    }
    // Paquet cité dans un commentaire de section : gardé s'il n'est pas désactivé (vérifié plus bas)
    if (l.startsWith('#')) block.push(l.replace(/^#\s?/, ''));
  }
  flush();
  mentions(header.join(' '));
  // Un paquet désactivé n'est jamais dans keep ; dédoublonnage des désactivations
  const seen = new Set();
  const dis = [];
  for (const d of disable) {
    if (seen.has(d.pkg)) continue;
    seen.add(d.pkg);
    dis.push({ pkg: d.pkg, note: d.note.length > 300 ? `${d.note.slice(0, 297)}...` : d.note });
  }
  for (const p of seen) keep.delete(p);
  // Les mentions de fichiers (« debloat.txt », « config.json ») ne sont pas des paquets
  for (const p of [...keep]) if (/\.(txt|json|sh|md|apk|xml|kt|ttf|png)$/i.test(p) || !/[a-z]/.test(p.split('.').pop().replace('*', 'x'))) keep.delete(p);
  // Jokers trop larges cités dans le texte (« com.google.* », « com.coocaa.* ») : écartés, seuls les jokers
  // précis (au moins 3 segments, ex. com.amazon.tv.settings.*) sont gardés
  for (const p of [...keep]) {
    const base = p.replace(/\.?\*.*$/, '');
    if (p.includes('*') && (base.split('.').length < 3 || /^com\.(google\.)?android$/.test(base))) keep.delete(p);
  }
  return { header, disable: dis, keep: [...keep].sort(), critical: [...critical].filter((p) => keep.has(p)).sort() };
}

function readReadme(dir) {
  const rows = new Map();
  const f = path.join(dir, 'examples', 'README.md');
  if (!fs.existsSync(f)) return rows;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([^`/]+)\/?`\s*\|([^|]*)\|([^|]*)\|/);
    if (m) rows.set(m[1].trim(), { label: m[2].trim(), os: m[3].trim() });
  }
  return rows;
}

function main() {
  const src = process.argv[2];
  const out = process.argv[3] || path.join(__dirname, '..', 'server', 'cleanyourtv.json');
  if (!src || !fs.existsSync(path.join(src, 'examples'))) {
    console.error('Usage : node tools/import-cleanyourtv.js <chemin du clone CleanYourTV> [sortie.json]');
    process.exit(1);
  }
  const licence = fs.existsSync(path.join(src, 'LICENSE')) ? fs.readFileSync(path.join(src, 'LICENSE'), 'utf8') : '';
  const copyright = (licence.match(/^Copyright.*$/m) || [''])[0].trim();
  const url = (git(src, ['remote', 'get-url', 'origin']) || 'https://github.com/Gathin23/cleanyourtv').replace(/\.git$/, '');
  const readme = readReadme(src);

  const models = [];
  const dirs = fs.readdirSync(path.join(src, 'examples'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const id of dirs) {
    const file = path.join(src, 'examples', id, 'debloat.txt');
    if (!fs.existsSync(file)) continue;
    const list = parseList(file);
    const row = readme.get(id);
    // Sans ligne dans le README : libellé = début de la première ligne de l'en-tête
    const label = row ? row.label.replace(/`/g, '') : (list.header[0] || id).replace(/[,.]\s*$/, '').slice(0, 160);
    const os = row ? row.os : '';
    const match = new Set([...idsFromLabel(label), ...idsFromHeader(list.header)]);
    models.push({ id, label, os, match: [...match], disable: list.disable, keep: list.keep, critical: list.critical });
  }

  // Index par paquet : nombre de modèles qui le désactivent / le gardent, quelques notes distinctes
  const packages = {};
  for (const m of models) {
    for (const d of m.disable) {
      const p = packages[d.pkg] || (packages[d.pkg] = { models: 0, kept: 0, notes: [] });
      p.models++;
      if (d.note && p.notes.length < 3 && !p.notes.some((n) => n.toLowerCase() === d.note.toLowerCase())) p.notes.push(d.note);
    }
    for (const k of m.keep) {
      if (k.endsWith('*')) continue;
      const p = packages[k] || (packages[k] = { models: 0, kept: 0, notes: [] });
      p.kept++;
    }
  }
  const sorted = {};
  for (const k of Object.keys(packages).sort()) sorted[k] = packages[k];

  const data = {
    _doc: 'Généré par tools/import-cleanyourtv.js, ne pas modifier à la main. Listes de paquets par modèle du projet CleanYourTV (licence MIT, voir server/third_party/cleanyourtv-LICENSE).',
    source: {
      project: 'CleanYourTV',
      url,
      commit: git(src, ['rev-parse', 'HEAD']),
      license: 'MIT',
      copyright,
      importedAt: new Date().toISOString().slice(0, 10),
    },
    models,
    packages: sorted,
  };
  fs.writeFileSync(out, `${JSON.stringify(data)}\n`);
  const nDis = new Set(models.flatMap((m) => m.disable.map((d) => d.pkg))).size;
  console.log(`${models.length} modèles, ${nDis} paquets désactivés distincts, ${Object.keys(sorted).length} paquets indexés → ${out}`);
}

if (require.main === module) main();
module.exports = { parseList, idsFromLabel, idsFromHeader, isCode };
