'use strict';
// Tailscale, mode « code TV » (semi-automatique) : sur l'écran « Log in » de Tailscale TV, un code de 10 à
// 15 caractères s'affiche sous le QR code. Seul un administrateur du réseau Tailscale peut le valider, dans sa
// console (Add device › Client device › Android › Input code) : aucune API ne le permet.
//
// 1. l'utilisateur donne ce code au site (demande « waiting-admin », l'administrateur est prévenu) ;
// 2. l'administrateur le valide dans la console Tailscale, puis choisit ici l'appareil apparu ;
// 3. le serveur étiquette l'appareil, désactive l'expiration de sa clé et s'y connecte en ADB
//    (fenêtre « Autoriser le débogage ? » sur la TV), comme pour une TV ajoutée avec une clé.
const crypto = require('crypto');
const store = require('./store');
const TS = require('./tailscale');
const NT = require('./notify');

const FILE = 'tscodes.json';
const EXPIRE_MS = 2 * 3600 * 1000; // une demande non traitée expire au bout de 2 h
const KEEP_MS = 24 * 3600 * 1000; // historique gardé 24 h (affichage et limite)
const PER_HOUR = 3; // demandes par utilisateur et par heure
const SKEW_MS = 2 * 60 * 1000; // l'appareil peut avoir été créé un peu avant la demande
const LOOP_MS = 60 * 1000;
const CONSOLE_URL = 'https://console.tailscale.com/admin/machines';

const err = (message, code = 400) => Object.assign(new Error(message), { code });

// --- Stockage
const purge = (list, now = Date.now()) => list.filter((r) => now - r.createdAt < KEEP_MS);
const saveAll = (list) => store.write(FILE, list);

// Lecture avec expiration des demandes trop anciennes (enregistrée si quelque chose a changé)
function requests(now = Date.now()) {
  const raw = store.read(FILE, []);
  const list = purge(Array.isArray(raw) ? raw : [], now);
  let changed = list.length !== (Array.isArray(raw) ? raw.length : 0);
  for (const r of list) {
    if (r.status === 'waiting-admin' && now - r.createdAt >= EXPIRE_MS) { r.status = 'expired'; changed = true; }
  }
  if (changed) saveAll(list);
  return list;
}

function update(id, patch) {
  const list = requests();
  const r = list.find((x) => x.id === id);
  if (!r) return null;
  Object.assign(r, patch);
  saveAll(list);
  return r;
}

// Majuscules, sans espaces ni tirets ; 6 à 24 lettres ou chiffres
function normalize(raw) {
  const code = String(raw || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{6,24}$/.test(code)) throw err('Code invalide : recopie les 10 à 15 lettres et chiffres affichés sous le QR code de Tailscale.');
  return code;
}

// --- 1. Demande de l'utilisateur
let lastNotify = Promise.resolve(false); // pour les tests : dernière notification envoyée

async function create(user, rawCode) {
  if (!TS.selfService()) throw err("L'accès à distance par Tailscale n'est pas disponible sur ce serveur.", 409);
  const code = normalize(rawCode);
  const now = Date.now();
  const list = requests(now);
  const recent = list.filter((r) => r.userId === user.id && now - r.createdAt < 3600 * 1000);
  if (recent.length >= PER_HOUR) throw err(`Tu as déjà envoyé ${PER_HOUR} codes dans l'heure. Réessaie un peu plus tard.`, 429);
  await TS.requireSafePolicy();
  const userName = String(user.name || user.username || '').slice(0, 40);
  const r = { id: crypto.randomBytes(8).toString('hex'), userId: user.id, userName, code, createdAt: now, status: 'waiting-admin' };
  list.push(r);
  saveAll(list);
  // Notification « au mieux », sans attendre : l'utilisateur n'a pas à patienter pour Gotify
  lastNotify = NT.notifyAdmin('OptiTV : TV à valider', `${userName} demande l'ajout d'une TV. Code : ${code}. Console : ${CONSOLE_URL}`, 6);
  return { id: r.id, status: r.status };
}

