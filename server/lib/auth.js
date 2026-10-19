'use strict';
// Comptes, sessions et invitations. Le premier compte créé est administrateur ;
// les suivants s'inscrivent uniquement avec un code d'invitation.
const crypto = require('crypto');
const store = require('./store');

const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const COOKIE = 'atvm_session';

const users = () => store.read('users.json', {});
const saveUsers = (u) => store.write('users.json', u);
const sessions = () => store.read('sessions.json', {});
const saveSessions = (s) => store.write('sessions.json', s);
const invites = () => store.read('invites.json', {});
const saveInvites = (i) => store.write('invites.json', i);

const err = (message, code = 400) => Object.assign(new Error(message), { code });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function checkPassword(password, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const a = Buffer.from(hashPassword(password, salt).split('$')[2], 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validate({ username, name, password }) {
  username = String(username || '').trim().toLowerCase();
  name = String(name || '').trim().slice(0, 40);
  password = String(password || '');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw err("L'identifiant doit faire 3 à 32 caractères : lettres, chiffres, point, tiret.");
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw err('Le mot de passe doit faire au moins 8 caractères, avec au moins 1 lettre, 1 chiffre et 1 caractère spécial.');
  }
  if (password.length > 200) throw err('Mot de passe trop long.');
  return { username, name: name || username, password };
}

const publicUser = (u) => u && {
  id: u.id, username: u.username, name: u.name, role: u.role, createdAt: u.createdAt,
  twoFactor: !!u.totp, recoveryLeft: u.totp ? u.totp.recovery.length : 0,
};

function createUser(input, role) {
  const v = validate(input);
  const all = users();
  if (Object.values(all).some((u) => u.username === v.username)) throw err('Cet identifiant est déjà pris.', 409);
  const id = crypto.randomBytes(8).toString('hex');
  all[id] = { id, username: v.username, name: v.name, role, pass: hashPassword(v.password), createdAt: new Date().toISOString() };
  saveUsers(all);
  return all[id];
}

const needsSetup = () => Object.keys(users()).length === 0;

function setup(input) {
  if (!needsSetup()) throw err('Le compte administrateur existe déjà.', 409);
  return createUser(input, 'admin');
}

function register(input) {
  const code = String(input.invite || '').trim().toUpperCase();
  const all = invites();
  const inv = all[code];
  if (!inv || inv.used || Date.parse(inv.expiresAt) < Date.now()) throw err("Code d'invitation invalide ou expiré.", 403);
  const user = createUser(input, 'user');
  inv.used = true;
  inv.usedBy = user.id;
  inv.usedAt = new Date().toISOString();
  saveInvites(all);
  return user;
}

// --- Limitation des tentatives de connexion (par adresse IP, en mémoire)
const attempts = new Map();
function throttle(ip) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) throw err('Trop de tentatives. Réessaie dans quelques minutes.', 429);
}
function failed(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 5) { a.until = Date.now() + 5 * 60 * 1000; a.count = 0; }
  attempts.set(ip, a);
}

function login({ username, password }, ip) {
  throttle(ip);
  const u = Object.values(users()).find((x) => x.username === String(username || '').trim().toLowerCase());
  if (!u || !checkPassword(String(password || ''), u.pass)) {
    failed(ip);
    throw err('Identifiant ou mot de passe incorrect.', 401);
  }
  attempts.delete(ip);
  return u;
}

// --- Sessions : le jeton n'est stocké que sous forme de hachage
function openSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const all = sessions();
  const now = Date.now();
  for (const [k, s] of Object.entries(all)) if (Date.parse(s.expiresAt) < now) delete all[k];
  all[sha256(token)] = { userId: user.id, expiresAt: new Date(now + SESSION_DAYS * 864e5).toISOString() };
  saveSessions(all);
  return token;
}

function closeSession(token) {
  if (!token) return;
  const all = sessions();
  delete all[sha256(token)];
  saveSessions(all);
}

function closeUserSessions(userId) {
  const all = sessions();
  for (const [k, s] of Object.entries(all)) if (s.userId === userId) delete all[k];
  saveSessions(all);
}

