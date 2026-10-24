'use strict';
// ATVM Connect : une appli installée sur la TV ouvre une connexion WebSocket sortante vers ATV Manager.
// Le serveur lui envoie des commandes shell, qu'elle exécute via l'ADB local de la TV (127.0.0.1:5555).
// Aucun port à ouvrir chez le proche, pas de Tailscale.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const store = require('./store');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 32 * 1024 * 1024;
const PAIR_MINUTES = 1;

const err = (message, code = 400) => Object.assign(new Error(message), { code });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------------
// WebSocket minimal (RFC 6455), côté serveur
// ---------------------------------------------------------------------
class WsConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_FRAME) return this.close(1009);
      if (!masked) return this.close(1002); // un client doit masquer ses trames
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (op === 0x8) return this.close(1000);
      if (op === 0x9) { this.frame(0xA, payload); continue; }
      if (op === 0xA) { this.alive = true; continue; }
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        if (op !== 0x0) this.binary = op === 0x2;
        this.parts.push(payload);
        if (fin) {
          const data = Buffer.concat(this.parts);
          this.parts = [];
          // Trames binaires : flux vidéo relayé par ATVM Connect
          if (this.binary) this.emit('binary', data);
          else this.emit('message', data.toString('utf8'));
        }
      }
    }
  }

  frame(op, payload = Buffer.alloc(0)) {
    if (this.closed) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.from([0x80 | op, len]); }
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(obj) { this.frame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')); }
  ping() { this.frame(0x9); }

  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code, 0);
    try { this.frame(0x8, p); } catch { /* socket déjà fermé */ }
    this.socket.end();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.emit('close');
  }
}

// ---------------------------------------------------------------------
// Registre des agents
// ---------------------------------------------------------------------
const agents = () => store.read('agents.json', {});
const saveAgents = (a) => store.write('agents.json', a);

const online = new Map(); // agentId -> { conn, adb, message, pending, seq, version }
const pairCodes = new Map(); // code -> { userId, expires }
const pairAttempts = new Map(); // ip -> { count, until }

function createPairCode(user) {
  for (const [c, p] of pairCodes) if (p.expires < Date.now() || p.userId === user.id) pairCodes.delete(c);
  let code;
  do { code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); } while (pairCodes.has(code));
  pairCodes.set(code, { userId: user.id, expires: Date.now() + PAIR_MINUTES * 60000 });
  return { code, expiresIn: PAIR_MINUTES * 60 };
}

// Appelé par l'appli sur la TV avec le code affiché dans ATV Manager
function pair(code, name, ip) {
  const a = pairAttempts.get(ip) || { count: 0, until: 0 };
  if (a.until > Date.now()) throw err('Trop de tentatives. Réessaie dans 10 minutes.', 429);
  const c = String(code || '').replace(/\D/g, '');
  const p = pairCodes.get(c);
  if (!p || p.expires < Date.now()) {
    a.count += 1;
    if (a.count >= 8) { a.count = 0; a.until = Date.now() + 10 * 60000; }
    pairAttempts.set(ip, a);
    throw err('Code incorrect ou expiré. Génère un nouveau code dans ATV Manager.', 403);
  }
  pairCodes.delete(c);
  pairAttempts.delete(ip);
  const id = crypto.randomBytes(8).toString('hex');
  const token = crypto.randomBytes(32).toString('hex');
  const all = agents();
  // Une nouvelle association de la même TV par la même personne remplace les tentatives restées en attente
  const label = String(name || '').slice(0, 60);
  for (const old of Object.values(all)) {
    if (old.userId === p.userId && !old.deviceId && old.name === label) {
      delete all[old.id];
      online.get(old.id)?.conn.close(4001);
    }
  }
  all[id] = { id, tokenHash: sha256(token), userId: p.userId, name: String(name || '').slice(0, 60), createdAt: new Date().toISOString(), deviceId: null };
  saveAgents(all);
  return { agentId: id, token };
}

function revoke(agentId) {
  const all = agents();
  delete all[agentId];
  saveAgents(all);
  const o = online.get(agentId);
  if (o) o.conn.close(4001);
}

const isOnline = (agentId) => online.has(agentId);
const status = (agentId) => {
  const o = online.get(agentId);
  return o ? { online: true, adb: o.adb, message: o.message, version: o.version } : { online: false };
};

// Exécute une commande shell sur la TV via l'agent ; même format de réponse que adb.js
function call(agentId, cmd, timeout = 15000) {
  const o = online.get(agentId);
  if (!o) return Promise.resolve({ ok: false, out: '', err: 'TV hors ligne' });
  const id = ++o.seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { o.pending.delete(id); resolve({ ok: false, out: '', err: 'délai dépassé' }); }, timeout + 2000);
    o.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    o.conn.send({ type: 'exec', id, cmd, timeout });
  });
}