// --- 2. Liste : les siennes pour un utilisateur, toutes pour l'administrateur
const isAdmin = (u) => u && u.role === 'admin';

function publicRequest(r, admin) {
  return {
    id: r.id, code: r.code, createdAt: r.createdAt, status: r.status,
    ...(r.status === 'done' && r.deviceId ? { deviceId: r.deviceId, name: r.name || '' } : {}),
    ...(admin ? { userId: r.userId, userName: r.userName || '', ...(r.tsName ? { tsName: r.tsName } : {}) } : {}),
  };
}

async function listFor(user) {
  try { await sync(); } catch (e) { console.error('[Tailscale] code TV :', e.message); }
  const admin = isAdmin(user);
  return requests().filter((r) => admin || r.userId === user.id).sort((a, b) => b.createdAt - a.createdAt).map((r) => publicRequest(r, admin));
}

const waitingCount = () => requests().filter((r) => r.status === 'waiting-admin').length;

function find(id) {
  const r = requests().find((x) => x.id === String(id));
  if (!r) throw err('Demande introuvable.', 404);
  return r;
}

// --- 3. Appareils susceptibles d'être la TV (administrateur)
const deviceTime = (d) => Date.parse(d.created || '') || 0;
const looksLikeTv = (d) => String(d.os || '').toLowerCase() === 'android' || /tv|fire|aft/i.test(`${d.hostname || ''} ${d.name || ''}`);

async function candidatesOf(r) {
  const { devices = [] } = await TS.call('GET', '/tailnet/-/devices?fields=all');
  const known = new Set(Object.values(store.devices()).map((d) => d.host));
  const taken = new Set(requests().filter((x) => x.tsId && x.id !== r.id).map((x) => x.tsId));
  return devices.filter((d) => !(Array.isArray(d.tags) && d.tags.length) // pas encore étiqueté
    && looksLikeTv(d)
    && deviceTime(d) >= r.createdAt - SKEW_MS
    && !taken.has(String(d.id))
    && !(TS.ipv4(d) && known.has(TS.ipv4(d))));
}

const publicCandidate = (d) => ({
  tsId: String(d.id), hostname: d.hostname || '', name: d.name || '', os: d.os || '', created: d.created || '', addresses: d.addresses || [],
});

async function candidates(id) {
  const r = find(id);
  if (r.status !== 'waiting-admin') throw err('Cette demande est déjà traitée ou expirée.', 409);
  return (await candidatesOf(r)).map(publicCandidate);
}

// --- 4. Rattachement par l'administrateur
const busy = new Set();

// Erreur de pose d'étiquette : message adapté (client OAuth sans droit sur l'étiquette, tagOwners…)
function tagError(e, tag) {
  if ([400, 403].includes(e.status) || /étiquette/.test(e.message)) {
    return err(`Tailscale refuse de poser l'étiquette ${tag} : elle doit être déclarée dans « tagOwners » et autorisée pour le client OAuth (droit « Devices : Core » en écriture avec cette étiquette).`, 502);
  }
  return e;
}

