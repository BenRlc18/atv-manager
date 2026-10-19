'use strict';
// API Tailscale (optionnelle) : isoler une TV distante avec une étiquette et désactiver l'expiration de sa clé.
// La clé API est saisie par l'administrateur dans les réglages et reste dans le dossier de données du serveur.
const store = require('./store');

const API = 'https://api.tailscale.com/api/v2';
const err = (message, code = 400) => Object.assign(new Error(message), { code });

function config() {
  const t = store.settings().tailscale || {};
  return { apiKey: t.apiKey || '', tag: t.tag || 'tag:tvbox' };
}

async function call(key, method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw err("L'API Tailscale ne répond pas.", 502);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw err('Clé API Tailscale refusée (expirée ou sans les droits nécessaires).', 403);
  if (!res.ok) throw err(`API Tailscale : ${text.slice(0, 200) || res.status}`, 502);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

// Vérifie une clé avant de l'enregistrer
async function test(key) {
  const r = await call(key, 'GET', '/tailnet/-/devices');
  return { devices: (r.devices || []).length };
}

// Pose l'étiquette et désactive l'expiration de la clé de l'appareil qui a cette IP Tailscale
async function isolate(ip) {
  const { apiKey, tag } = config();
  if (!apiKey) throw err("Ajoute d'abord une clé API Tailscale dans les réglages.", 409);
  const { devices = [] } = await call(apiKey, 'GET', '/tailnet/-/devices');
  const d = devices.find((x) => (x.addresses || []).includes(ip));
  if (!d) throw err(`Aucun appareil Tailscale avec l'adresse ${ip}.`, 404);
  await call(apiKey, 'POST', `/device/${d.id}/tags`, { tags: [tag] });
  await call(apiKey, 'POST', `/device/${d.id}/key`, { keyExpiryDisabled: true });
  return { name: d.hostname || d.name, tag };
}

module.exports = { config, test, isolate };