// Installation d'une APK : l'appli de la TV la télécharge elle-même puis l'installe (ATVM Connect 0.8.0 et plus)
function install(agentId, url, timeout = 300000) {
  const o = online.get(agentId);
  if (!o) return Promise.resolve({ ok: false, out: '', err: 'TV hors ligne' });
  const id = ++o.seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      o.pending.delete(id);
      resolve({ ok: false, out: '', err: "Pas de réponse de la TV : mets ATVM Connect à jour (version 0.8.0 ou plus), puis réessaie." });
    }, timeout + 2000);
    o.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    o.conn.send({ type: 'install', id, url, timeout });
  });
}

// ---------------------------------------------------------------------
// Dépannage à distance (ATVM Connect 0.11.0 et plus)
// ---------------------------------------------------------------------
// Capture d'écran réduite en JPEG par l'appli (réponse en base64 dans « out »)
function screenshot(agentId, timeout = 30000) {
  const o = online.get(agentId);
  if (!o) return Promise.resolve({ ok: false, out: '', err: 'TV hors ligne' });
  const id = ++o.seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { o.pending.delete(id); resolve({ ok: false, out: '', err: 'délai dépassé' }); }, timeout);
    o.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    o.conn.send({ type: 'screenshot', id, maxSize: 1280, quality: 70 });
  });
}

// Bandeau « Accès à distance : dépannage en cours » sur la TV ; il disparaît seul après ttl ms sans rafraîchissement
function banner(agentId, on, ttl) {
  online.get(agentId)?.conn.send({ type: 'banner', on: !!on, ttl });
}

// Vidéo : l'appli lance scrcpy-server sur la TV et relaie le flux en trames binaires (4 octets d'identifiant + données)
const videos = new Map(); // sid -> { agentId, onData, onEnd }
let videoSeq = 0;
function videoStart(agentId, opts, onData, onEnd) {
  const o = online.get(agentId);
  const sid = ++videoSeq;
  if (!o) { setImmediate(onEnd); return sid; }
  videos.set(sid, { agentId, onData, onEnd });
  o.conn.send({ type: 'video-start', sid, ...opts });
  return sid;
}
function videoStop(agentId, sid) {
  if (!videos.delete(sid)) return;
  online.get(agentId)?.conn.send({ type: 'video-stop', sid });
}
function videoEnd(sid) {
  const v = videos.get(sid);
  if (!v) return;
  videos.delete(sid);
  v.onEnd();
}

// Version de l'appli au moins égale à min
const supports = (version, min) => !!version && !isNewer(min, version);

// Journal (docker logs atv-manager) : une ligne par changement d'état d'une TV ATVM Connect
const log = (a, text) => console.log(`[ATVM Connect] ${(a && a.name) || 'TV'} (${(a && a.id) || '?'}) : ${text}`);

// ---------------------------------------------------------------------
// Mise à jour automatique d'ATVM Connect (appli 0.10.0 et plus)
// ---------------------------------------------------------------------
// Version proposée : celle de data/connect.json si une APK est posée dans data/ (servie par /connect.apk),
// sinon la dernière release GitHub. La TV télécharge /connect.apk puis s'installe elle-même par son ADB local.
const RELEASES_API = process.env.AGENT_RELEASES_API || 'https://api.github.com/repos/BenRlc18/atv-manager/releases/latest';
const UPDATE_CHECK_MS = 6 * 3600000;
const gh = { version: '', at: 0 };

async function latestVersion() {
  if (fs.existsSync(path.join(store.DATA_DIR, 'connect.apk'))) return String(store.read('connect.json', {}).version || '');
  if (Date.now() - gh.at > UPDATE_CHECK_MS) {
    gh.at = Date.now();
    try {
      const r = await fetch(RELEASES_API, { headers: { 'User-Agent': 'atv-manager' }, signal: AbortSignal.timeout(10000) });
      const m = String((await r.json()).tag_name || '').match(/(\d+\.\d+\.\d+)/);
      if (m) gh.version = m[1];
    } catch { /* GitHub injoignable : nouvel essai au prochain contrôle */ }
  }
  return gh.version;
}