function cookieToken(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`).exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

function currentUser(req) {
  const token = cookieToken(req);
  if (!token) return null;
  const s = sessions()[sha256(token)];
  if (!s || Date.parse(s.expiresAt) < Date.now()) return null;
  return users()[s.userId] || null;
}

function sessionCookie(req, token, clear = false) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return clear
    ? `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
    : `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

// --- Administration
function createInvite(byUser, note) {
  const all = invites();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join(''); } while (all[code]);
  all[code] = { code, note: String(note || '').trim().slice(0, 60), createdBy: byUser.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(), used: false };
  saveInvites(all);
  return all[code];
}

function listInvites() {
  const now = Date.now();
  return Object.values(invites()).filter((i) => !i.used && Date.parse(i.expiresAt) > now).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function revokeInvite(code) {
  const all = invites();
  if (!all[code]) throw err('Invitation introuvable.', 404);
  delete all[code];
  saveInvites(all);
}

function deleteUser(id, byUser) {
  const all = users();
  if (!all[id]) throw err('Compte introuvable.', 404);
  if (id === byUser.id) throw err('Tu ne peux pas supprimer ton propre compte.');
  delete all[id];
  saveUsers(all);
  closeUserSessions(id);
  // Retire ce compte des TV partagées
  const devs = store.devices();
  for (const d of Object.values(devs)) if (Array.isArray(d.users)) d.users = d.users.filter((u) => u !== id);
  store.saveDevices(devs);
}

function changePassword(user, current, next) {
  if (!checkPassword(String(current || ''), user.pass)) throw err('Mot de passe actuel incorrect.', 403);
  const { password } = validate({ username: user.username, password: next });
  const all = users();
  all[user.id].pass = hashPassword(password);
  saveUsers(all);
}

const listUsers = () => Object.values(users()).map(publicUser).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

// =====================================================================
// Double authentification (TOTP, RFC 6238) — optionnelle, par compte
// =====================================================================
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
// Renvoie le pas de temps accepté (fenêtre ±1 × 30 s), ou -1
function totpMatch(secret, code, lastStep = -1) {
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastStep) continue; // un code déjà utilisé ne sert pas deux fois
    const expected = totpAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return -1;
}
const cleanCode = (c) => String(c || '').replace(/[\s-]/g, '').toUpperCase();

function twoFactorBegin(user) {
  const all = users();
  const secret = base32Encode(crypto.randomBytes(20));
  all[user.id].totpPending = secret;
  saveUsers(all);
  const label = encodeURIComponent(`ATV Manager:${user.username}`);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=ATV%20Manager&algorithm=SHA1&digits=6&period=30` };
}

function twoFactorEnable(user, code) {
  const all = users();
  const u = all[user.id];
  const c = cleanCode(code);
  if (!u.totpPending) throw err("Recommence l'activation.");
  if (!/^\d{6}$/.test(c)) throw err('Entre le code à 6 chiffres de ton application.');
  const step = totpMatch(u.totpPending, c);
  if (step < 0) throw err("Code incorrect. Vérifie l'heure de ton téléphone et réessaie.", 403);
  const recovery = Array.from({ length: 8 }, () => {
    const s = Array.from(crypto.randomBytes(8), (b) => B32[b % 32]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  u.totp = { secret: u.totpPending, lastStep: step, recovery: recovery.map((r) => sha256(cleanCode(r))), enabledAt: new Date().toISOString() };
  delete u.totpPending;
  saveUsers(all);
  return { recovery };
}

function twoFactorDisable(user, password) {
  if (!checkPassword(String(password || ''), user.pass)) throw err('Mot de passe incorrect.', 403);
  const all = users();
  delete all[user.id].totp;
  delete all[user.id].totpPending;
  saveUsers(all);
}

function twoFactorReset(id) {
  const all = users();
  if (!all[id]) throw err('Compte introuvable.', 404);
  delete all[id].totp;
  delete all[id].totpPending;
  saveUsers(all);
}

// Après un mot de passe correct, un ticket de 5 minutes attend le second facteur
const tickets = new Map();
function issueTicket(user) {
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { userId: user.id, expires: Date.now() + 5 * 60 * 1000, tries: 0 });
  return ticket;
}

function twoFactorLogin(ticket, code, ip) {
  throttle(ip);
  const t = tickets.get(String(ticket || ''));
  if (!t || t.expires < Date.now()) { tickets.delete(ticket); throw err('Session expirée, reconnecte-toi.', 401); }
  const all = users();
  const u = all[t.userId];
  if (!u || !u.totp) { tickets.delete(ticket); throw err('Session expirée, reconnecte-toi.', 401); }
  const c = cleanCode(code);
  let ok = false;
  if (/^\d{6}$/.test(c)) {
    const step = totpMatch(u.totp.secret, c, u.totp.lastStep);
    if (step >= 0) { u.totp.lastStep = step; ok = true; }
  } else if (c.length >= 8) {
    const h = sha256(c);
    const i = u.totp.recovery.indexOf(h);
    if (i >= 0) { u.totp.recovery.splice(i, 1); ok = true; } // code de secours à usage unique
  }
  if (!ok) {
    failed(ip);
    if (++t.tries >= 5) tickets.delete(ticket);
    throw err('Code incorrect.', 401);
  }
  saveUsers(all);
  tickets.delete(ticket);
  attempts.delete(ip);
  return u;
}

module.exports = {
  needsSetup, setup, register, login, openSession, closeSession, closeUserSessions, cookieToken, currentUser, sessionCookie,
  createInvite, listInvites, revokeInvite, deleteUser, changePassword, listUsers, publicUser,
  twoFactorBegin, twoFactorEnable, twoFactorDisable, twoFactorReset, issueTicket, twoFactorLogin,
};
