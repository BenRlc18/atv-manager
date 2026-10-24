'use strict';
// ATV Manager : serveur HTTP (API JSON + interface web). Aucune dépendance externe.
const http = require('http');
const fs = require('fs');
const path = require('path');
const A = require('./lib/adb');
const store = require('./lib/store');
const D = require('./lib/devices');
const O = require('./lib/optimizer');
const auth = require('./lib/auth');
const AG = require('./lib/agents');
const TS = require('./lib/tailscale');
const APPS = require('./lib/apps');
const R = require('./lib/remote');

// Réglages renvoyés à l'interface : la clé API Tailscale n'en sort jamais
const publicSettings = (s) => ({
  tailscale: { enabled: !!(s.tailscale && s.tailscale.enabled), hasApiKey: !!(s.tailscale && s.tailscale.apiKey), tag: (s.tailscale && s.tailscale.tag) || 'tag:tvbox' },
  ai: { enabled: false },
});

// Lien de téléchargement de l'appli ATVM Connect (redirection depuis /connect.apk, facile à taper dans Downloader)
const AGENT_APK_URL = process.env.AGENT_APK_URL || 'https://github.com/BenRlc18/atv-manager/releases/latest/download/atvm-connect.apk';

const PORT = Number(process.env.PORT) || 8420;
const PUBLIC = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const fail = (message, code = 400) => Object.assign(new Error(message), { code });

