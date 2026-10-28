'use strict';
// API Tailscale (optionnelle) : isoler une TV distante avec une étiquette et désactiver l'expiration de sa clé.
// Les accès (clé API ou client OAuth) sont saisis par l'administrateur dans les réglages et restent dans le
// dossier de données du serveur : ils ne sont jamais renvoyés à l'interface ni écrits dans les journaux.
//
// Libre-service : un utilisateur connecté obtient une clé d'authentification à usage unique (étiquette TV)
// pour faire rejoindre sa TV au réseau Tailscale ; le serveur repère ensuite le nouvel appareil, le rattache
// à la clé et s'y connecte en ADB (fenêtre « Autoriser le débogage ? » sur la TV).
const store = require('./store');
const A = require('./adb');

const API = 'https://api.tailscale.com/api/v2';
const TIMEOUT_MS = 10000;
const KEY_SECONDS = 3600; // durée de validité d'une clé d'authentification
const MARGIN_MS = 15 * 60 * 1000; // marge après expiration pendant laquelle on cherche encore l'appareil
const CLAIM_RETRY_MS = 60 * 60 * 1000; // après rattachement : on retente l'ADB pendant 1 h
const KEEP_MS = 24 * 3600 * 1000; // historique des clés gardé 24 h (affichage et limite)
const PER_HOUR = 3; // clés par utilisateur et par heure
const SKEW_MS = 2 * 60 * 1000; // tolérance d'horloge entre le serveur et Tailscale
const LOOP_MS = 60 * 1000;
const ADB_PORT = 5555;
const FILE = 'tskeys.json';

const err = (message, code = 400) => Object.assign(new Error(message), { code });

function config() {
  const t = store.settings().tailscale || {};
  return {
    enabled: !!t.enabled,
    apiKey: t.apiKey || '',
    oauthClientId: t.oauthClientId || '',
    oauthClientSecret: t.oauthClientSecret || '',
    tag: t.tag || 'tag:tvbox',
  };
}

const hasOAuth = (c = config()) => !!(c.oauthClientId && c.oauthClientSecret);
const hasCredentials = (c = config()) => hasOAuth(c) || !!c.apiKey;
const selfService = () => { const c = config(); return c.enabled && hasCredentials(c); };

// Code Downloader de l'appli Tailscale (AFTVnews) : variable d'environnement, réglage, ou valeur par défaut
const downloaderCode = () => String(process.env.TAILSCALE_DOWNLOADER_CODE || store.settings().tailscaleDownloaderCode || '4723177').replace(/\D/g, '') || '4723177';

// Messages d'erreur Tailscale traduits simplement (le corps de la réponse n'est jamais journalisé)
function translate(status, text) {
  let msg = '';
  try { msg = String(JSON.parse(text).message || ''); } catch { msg = String(text || ''); }
  if (status === 401) return err('Accès Tailscale refusé : clé API ou client OAuth invalide ou expiré.', 403);
  if (status === 403) return err("Accès Tailscale refusé : il manque des droits (scopes) au client OAuth ou à la clé API.", 403);
  if (status === 404) return err('Élément introuvable sur le réseau Tailscale.', 404);
  if (status === 429) return err("L'API Tailscale demande de patienter un peu. Réessaie dans une minute.", 429);
  if (/tag/i.test(msg)) return err(`Tailscale refuse l'étiquette : vérifie qu'elle est dans « tagOwners » et que le client OAuth y a droit.`, 502);
  return err(`L'API Tailscale a renvoyé une erreur (${status}).`, 502);
}

async function request(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw err("L'API Tailscale ne répond pas.", 502);
  }
  const text = await res.text();
  return { res, text };
}

// --- Client OAuth : jeton d'accès obtenu par « client credentials », gardé en cache jusqu'à expiration
let tokenCache = null; // { clientId, token, exp }

