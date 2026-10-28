'use strict';
// Notifications à l'administrateur (optionnelles), sur deux canaux indépendants :
// - Gotify : adresse et jeton dans les réglages (notify.gotifyUrl / notify.gotifyToken) ou les variables
//   d'environnement GOTIFY_URL / GOTIFY_TOKEN. Le jeton part dans l'en-tête X-Gotify-Key (et non dans l'adresse,
//   qui peut finir dans les journaux d'un proxy).
// - Webhook (Home Assistant par exemple) : adresse dans les réglages (notify.webhookUrl) ou NOTIFY_WEBHOOK_URL.
//   Elle contient un identifiant secret : jamais renvoyée à l'interface ni écrite dans les journaux.
// Les secrets (jeton, adresse du webhook) ne sont jamais renvoyés à l'interface ni journalisés.
const store = require('./store');

const TIMEOUT_MS = 8000;
const WEBHOOK_TIMEOUT_MS = 10000;
const err = (message, code = 400) => Object.assign(new Error(message), { code });

const cleanUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

function config() {
  const n = store.settings().notify || {};
  const gotifyUrl = cleanUrl(n.gotifyUrl || process.env.GOTIFY_URL);
  const gotifyToken = String(n.gotifyToken || process.env.GOTIFY_TOKEN || '').trim();
  const webhookUrl = String(n.webhookUrl || process.env.NOTIFY_WEBHOOK_URL || '').trim();
  return { gotifyUrl, gotifyToken, webhookUrl };
}

const hasGotify = (c = config()) => !!(c.gotifyUrl && c.gotifyToken);
const hasWebhook = (c = config()) => !!c.webhookUrl;

// Réglages renvoyés à l'interface (sans le jeton ni l'adresse du webhook)
const publicConfig = () => { const c = config(); return { hasGotify: hasGotify(c), gotifyUrl: c.gotifyUrl, hasWebhook: hasWebhook(c) }; };

// Vérifie l'adresse saisie : http(s), sans identifiants intégrés ; chaîne vide = suppression
function validUrl(raw) {
  const v = cleanUrl(raw);
  if (!v) return '';
  let u;
  try { u = new URL(v); } catch { throw err("L'adresse Gotify est invalide (exemple : https://gotify.exemple.fr)."); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) throw err("L'adresse Gotify est invalide (exemple : https://gotify.exemple.fr).");
  return v;
}

function validToken(raw) {
  const v = String(raw || '').trim();
  if (v && !/^[\w.-]{4,200}$/.test(v)) throw err('Le jeton Gotify est invalide.');
  return v;
}

// Adresse du webhook : http(s), sans identifiant:mot de passe ; chaîne vide = suppression.
// Le message d'erreur ne reprend jamais l'adresse saisie.
function validWebhookUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  const bad = () => err("L'adresse du webhook est invalide (exemple : https://homeassistant.local:8123/api/webhook/…).");
  let u;
  try { u = new URL(v); } catch { throw bad(); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.hash || v.length > 500) throw bad();
  return v;
}

// Adresse publique du site (lien joint aux notifications) : PUBLIC_URL, sinon celle retenue lors d'une requête
// de l'administrateur (voir rememberSite), sinon rien
function siteUrl() {
  const env = cleanUrl(process.env.PUBLIC_URL);
  if (env) return env;
  return cleanUrl(store.settings().publicUrl) || '';
}
function rememberSite(req) {
  if (cleanUrl(process.env.PUBLIC_URL)) return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return;
  const proto = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http';
  const url = `${proto}://${host}`;
  const s = store.settings();
  if (s.publicUrl !== url) { s.publicUrl = url; store.saveSettings(s); }
}

// --- Canal Gotify ; lève une erreur sans jamais citer le jeton
async function sendGotify(c, title, message, priority) {
  let res;
  try {
    res = await fetch(`${c.gotifyUrl}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gotify-Key': c.gotifyToken },
      body: JSON.stringify({ title, message, priority }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw err('Le serveur Gotify ne répond pas.', 502);
  }
  if (res.status === 401 || res.status === 403) throw err('Gotify refuse le jeton (jeton d’application incorrect ou supprimé).', 502);
  if (!res.ok) throw err(`Gotify a renvoyé une erreur (${res.status}).`, 502);
}

// --- Canal webhook ; lève une erreur sans jamais citer l'adresse
async function sendWebhook(c, title, message) {
  const url = siteUrl();
  let res;
  try {
    res = await fetch(c.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message, ...(url ? { url } : {}) }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
  } catch {
    throw err('Le webhook ne répond pas.', 502);
  }
  if (!res.ok) throw err(`Le webhook a renvoyé une erreur (${res.status}).`, 502);
}

// Envoie à tous les canaux configurés, sans rien lever : { gotify, webhook } = 'ok' | 'absent' | 'erreur'
async function sendAll(title, message, priority = 5) {
  const c = config();
  const out = { gotify: 'absent', webhook: 'absent' };
  const errors = {};
  const run = async (name, fn) => {
    try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = 'erreur'; errors[name] = e; console.error(`[Notification] ${name} : ${e.message}`); }
  };
  await Promise.all([
    hasGotify(c) && run('gotify', () => sendGotify(c, title, message, priority)),
    hasWebhook(c) && run('webhook', () => sendWebhook(c, title, message)),
  ]);
  return { ...out, errors };
}

// Envoi à tous les canaux : erreur 409 si aucun n'est configuré, 502 (premier message) si tous ont échoué
async function send(title, message, priority = 5) {
  const r = await sendAll(title, message, priority);
  const states = [r.gotify, r.webhook];
  if (states.every((s) => s === 'absent')) throw err("Aucune notification n'est configurée (Gotify ou webhook).", 409);
  if (!states.includes('ok')) throw r.errors.gotify || r.errors.webhook;
  return { ok: true, gotify: r.gotify, webhook: r.webhook };
}

// Test depuis les réglages : état de chaque canal
async function testAll() {
  const { gotify, webhook } = await sendAll('OptiTV : test', 'Les notifications de ton serveur OptiTV fonctionnent.', 5);
  return { gotify, webhook };
}

// Notification « au mieux » : rien ne remonte à l'utilisateur, simple ligne de journal en cas d'échec
async function notifyAdmin(title, message, priority = 5) {
  const r = await sendAll(title, message, priority);
  return r.gotify === 'ok' || r.webhook === 'ok';
}

module.exports = { config, hasGotify, hasWebhook, publicConfig, validUrl, validToken, validWebhookUrl, siteUrl, rememberSite, send, testAll, notifyAdmin };
