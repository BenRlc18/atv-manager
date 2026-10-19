'use strict';
// Stockage JSON simple (appareils, réglages, historique) avec écriture atomique.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function write(name, value) {
  const file = path.join(DATA_DIR, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

// --- Appareils, indexés par un identifiant stable (numéro de série ou android_id)
const devices = () => read('devices.json', {});
const saveDevices = (d) => write('devices.json', d);

function upsertDevice(info) {
  const all = devices();
  const prev = all[info.id] || {};
  all[info.id] = { ...prev, ...info, label: prev.label || info.label || '' };
  saveDevices(all);
  return all[info.id];
}

// --- Réglages : Tailscale et IA désactivés par défaut
const DEFAULT_SETTINGS = { tailscale: { enabled: false }, ai: { enabled: false } };
const settings = () => ({ ...DEFAULT_SETTINGS, ...read('settings.json', {}) });
const saveSettings = (s) => write('settings.json', s);

// --- Historique des optimisations (instantanés pour restauration)
const historyFile = (id) => path.join('history', `${id.replace(/[^\w.-]/g, '_')}.json`);
const history = (id) => read(historyFile(id), []);
const saveHistory = (id, list) => write(historyFile(id), list);

module.exports = { DATA_DIR, read, write, devices, saveDevices, upsertDevice, settings, saveSettings, history, saveHistory };
