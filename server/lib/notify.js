'use strict';
// Notifications à l'administrateur (optionnelles) : serveur Gotify.
// L'adresse et le jeton viennent des réglages (notify.gotifyUrl / notify.gotifyToken) ou des variables
// d'environnement GOTIFY_URL / GOTIFY_TOKEN. Le jeton n'est jamais renvoyé à l'interface ni écrit dans les journaux :
// il part dans l'en-tête X-Gotify-Key (et non dans l'adresse, qui peut finir dans les journaux d'un proxy).
const store = require('./store');

const TIMEOUT_MS = 8000;
const err = (message, code = 400) => Object.assign(new Error(message), { code });

const cleanUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

function config() {
  const n = store.settings().notify || {};
  const gotifyUrl = cleanUrl(n.gotifyUrl || process.env.GOTIFY_URL);
  const gotifyToken = String(n.gotifyToken || process.env.GOTIFY_TOKEN || '').trim();
  return { gotifyUrl, gotifyToken };
}

const hasGotify = (c = config()) => !!(c.gotifyUrl && c.gotifyToken);

// Réglages renvoyés à l'interface (sans le jeton)
const publicConfig = () => { const c = config(); return { hasGotify: hasGotify(c), gotifyUrl: c.gotifyUrl }; };

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

// Envoi brut ; lève une erreur sans jamais citer le jeton
async function send(title, message, priority = 5) {
  const c = config();
  if (!hasGotify(c)) throw err("Aucun serveur Gotify n'est configuré.", 409);
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
  return { ok: true };
}

// Notification « au mieux » : rien ne remonte à l'utilisateur, simple ligne de journal en cas d'échec
async function notifyAdmin(title, message, priority = 5) {
  if (!hasGotify()) return false;
  try {
    await send(title, message, priority);
    return true;
  } catch (e) {
    console.error(`[Notification] Gotify : ${e.message}`);
    return false;
  }
}

module.exports = { config, hasGotify, publicConfig, validUrl, validToken, send, notifyAdmin };