function send(res, code, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(fail('Requête trop volumineuse.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(fail('JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'Requête invalide'); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Interdit');
  fs.readFile(file, (err, data) => {
    if (err) {
      // Application monopage : toute route inconnue renvoie l'interface
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => (e2 ? send(res, 404, 'Introuvable') : send(res, 200, html, { 'Content-Type': MIME['.html'] })));
    }
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

const clientIp = (req) => String(req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();

const publicDevice = (d, withUsers) => ({
  id: d.id, label: d.label || '', brand: d.brand, model: d.model, deviceName: d.deviceName, android: d.android,
  host: d.host, port: d.port, remote: !!d.remote, tsName: d.tsName || '', tsTagged: !!d.tsTagged, lastSeen: d.lastSeen, isTv: d.isTv,
  transport: d.transport || 'adb',
  audit: d.audit || null,
  ...(d.transport === 'agent' ? { agent: AG.status(d.agentId) } : {}),
  ...(withUsers ? { users: d.users || [] } : {}),
});

const isAdmin = (u) => u && u.role === 'admin';
const canSee = (u, d) => isAdmin(u) || (Array.isArray(d.users) && d.users.includes(u.id));
const visibleDevices = (u) => Object.values(store.devices()).filter((d) => canSee(u, d));

// --- Routes : { method, motif, accès ('public' | 'user' | 'admin'), handler }
const routes = [];
const route = (method, pattern, access, handler) => routes.push({ method, access, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

// Vérifie que l'utilisateur a accès à la TV, puis la (re)connecte
async function needDevice(user, rawId) {
  const id = decodeURIComponent(rawId);
  const dev = store.devices()[id];
  if (!dev || !canSee(user, dev)) throw fail('Appareil inconnu.', 404);
  const r = await D.reach(id);
  if (r.error) throw Object.assign(fail(r.error, r.code), { state: r.state });
  return r;
}

// ---------- Authentification
route('GET', '/api/auth/status', 'public', async (ctx) => ({ setup: auth.needsSetup(), user: auth.publicUser(ctx.user), version: VERSION }));

route('POST', '/api/auth/setup', 'public', async (ctx) => {
  const user = auth.setup(ctx.body);
  ctx.cookie = auth.sessionCookie(ctx.req, auth.openSession(user));
  return { user: auth.publicUser(user) };
});

route('POST', '/api/auth/login', 'public', async (ctx) => {
  const user = auth.login(ctx.body, clientIp(ctx.req));
  // Double authentification activée : on demande le code avant d'ouvrir la session
  if (user.totp) return { twoFactor: true, ticket: auth.issueTicket(user) };
  ctx.cookie = auth.sessionCookie(ctx.req, auth.openSession(user));
  return { user: auth.publicUser(user) };
});

route('POST', '/api/auth/2fa', 'public', async (ctx) => {
  const user = auth.twoFactorLogin(ctx.body.ticket, ctx.body.code, clientIp(ctx.req));
  ctx.cookie = auth.sessionCookie(ctx.req, auth.openSession(user));
  return { user: auth.publicUser(user) };
});

route('POST', '/api/account/2fa/setup', 'user', async (ctx) => {
  if (ctx.user.totp) throw fail('La double authentification est déjà active.', 409);
  return auth.twoFactorBegin(ctx.user);
});
route('POST', '/api/account/2fa/enable', 'user', async (ctx) => auth.twoFactorEnable(ctx.user, ctx.body.code));
route('POST', '/api/account/2fa/disable', 'user', async (ctx) => { auth.twoFactorDisable(ctx.user, ctx.body.password); return { ok: true }; });

route('POST', '/api/auth/register', 'public', async (ctx) => {
  const user = auth.register(ctx.body);
  ctx.cookie = auth.sessionCookie(ctx.req, auth.openSession(user));
  return { user: auth.publicUser(user) };
});

route('POST', '/api/auth/logout', 'public', async (ctx) => {
  auth.closeSession(auth.cookieToken(ctx.req));
  ctx.cookie = auth.sessionCookie(ctx.req, '', true);
  return { ok: true };
});

route('POST', '/api/account/password', 'user', async (ctx) => {
  auth.changePassword(ctx.user, ctx.body.current, ctx.body.next);
  return { ok: true };
});

// ---------- État général
route('GET', '/api/state', 'user', async (ctx) => {
  const admin = isAdmin(ctx.user);
  return {
    version: VERSION,
    user: auth.publicUser(ctx.user),
    settings: admin ? publicSettings(store.settings()) : null,
    features: { tailscale: !!(store.settings().tailscale || {}).enabled, downloaderCode: String(process.env.DOWNLOADER_CODE || store.settings().downloaderCode || '').replace(/\D/g, '') },
    levels: O.LEVELS,
    devices: visibleDevices(ctx.user).map((d) => ({ ...publicDevice(d, admin), ...(admin ? { userNames: (d.users || []).map(userName).filter(Boolean) } : {}) }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)),
    // TV associées avec ATVM Connect mais pas encore autorisées : toutes pour l'administrateur, les siennes pour un invité
    pendingAgents: AG.pending().filter((a) => admin || a.userId === ctx.user.id).map((a) => ({ ...a, userName: userName(a.userId) })),
    subnets: admin ? D.localSubnets() : [],
  };
});

const userName = (id) => (auth.listUsers().find((u) => u.id === id) || {}).name || '';

// Retirer une association en attente : l'administrateur, ou l'invité qui l'a faite
route('POST', '/api/agent/:id/revoke', 'user', async (ctx, p) => {
  const id = decodeURIComponent(p.id);
  const a = AG.agents()[id];
  if (!a || (!isAdmin(ctx.user) && a.userId !== ctx.user.id)) throw fail('Association introuvable.', 404);
  AG.revoke(id);
  return { ok: true };
});

// ---------- Appareils (recherche et ajout : administrateur)
route('POST', '/api/scan', 'admin', async () => {
  const r = await D.scan();
  return { ...r, found: r.found.map((f) => (f.state === 'device' ? { ...publicDevice(f, true), state: f.state } : { host: f.host, port: f.port, state: f.state, remote: !!f.remote, tsName: f.tsName || '' })) };
});

route('POST', '/api/connect', 'admin', async (ctx) => {
  const { body } = ctx;
  const host = String(body.host || '').trim();
  const port = Number(body.port) || D.ADB_PORT;
  if (!/^[\w.-]+$/.test(host) || port < 1 || port > 65535) throw fail('Adresse invalide.');
  if (body.pairPort && body.pairCode) {
    const p = await A.pair(`${host}:${Number(body.pairPort)}`, String(body.pairCode).replace(/\D/g, ''));
    if (!/Successfully paired/i.test(`${p.out} ${p.err}`)) throw fail(`Appairage refusé : ${p.err || p.out || 'code ou port incorrect'}`, 409);
  }
  const r = await D.addTarget(host, port, { remote: /^100\./.test(host) });
  if (r.state !== 'device') return { state: r.state, host, port };
  return { state: 'device', device: publicDevice(r, true) };
});

route('GET', '/api/devices/:id', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  return { device: publicDevice(dev, isAdmin(ctx.user)), stats: await D.stats(target) };
});

route('POST', '/api/devices/:id/rename', 'admin', async (ctx, p) => {
  const all = store.devices();
  const dev = all[decodeURIComponent(p.id)];
  if (!dev) throw fail('Appareil inconnu.', 404);
  dev.label = String(ctx.body.label || '').trim().slice(0, 60);
  store.saveDevices(all);
  return { device: publicDevice(dev, true) };
});

route('POST', '/api/devices/:id/share', 'admin', async (ctx, p) => {
  const all = store.devices();
  const dev = all[decodeURIComponent(p.id)];
  if (!dev) throw fail('Appareil inconnu.', 404);
  const known = new Set(auth.listUsers().map((u) => u.id));
  dev.users = [...new Set((Array.isArray(ctx.body.users) ? ctx.body.users : []).map(String))].filter((id) => known.has(id));
  store.saveDevices(all);
  return { device: publicDevice(dev, true) };
});

// Retirer une TV : l'administrateur, ou le proche pour une TV associée avec ATVM Connect
route('POST', '/api/devices/:id/forget', 'user', async (ctx, p) => {
  const all = store.devices();
  const dev = all[decodeURIComponent(p.id)];
  if (!dev || !canSee(ctx.user, dev)) throw fail('Appareil inconnu.', 404);
  if (!isAdmin(ctx.user) && dev.transport !== 'agent') throw fail("Réservé à l'administrateur.", 403);
  if (dev.transport === 'agent') AG.revoke(dev.agentId);
  else await A.disconnect(`${dev.host}:${dev.port || D.ADB_PORT}`);
  delete all[dev.id];
  store.saveDevices(all);
  return { ok: true };
});

// ---------- Applis proposées par l'administrateur
route('GET', '/api/apps', 'user', async () => ({ apps: APPS.list() }));
route('POST', '/api/admin/apps', 'admin', async (ctx) => ({ app: APPS.upsert(ctx.body) }));
route('POST', '/api/admin/apps/:id/delete', 'admin', async (ctx, p) => { APPS.remove(decodeURIComponent(p.id)); return { ok: true }; });
route('GET', '/api/devices/:id/apps', 'user', async (ctx, p) => {
  const { target } = await needDevice(ctx.user, p.id);
  return { apps: await APPS.status(target) };
});
route('POST', '/api/devices/:id/apps/:appId/install', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  return APPS.install(target, dev, decodeURIComponent(p.appId));
});

// ---------- ATVM Connect (appli sur la TV)
route('POST', '/api/agent/pair-code', 'user', async (ctx) => AG.createPairCode(ctx.user));
route('POST', '/api/agent/pair', 'public', async (ctx) => AG.pair(ctx.body.code, ctx.body.name, clientIp(ctx.req)));

// ---------- Optimisation (toute personne ayant accès à la TV)
route('GET', '/api/devices/:id/plan', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  return O.plan(target, dev, ctx.query.get('level'), ctx.query.get('mode') === 'manual' ? 'manual' : 'recommended');
});

// Contrôle de l'optimisation : le résumé est mémorisé sur l'appareil pour la liste des TV
async function runAudit(dev, target) {
  const a = await O.audit(target, dev);
  const all = store.devices();
  if (all[dev.id]) {
    all[dev.id].audit = { level: a.level, partial: a.partial, at: a.at, next: a.next ? a.next.level : null };
    store.saveDevices(all);
  }
  return a;
}

route('GET', '/api/devices/:id/audit', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  return runAudit(dev, target);
});

route('POST', '/api/devices/:id/apply', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  const r = await O.apply(target, dev, ctx.body);
  try { r.audit = await runAudit(dev, target); } catch { /* le contrôle est un bonus, l'optimisation reste valide */ }
  return r;
});

route('GET', '/api/devices/:id/history', 'user', async (ctx, p) => {
  const id = decodeURIComponent(p.id);
  const dev = store.devices()[id];
  if (!dev || !canSee(ctx.user, dev)) throw fail('Appareil inconnu.', 404);
  return { history: store.history(id) };
});

route('POST', '/api/devices/:id/restore', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  const r = await O.restore(target, dev, { snapshot: ctx.body.snapshot || 'all', pkg: ctx.body.pkg || null });
  try { await runAudit(dev, target); } catch { /* idem */ }
  return r;
});