const vparts = (v) => String(v || '').split('.').map((x) => parseInt(x, 10) || 0);
function isNewer(a, b) {
  const x = vparts(a);
  const y = vparts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// Propose la mise à jour une fois par connexion (et de nouveau quand le débogage vient d'être autorisé)
async function offerUpdate(agentId) {
  const o = online.get(agentId);
  if (!o || !o.version || o.adb !== 'ok') return;
  const latest = await latestVersion();
  if (!latest || !isNewer(latest, o.version) || o.offered === latest || online.get(agentId) !== o) return;
  o.offered = latest;
  o.conn.send({ type: 'update', version: latest, url: '/connect.apk' });
  log(agents()[agentId], `mise à jour proposée : ${o.version} → ${latest}`);
}

setInterval(() => { for (const id of online.keys()) offerUpdate(id).catch(() => {}); }, UPDATE_CHECK_MS).unref();

// Callbacks fournis par devices.js (évite une dépendance circulaire)
let onAgentReady = null;
const setReadyHandler = (fn) => { onAgentReady = fn; };

// Poignée de main WebSocket ; renvoie la connexion, ou null si la requête n'en est pas une
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new WsConn(socket);
}

function handleUpgrade(req, socket) {
  const conn = wsAccept(req, socket);
  if (!conn) return;
  let agentId = null;
  const hello = setTimeout(() => conn.close(4000), 10000);

  conn.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!agentId) {
      if (m.type !== 'hello') return conn.close(4000);
      const a = Object.values(agents()).find((x) => x.id === m.agentId && x.tokenHash === sha256(String(m.token || '')));
      if (!a) { conn.send({ type: 'error', code: 'revoked', message: 'Cette TV a été dissociée. Recommence l\'association.' }); return conn.close(4001); }
      clearTimeout(hello);
      agentId = a.id;
      online.get(agentId)?.conn.close(4002); // une seule connexion par agent
      online.set(agentId, { conn, adb: m.adb || 'unknown', message: m.message || '', pending: new Map(), seq: 0, version: String(m.version || '') });
      conn.send({ type: 'welcome', agentId });
      log(a, `connectée (appli ${m.version || '?'}), débogage : ${m.adb || 'inconnu'}${m.message ? ` — ${m.message}` : ''}`);
      if (m.adb === 'ok' && onAgentReady) onAgentReady(a).catch(() => {});
      offerUpdate(agentId).catch(() => {});
      return;
    }
    const o = online.get(agentId);
    if (!o || o.conn !== conn) return;
    if (m.type === 'result') {
      const cb = o.pending.get(m.id);
      if (cb) { o.pending.delete(m.id); cb({ ok: !!m.ok, out: String(m.out || '').trim(), err: String(m.err || '').trim() }); }
    } else if (m.type === 'status') {
      const was = o.adb;
      o.adb = m.adb || 'unknown';
      o.message = m.message || '';
      if (o.adb !== was) log(agents()[agentId], `débogage : ${was} → ${o.adb}${o.message ? ` — ${o.message}` : ''}`);
      if (o.adb === 'ok' && was !== 'ok') {
        if (onAgentReady) onAgentReady(agents()[agentId]).catch(() => {});
        offerUpdate(agentId).catch(() => {});
      }
    } else if (m.type === 'update-status') {
      log(agents()[agentId], `mise à jour ${String(m.version || '')} : ${String(m.message || '').slice(0, 200)}`);
    } else if (m.type === 'video-end') {
      if (m.message) log(agents()[agentId], `vidéo arrêtée : ${String(m.message).slice(0, 200)}`);
      videoEnd(Number(m.sid));
    }
  });

  conn.on('binary', (data) => {
    if (!agentId || data.length < 4) return;
    const v = videos.get(data.readUInt32BE(0));
    if (v && v.agentId === agentId) v.onData(data.subarray(4));
  });

  conn.on('close', () => {
    clearTimeout(hello);
    const o = agentId && online.get(agentId);
    if (o && o.conn === conn) {
      for (const [sid, v] of videos) if (v.agentId === agentId) videoEnd(sid);
      for (const cb of o.pending.values()) cb({ ok: false, out: '', err: 'TV déconnectée' });
      online.delete(agentId);
      log(agents()[agentId], 'déconnectée');
    }
  });
}

// Garde les connexions ouvertes à travers les proxys (NPM coupe après 60 s d'inactivité)
setInterval(() => { for (const o of online.values()) o.conn.ping(); }, 25000).unref();

// Associations pas encore abouties (TV associée mais débogage pas encore autorisé)
function pending() {
  return Object.values(agents())
    .filter((a) => !a.deviceId)
    .map((a) => ({ id: a.id, name: a.name || 'TV', userId: a.userId, createdAt: a.createdAt, ...status(a.id) }))
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
}

module.exports = {
  handleUpgrade, wsAccept, createPairCode, pair, revoke, call, install, isOnline, status, agents, saveAgents, setReadyHandler, pending,
  screenshot, banner, videoStart, videoStop, supports,
};