async function oauthToken(clientId, clientSecret, force = false) {
  if (!force && tokenCache && tokenCache.clientId === clientId && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const { res, text } = await request(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString(),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) throw err('Client OAuth Tailscale refusé (identifiant ou secret incorrect, ou révoqué).', 403);
  if (!res.ok) throw translate(res.status, text);
  let j = {};
  try { j = JSON.parse(text); } catch { /* réponse invalide */ }
  if (!j.access_token) throw err("Tailscale n'a pas fourni de jeton d'accès.", 502);
  tokenCache = { clientId, token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

// Jeton à utiliser : le client OAuth est prioritaire sur la clé API
async function bearer(c, force = false) {
  if (hasOAuth(c)) return oauthToken(c.oauthClientId, c.oauthClientSecret, force);
  if (c.apiKey) return c.apiKey;
  throw err("Ajoute d'abord une clé API ou un client OAuth Tailscale dans les réglages.", 409);
}

async function callWith(token, method, path, body, accept) {
  const { res, text } = await request(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(accept ? { Accept: accept } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(translate(res.status, text), { status: res.status });
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

// Appel avec les accès enregistrés ; un jeton OAuth refusé (401) est renouvelé une fois
async function call(method, path, body, accept) {
  const c = config();
  try {
    return await callWith(await bearer(c), method, path, body, accept);
  } catch (e) {
    if (e.status !== 401 || !hasOAuth(c)) throw e;
    return callWith(await bearer(c, true), method, path, body, accept);
  }
}

// Vérifie une clé API avant de l'enregistrer
async function test(key) {
  const r = await callWith(key, 'GET', '/tailnet/-/devices');
  return { devices: (r.devices || []).length };
}

// Vérifie un client OAuth avant de l'enregistrer
async function testOAuth(clientId, clientSecret) {
  const token = await oauthToken(clientId, clientSecret, true);
  const r = await callWith(token, 'GET', '/tailnet/-/devices');
  return { devices: (r.devices || []).length };
}

// Pose l'étiquette et désactive l'expiration de la clé de l'appareil qui a cette IP Tailscale
async function isolate(ip) {
  const { tag } = config();
  const { devices = [] } = await call('GET', '/tailnet/-/devices');
  const d = devices.find((x) => (x.addresses || []).includes(ip));
  if (!d) throw err(`Aucun appareil Tailscale avec l'adresse ${ip}.`, 404);
  await call('POST', `/device/${d.id}/tags`, { tags: [tag] });
  await call('POST', `/device/${d.id}/key`, { keyExpiryDisabled: true });
  return { name: d.hostname || d.name, tag };
}

// ---------------------------------------------------------------------
// Libre-service : clés d'authentification à usage unique pour les TV
// ---------------------------------------------------------------------
// Seul l'identifiant de la clé est enregistré, jamais la clé elle-même.
const keys = () => store.read(FILE, []);
const saveKeys = (list) => store.write(FILE, list);
const purge = (list, now = Date.now()) => list.filter((k) => now - k.createdAt < KEEP_MS);

// Description acceptée par Tailscale : lettres, chiffres, espaces, tirets et soulignés (50 caractères max)
const description = (user) => `atvm ${String((user && user.username) || '').normalize('NFD').replace(/[^\w -]/g, '')}`.trim().slice(0, 50);

async function createAuthKey(user) {
  if (!selfService()) throw err("L'accès à distance par Tailscale n'est pas disponible sur ce serveur.", 409);
  const now = Date.now();
  const list = purge(keys(), now);
  const recent = list.filter((k) => k.userId === user.id && now - k.createdAt < 3600 * 1000);
  if (recent.length >= PER_HOUR) throw err(`Tu as déjà demandé ${PER_HOUR} clés dans l'heure. Réessaie un peu plus tard.`, 429);
  await requireSafePolicy();
  const { tag } = config();
  const r = await call('POST', '/tailnet/-/keys', {
    capabilities: { devices: { create: { reusable: false, ephemeral: false, preauthorized: true, tags: [tag] } } },
    expirySeconds: KEY_SECONDS,
    description: description(user),
  });
  if (!r.key || !r.id) throw err("Tailscale n'a pas créé la clé.", 502);
  const createdAt = Date.parse(r.created) || now;
  const expiresAt = Date.parse(r.expires) || createdAt + KEY_SECONDS * 1000;
  list.push({ keyId: String(r.id), userId: user.id, createdAt, expiresAt, claimedDeviceId: null });
  saveKeys(list);
  startLoop();
  return { key: r.key, expiresAt };
}

// Clé encore à surveiller : pas rattachée et pas trop expirée, ou rattachée mais TV pas encore ajoutée
function watched(k, now = Date.now()) {
  if (!k.claimedDeviceId) return now < k.expiresAt + MARGIN_MS;
  return k.state !== 'done' && now - (k.claimedAt || 0) < CLAIM_RETRY_MS;
}

const deviceTime = (d) => Date.parse(d.created || '') || 0;
const ipv4 = (d) => (d.addresses || []).find((a) => /^100\.\d+\.\d+\.\d+$/.test(a)) || '';
// Fenêtre d'une clé : un appareil créé entre la création de la clé et son expiration (+ tolérance d'horloge)
const inWindow = (k, d) => { const t = deviceTime(d); return t >= k.createdAt - SKEW_MS && t <= k.expiresAt + SKEW_MS; };

// Connexion ADB à la TV rattachée ; si elle est autorisée, elle est ajoutée pour l'utilisateur de la clé
async function connectClaimed(k, { reconnect = false } = {}) {
  const D = require('./devices'); // chargé ici : devices.js charge ATVM Connect au démarrage
  const target = `${k.ip}:${ADB_PORT}`;
  if (reconnect) await A.disconnect(target);
  const st = await A.connect(target);
  if (st === 'unauthorized') return { state: 'waiting-auth' };
  if (st !== 'device') return { state: 'offline' };
  const info = await D.identify(target);
  if (!info) return { state: 'offline' };
  const prev = store.devices()[info.id] || {};
  const users = new Set(prev.users || []);
  users.add(k.userId);
  const saved = store.upsertDevice({ ...info, host: k.ip, port: ADB_PORT, remote: true, tsName: k.tsName || '', tsTagged: true, users: [...users], lastSeen: Date.now() });
  return { state: 'done', deviceId: saved.id, name: saved.label || saved.deviceName || [saved.brand, saved.model].filter(Boolean).join(' ') };
}

function updateKey(keyId, patch) {
  const list = keys();
  const k = list.find((x) => x.keyId === keyId);
  if (!k) return null;
  Object.assign(k, patch);
  saveKeys(list);
  return k;
}

// Rattache les nouveaux appareils étiquetés aux clés en attente, puis relance l'ADB des TV rattachées
async function syncOnce() {
  const now = Date.now();
  const all = purge(keys(), now);
  const open = all.filter((k) => watched(k, now));
  if (!open.length) return { claimed: 0, ambiguous: 0 };
  const { tag } = config();
  const unclaimed = open.filter((k) => !k.claimedDeviceId);
  let claimed = 0;
  let ambiguous = 0;

  if (unclaimed.length) {
    const { devices = [] } = await call('GET', '/tailnet/-/devices?fields=all');
    const taken = new Set(all.map((k) => k.claimedDeviceId).filter(Boolean));
    const known = new Set(Object.values(store.devices()).map((d) => d.host));
    // Uniquement les appareils étiquetés TV, pas encore rattachés ni déjà enregistrés
    const candidates = devices.filter((d) => Array.isArray(d.tags) && d.tags.includes(tag) && !taken.has(String(d.id)) && ipv4(d) && !known.has(ipv4(d)));
    for (const d of candidates) {
      const match = unclaimed.filter((k) => !k.claimedDeviceId && inWindow(k, d));
      if (match.length !== 1) { if (match.length > 1) ambiguous++; continue; }
      const k = match[0];
      // La clé est à usage unique : si plusieurs nouveaux appareils tombent dans sa fenêtre, c'est ambigu aussi
      const rivals = candidates.filter((x) => inWindow(k, x));
      if (rivals.length !== 1) { ambiguous++; continue; }
      await call('POST', `/device/${encodeURIComponent(d.id)}/key`, { keyExpiryDisabled: true });
      Object.assign(k, { claimedDeviceId: String(d.id), claimedAt: Date.now(), ip: ipv4(d), tsName: d.hostname || String(d.name || '').split('.')[0], state: 'offline' });
      updateKey(k.keyId, { claimedDeviceId: k.claimedDeviceId, claimedAt: k.claimedAt, ip: k.ip, tsName: k.tsName, state: k.state });
      claimed++;
      console.log(`[Tailscale] TV rattachée à une clé en libre-service (${k.tsName || k.ip})`);
    }
  }

  // TV rattachées pas encore ajoutées : nouvelle tentative ADB (la fenêtre reste affichée tant qu'elle n'est pas acceptée)
  for (const k of keys().filter((x) => x.claimedDeviceId && watched(x, Date.now()))) {
    const r = await connectClaimed(k);
    updateKey(k.keyId, { state: r.state, ...(r.deviceId ? { deviceId: r.deviceId, name: r.name } : {}) });
  }
  saveKeys(purge(keys()));
  return { claimed, ambiguous };
}

// Une seule synchronisation à la fois, et pas plus d'une toutes les 10 s quand l'interface interroge souvent
let inFlight = null;
let lastSync = 0;
function sync({ force = false } = {}) {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastSync < 10000) return Promise.resolve(null);
  lastSync = Date.now();
  inFlight = syncOnce().finally(() => { inFlight = null; });
  return inFlight;
}

function keyState(k, now = Date.now()) {
  if (k.claimedDeviceId) return k.state || 'offline';
  return now > k.expiresAt ? 'expired' : 'waiting-device';
}

const publicKey = (k) => ({
  keyId: k.keyId, createdAt: k.createdAt, expiresAt: k.expiresAt, state: keyState(k),
  ...(k.state === 'done' && k.claimedDeviceId ? { deviceId: k.deviceId, name: k.name || '' } : {}),
});

async function pendingFor(user) {
  if (selfService()) {
    try { await sync(); } catch (e) { console.error('[Tailscale] rattachement :', e.message); }
  }
  return purge(keys()).filter((k) => k.userId === user.id).sort((a, b) => b.createdAt - a.createdAt).map(publicKey);
}

// Relance la fenêtre « Autoriser le débogage ? » de la TV rattachée à la clé
async function prompt(keyId, user) {
  const k = keys().find((x) => x.keyId === keyId);
  if (!k || (user.role !== 'admin' && k.userId !== user.id)) throw err('Clé introuvable.', 404);
  if (!k.claimedDeviceId || !k.ip) throw err("Aucune TV n'a encore rejoint le réseau avec cette clé.", 409);
  const r = await connectClaimed(k, { reconnect: true });
  updateKey(k.keyId, { state: r.state, ...(r.deviceId ? { deviceId: r.deviceId, name: r.name } : {}) });
  return { state: r.state, ...(r.deviceId ? { deviceId: r.deviceId, name: r.name } : {}) };
}

// Boucle de rattachement : toutes les 60 s tant qu'une clé est à surveiller, puis elle s'arrête
let loop = null;
function startLoop() {
  if (loop) return;
  loop = setInterval(() => {
    if (!selfService() || !keys().some((k) => watched(k))) { clearInterval(loop); loop = null; return; }
    sync({ force: true }).catch((e) => console.error('[Tailscale] rattachement :', e.message));
  }, LOOP_MS);
  loop.unref();
}
// Au démarrage : reprend la surveillance s'il reste des clés en attente
const start = () => { if (keys().some((k) => watched(k))) startLoop(); };

// ---------------------------------------------------------------------
// Contrôle de la politique d'accès (lecture seule)
// ---------------------------------------------------------------------
// Retire les commentaires et virgules finales du HuJSON (si l'API ne renvoie pas du JSON pur)
function parseHujson(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[++i] || ''; } else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function policyWarnings(policy, tag) {
  const warnings = [];
  const owners = policy.tagOwners || {};
  if (!Object.prototype.hasOwnProperty.call(owners, tag)) warnings.push(`L'étiquette ${tag} n'est pas déclarée dans « tagOwners » : Tailscale refusera les clés des TV.`);
  const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const check = (kind, rules, srcKey, dstKey) => asList(rules).forEach((r, i) => {
    const src = asList(r[srcKey]);
    const dst = asList(r[dstKey]);
    if (!dst.length) return;
    if (src.includes(tag)) warnings.push(`Règle « ${kind} » n°${i + 1} : les TV (${tag}) peuvent joindre ${dst.join(', ')}. Une TV ne devrait rien pouvoir joindre.`);
    else if (src.includes('*')) warnings.push(`Règle « ${kind} » n°${i + 1} : la source « * » inclut les TV (${tag}), qui peuvent alors joindre ${dst.join(', ')}.`);
  });
  check('acls', policy.acls, 'src', 'dst');
  check('grants', policy.grants, 'src', 'dst');
  check('ssh', policy.ssh, 'src', 'dst');
  return warnings;
}

// Résultat gardé 10 min ; vidé quand l'administrateur change les réglages Tailscale ou relance le contrôle
const POLICY_TTL_MS = 10 * 60 * 1000;
let policyCache = null; // { at, result }
const invalidatePolicy = () => { policyCache = null; };

async function checkPolicy({ force = true } = {}) {
  if (!force && policyCache && Date.now() - policyCache.at < POLICY_TTL_MS) return policyCache.result;
  const { tag } = config();
  let r;
  try {
    r = await call('GET', '/tailnet/-/acl', null, 'application/json');
  } catch (e) {
    if (e.status === 403 || e.status === 401) throw err("Impossible de lire les règles d'accès Tailscale : il manque le droit « Policy File : Read » au client OAuth (ou à la clé API).", 409);
    throw e;
  }
  let policy = r;
  if (r.raw !== undefined) {
    try { policy = parseHujson(r.raw); } catch { throw err('Politique Tailscale illisible.', 502); }
  }
  const warnings = policyWarnings(policy || {}, tag);
  const result = { ok: warnings.length === 0, warnings };
  policyCache = { at: Date.now(), result };
  return result;
}

// Pas de clé tant que la politique n'isole pas les TV (une clé préautorisée fait entrer n'importe quel appareil)
async function requireSafePolicy() {
  const r = await checkPolicy({ force: false });
  if (!r.ok) throw err("Les règles d'accès Tailscale du serveur n'isolent pas les TV : l'administrateur doit les corriger avant de distribuer des clés.", 409);
}

// Pour les tests : vide le cache du jeton OAuth et l'état de la synchronisation
const _reset = () => { tokenCache = null; policyCache = null; inFlight = null; lastSync = 0; if (loop) { clearInterval(loop); loop = null; } };

module.exports = {
  config, test, testOAuth, isolate, hasOAuth, hasCredentials, selfService, downloaderCode,
  createAuthKey, sync, pendingFor, prompt, start, checkPolicy, invalidatePolicy, policyWarnings, parseHujson, _reset,
};