// Remettre le lanceur d'origine à tout moment (sans passer par l'historique) ; corps vide
route('POST', '/api/devices/:id/reset-launcher', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  const r = await O.resetLauncher(target, dev);
  try { await runAudit(dev, target); } catch { /* idem */ }
  return r;
});

route('POST', '/api/devices/:id/open-store', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  return O.openStore(target, String(ctx.body.pkg || ''), dev);
});

// ---------- Dépannage à distance (toute personne ayant accès à la TV)
// Pendant une session, la cible est gardée en mémoire : chaque touche part sans reconnexion
async function remoteTarget(user, rawId) {
  const id = decodeURIComponent(rawId);
  const dev = store.devices()[id];
  if (!dev || !canSee(user, dev)) throw fail('Appareil inconnu.', 404);
  const t = R.sessionTarget(id);
  return t ? { dev, target: t } : needDevice(user, rawId);
}

route('POST', '/api/devices/:id/remote/start', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  return R.start(dev, target, ctx.user);
});
route('POST', '/api/devices/:id/remote/stop', 'user', async (ctx, p) => {
  const dev = store.devices()[decodeURIComponent(p.id)];
  if (!dev || !canSee(ctx.user, dev)) throw fail('Appareil inconnu.', 404);
  return R.stop(dev);
});
route('POST', '/api/devices/:id/remote/key', 'user', async (ctx, p) => R.key((await remoteTarget(ctx.user, p.id)).target, String(ctx.body.key || '')));
route('POST', '/api/devices/:id/remote/text', 'user', async (ctx, p) => R.text((await remoteTarget(ctx.user, p.id)).target, ctx.body.text));
route('POST', '/api/devices/:id/remote/tap', 'user', async (ctx, p) => R.tap((await remoteTarget(ctx.user, p.id)).target, ctx.body.x, ctx.body.y));
route('GET', '/api/devices/:id/remote/screen', 'user', async (ctx, p) => {
  const shot = await R.screenshot((await remoteTarget(ctx.user, p.id)).target);
  return { raw: shot.data, contentType: shot.type };
});

