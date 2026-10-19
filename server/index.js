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
    settings: admin ? store.settings() : null,
    levels: O.LEVELS,
    devices: visibleDevices(ctx.user).map((d) => publicDevice(d, admin)).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)),
    subnets: admin ? D.localSubnets() : [],
  };
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

route('POST', '/api/devices/:id/forget', 'admin', async (ctx, p) => {
  const all = store.devices();
  const dev = all[decodeURIComponent(p.id)];
  if (!dev) throw fail('Appareil inconnu.', 404);
  await A.disconnect(`${dev.host}:${dev.port || D.ADB_PORT}`);
  delete all[dev.id];
  store.saveDevices(all);
  return { ok: true };
});

// ---------- Optimisation (toute personne ayant accès à la TV)
route('GET', '/api/devices/:id/plan', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  return O.plan(target, dev, ctx.query.get('level'), ctx.query.get('mode') === 'manual' ? 'manual' : 'recommended');
});

route('POST', '/api/devices/:id/apply', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  return O.apply(target, dev, ctx.body);
});

route('GET', '/api/devices/:id/history', 'user', async (ctx, p) => {
  const id = decodeURIComponent(p.id);
  const dev = store.devices()[id];
  if (!dev || !canSee(ctx.user, dev)) throw fail('Appareil inconnu.', 404);
  return { history: store.history(id) };
});

route('POST', '/api/devices/:id/restore', 'user', async (ctx, p) => {
  const { dev, target } = await needDevice(ctx.user, p.id);
  return O.restore(target, dev, { snapshot: ctx.body.snapshot || 'all', pkg: ctx.body.pkg || null });
});

route('POST', '/api/devices/:id/open-store', 'user', async (ctx, p) => {
  const { target } = await needDevice(ctx.user, p.id);
  return O.openStore(target, String(ctx.body.pkg || ''));
});

// ---------- Réglages et comptes (administrateur)
route('POST', '/api/settings', 'admin', async (ctx) => {
  const s = store.settings();
  const { body } = ctx;
  if (body.tailscale && typeof body.tailscale.enabled === 'boolean') s.tailscale = { enabled: body.tailscale.enabled };
  s.ai = { enabled: false }; // l'agent IA n'est pas encore disponible
  store.saveSettings(s);
  let tailscale = null;
  if (s.tailscale.enabled) {
    const t = await D.tailscalePeers();
    tailscale = { ok: t.ok, message: t.message || '', peers: t.ok ? t.peers.length : 0, untagged: t.ok ? t.peers.filter((x) => !x.tagged).length : 0 };
  }
  return { settings: s, tailscale };
});

route('GET', '/api/admin/users', 'admin', async () => ({ users: auth.listUsers(), invites: auth.listInvites() }));
route('POST', '/api/admin/invites', 'admin', async (ctx) => ({ invite: auth.createInvite(ctx.user, ctx.body.note) }));
route('POST', '/api/admin/invites/:code/revoke', 'admin', async (ctx, p) => { auth.revokeInvite(decodeURIComponent(p.code)); return { ok: true }; });
route('POST', '/api/admin/users/:id/delete', 'admin', async (ctx, p) => { auth.deleteUser(decodeURIComponent(p.id), ctx.user); return { ok: true }; });
route('POST', '/api/admin/users/:id/reset-2fa', 'admin', async (ctx, p) => { auth.twoFactorReset(decodeURIComponent(p.id)); return { ok: true }; });

// ---------- Serveur
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');

  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, 'Requête invalide'); }
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
    send(res, 200, out, ctx.cookie ? { 'Set-Cookie': ctx.cookie } : {});
  } catch (e) {
    const code = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 500;
    if (code === 500) console.error(e);
    send(res, code, { error: code === 500 ? 'Erreur interne.' : e.message, state: e.state, refused: e.refused });
  }
});

server.requestTimeout = 0; // le scan et l'optimisation peuvent durer plus d'une minute
server.listen(PORT, () => {
  console.log(`ATV Manager ${VERSION} sur http://0.0.0.0:${PORT}${auth.needsSetup() ? ' (premier lancement : crée le compte administrateur)' : ''}`);
  A.adb(['start-server']).then((r) => { if (!r.ok) console.error('adb :', r.err); });
});