async function attach(id, rawTsId) {
  const tsId = String(rawTsId || '').trim();
  if (!tsId) throw err('Choisis un appareil.');
  if (busy.has(id)) throw err('Rattachement déjà en cours.', 409);
  busy.add(id);
  try {
    const r = find(id);
    if (r.status !== 'waiting-admin') throw err('Cette demande est déjà traitée ou expirée.', 409);
    await TS.requireSafePolicy();
    const d = (await candidatesOf(r)).find((x) => String(x.id) === tsId);
    if (!d) throw err("Cet appareil ne correspond pas à la demande (déjà étiqueté, trop ancien ou déjà enregistré).", 409);
    const ip = TS.ipv4(d);
    if (!ip) throw err("Cet appareil n'a pas d'adresse Tailscale IPv4.", 409);
    const { tag } = TS.config();
    try {
      await TS.call('POST', `/device/${encodeURIComponent(tsId)}/tags`, { tags: [tag] });
    } catch (e) { throw tagError(e, tag); }
    // Un appareil étiqueté n'expire normalement plus ; on le demande quand même explicitement
    try {
      await TS.call('POST', `/device/${encodeURIComponent(tsId)}/key`, { keyExpiryDisabled: true });
    } catch (e) { console.error(`[Tailscale] code TV : expiration non désactivée (${e.message})`); }
    const tsName = d.hostname || String(d.name || '').split('.')[0];
    update(id, { tsId, ip, tsName, attachedAt: Date.now(), status: 'offline' });
    console.log(`[Tailscale] TV rattachée par code (${tsName || ip})`);
    startLoop(); // relance ADB pendant 1 h, même si la première tentative échoue
    const res = await TS.connectClaimed({ ip, tsName, userId: r.userId });
    update(id, { status: res.state, ...(res.deviceId ? { deviceId: res.deviceId, name: res.name } : {}) });
    return { status: res.state, ...(res.deviceId ? { deviceId: res.deviceId, name: res.name } : {}) };
  } finally {
    busy.delete(id);
  }
}

// --- 5. Refus (administrateur) et relance de la fenêtre d'autorisation (propriétaire ou administrateur)
function reject(id) {
  const r = find(id);
  if (r.status !== 'waiting-admin') throw err('Cette demande est déjà traitée ou expirée.', 409);
  update(id, { status: 'rejected' });
  return { status: 'rejected' };
}

async function prompt(id, user) {
  const r = requests().find((x) => x.id === String(id));
  if (!r || (!isAdmin(user) && r.userId !== user.id)) throw err('Demande introuvable.', 404);
  if (!r.tsId || !r.ip) throw err("Cette TV n'a pas encore été validée par l'administrateur.", 409);
  const res = await TS.connectClaimed({ ip: r.ip, tsName: r.tsName, userId: r.userId }, { reconnect: true });
  update(r.id, { status: res.state, ...(res.deviceId ? { deviceId: res.deviceId, name: res.name } : {}) });
  return { status: res.state, ...(res.deviceId ? { deviceId: res.deviceId, name: res.name } : {}) };
}

// --- Relance ADB des TV rattachées pas encore ajoutées, pendant 1 h (comme pour les clés)
const watched = (r, now = Date.now()) => r.tsId && ['waiting-auth', 'offline'].includes(r.status) && now - (r.attachedAt || 0) < TS.CLAIM_RETRY_MS;

async function syncOnce() {
  for (const r of requests().filter((x) => watched(x))) {
    const res = await TS.connectClaimed({ ip: r.ip, tsName: r.tsName, userId: r.userId });
    update(r.id, { status: res.state, ...(res.deviceId ? { deviceId: res.deviceId, name: res.name } : {}) });
  }
}

// Une seule relance à la fois, pas plus d'une toutes les 10 s quand l'interface interroge souvent
let inFlight = null;
let lastSync = 0;
function sync({ force = false } = {}) {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastSync < 10000) return Promise.resolve(null);
  if (!requests().some((x) => watched(x))) return Promise.resolve(null);
  lastSync = Date.now();
  inFlight = syncOnce().finally(() => { inFlight = null; });
  return inFlight;
}

let loop = null;
function startLoop() {
  if (loop) return;
  loop = setInterval(() => {
    if (!requests().some((x) => watched(x))) { clearInterval(loop); loop = null; return; }
    sync({ force: true }).catch((e) => console.error('[Tailscale] code TV :', e.message));
  }, LOOP_MS);
  loop.unref();
}
// Au démarrage : reprend la relance s'il reste des TV rattachées en attente
const start = () => { if (requests().some((x) => watched(x))) startLoop(); };

// Pour les tests
const _reset = () => { inFlight = null; lastSync = 0; busy.clear(); if (loop) { clearInterval(loop); loop = null; } };
const _lastNotify = () => lastNotify;

module.exports = { normalize, create, listFor, waitingCount, candidates, attach, reject, prompt, sync, start, _reset, _lastNotify };