// ---------- Réglages et comptes (administrateur)
route('POST', '/api/devices/:id/ts-isolate', 'admin', async (ctx, p) => {
  const all = store.devices();
  const dev = all[decodeURIComponent(p.id)];
  if (!dev || !dev.remote || dev.transport === 'agent') throw fail("Cette TV n'est pas reliée par Tailscale.");
  const r = await TS.isolate(dev.host);
  dev.tsTagged = true;
  store.saveDevices(all);
  return r;
});

route('POST', '/api/settings', 'admin', async (ctx) => {
  const s = store.settings();
  const { body } = ctx;
  const prevTs = s.tailscale || {};
  if (body.tailscale && typeof body.tailscale.enabled === 'boolean') s.tailscale = { ...prevTs, enabled: body.tailscale.enabled };
  if (body.tailscale && typeof body.tailscale.apiKey === 'string') {
    const key = body.tailscale.apiKey.trim();
    if (key) {
      if (!/^tskey-api-[\w-]+$/.test(key)) throw fail('Une clé API Tailscale commence par « tskey-api- ».');
      await TS.test(key);
    }
    s.tailscale = { ...s.tailscale, apiKey: key };
  }
  if (body.tailscale && typeof body.tailscale.tag === 'string') {
    const tag = body.tailscale.tag.trim();
    if (!/^tag:[a-z0-9-]+$/i.test(tag)) throw fail('Une étiquette Tailscale ressemble à « tag:tvbox ».');
    s.tailscale = { ...s.tailscale, tag };
  }
  s.ai = { enabled: false }; // l'agent IA n'est pas encore disponible
  store.saveSettings(s);
  let tailscale = null;
  if (s.tailscale.enabled) {
    const t = await D.tailscalePeers();
    tailscale = { ok: t.ok, message: t.message || '', peers: t.ok ? t.peers.length : 0, untagged: t.ok ? t.peers.filter((x) => !x.tagged).length : 0 };
  }
  return { settings: publicSettings(s), tailscale };
});

route('GET', '/api/admin/users', 'admin', async () => ({ users: auth.listUsers(), invites: auth.listInvites() }));
route('POST', '/api/admin/invites', 'admin', async (ctx) => ({ invite: auth.createInvite(ctx.user, ctx.body.note) }));
route('POST', '/api/admin/invites/:code/revoke', 'admin', async (ctx, p) => { auth.revokeInvite(decodeURIComponent(p.code)); return { ok: true }; });
route('POST', '/api/admin/users/:id/delete', 'admin', async (ctx, p) => {
  const id = decodeURIComponent(p.id);
  auth.deleteUser(id, ctx.user);
  // Les TV associées par ce proche avec ATVM Connect sont dissociées
  const devs = store.devices();
  for (const a of Object.values(AG.agents()).filter((x) => x.userId === id)) {
    AG.revoke(a.id);
    if (a.deviceId && devs[a.deviceId] && devs[a.deviceId].agentId === a.id) delete devs[a.deviceId];
  }
  store.saveDevices(devs);
  return { ok: true };
});
route('POST', '/api/admin/users/:id/reset-2fa', 'admin', async (ctx, p) => { auth.twoFactorReset(decodeURIComponent(p.id)); return { ok: true }; });

// ---------- Serveur
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');

  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, 'Requête invalide'); }
  if (url.pathname === '/connect.apk') {
    // Une APK personnalisée (avec ce serveur intégré) posée dans le dossier de données est servie en priorité
    const local = path.join(store.DATA_DIR, 'connect.apk');
    return fs.stat(local, (err, st) => {
      if (err || !st.isFile()) return send(res, 302, 'Redirection', { Location: AGENT_APK_URL });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': st.size,
        'Content-Disposition': 'attachment; filename="atvm-connect.apk"',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(local).pipe(res);
    });
  }
  // Module vidéo (scrcpy-server, Apache 2.0), téléchargé par ATVM Connect pour le dépannage à distance
  if (url.pathname === `/scrcpy-server-v${R.SCRCPY_VERSION}.jar`) {
    return fs.readFile(R.SCRCPY_JAR, (err, data) => (err ? send(res, 404, 'Introuvable') : send(res, 200, data, { 'Content-Type': 'application/java-archive' })));
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);

  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) return send(res, 404, { error: 'Route inconnue.' });

  // Protection CSRF : les requêtes qui modifient doivent être en JSON (impossible depuis un formulaire d'un autre site)
  if (req.method === 'POST' && !/^application\/json/i.test(req.headers['content-type'] || '')) {
    return send(res, 415, { error: 'Requête refusée.' });
  }

  const ctx = { req, user: auth.currentUser(req), query: url.searchParams, body: {}, cookie: null };
  if (r.access !== 'public' && !ctx.user) return send(res, 401, { error: 'Connecte-toi pour continuer.' });
  if (r.access === 'admin' && !isAdmin(ctx.user)) return send(res, 403, { error: "Réservé à l'administrateur." });

  try {
    if (req.method === 'POST') ctx.body = await readBody(req);
    const params = r.re.exec(url.pathname).groups || {};
    const out = await r.handler(ctx, params);
    if (out && Buffer.isBuffer(out.raw)) return send(res, 200, out.raw, { 'Content-Type': out.contentType });
    send(res, 200, out, ctx.cookie ? { 'Set-Cookie': ctx.cookie } : {});
  } catch (e) {
    const code = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 500;
    if (code === 500) console.error(e);
    send(res, code, { error: code === 500 ? 'Erreur interne.' : e.message, state: e.state, refused: e.refused });
  }
});

// Tunnel WebSocket des TV équipées d'ATVM Connect
server.on('upgrade', (req, socket) => {
  const p = req.url.split('?')[0];
  if (p === '/api/agent/ws') return AG.handleUpgrade(req, socket);
  const m = /^\/api\/devices\/([^/]+)\/remote\/video$/.exec(p);
  if (m) return remoteVideo(req, socket, m[1]).catch(() => socket.destroy());
  socket.destroy();
});

// Vidéo du dépannage : session ouverte, même site uniquement (pas de connexion depuis une autre page web)
async function remoteVideo(req, socket, rawId) {
  const user = auth.currentUser(req);
  const origin = req.headers.origin;
  let sameSite = true;
  try { sameSite = !origin || new URL(origin).host === req.headers.host; } catch { sameSite = false; }
  if (!user || !sameSite) { socket.destroy(); return; }
  const { target } = await remoteTarget(user, rawId);
  const ws = AG.wsAccept(req, socket);
  if (ws) R.video(target, ws);
}

server.requestTimeout = 0; // le scan et l'optimisation peuvent durer plus d'une minute
server.listen(PORT, () => {
  console.log(`ATV Manager ${VERSION} sur http://0.0.0.0:${PORT}${auth.needsSetup() ? ' (premier lancement : crée le compte administrateur)' : ''}`);
  A.adb(['start-server']).then((r) => { if (!r.ok) console.error('adb :', r.err); });
});
