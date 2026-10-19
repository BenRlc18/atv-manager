'use strict';
// Découverte et identification des TV : scan du réseau local (port 5555), Tailscale en option.
const net = require('net');
const os = require('os');
const http = require('http');
const fs = require('fs');
const { execFile } = require('child_process');
const A = require('./adb');
const store = require('./store');

const ADB_PORT = 5555;

// Sous-réseaux /24 à scanner : variable SCAN_SUBNETS ("192.168.1.0/24,10.0.0.0/24") ou détection automatique
function localSubnets() {
  if (process.env.SCAN_SUBNETS) {
    return process.env.SCAN_SUBNETS.split(',').map((s) => s.trim().split('/')[0].split('.').slice(0, 3).join('.'));
  }
  const skip = /^(docker|br-|veth|virbr|shim|tailscale|tun|wg|lo)/;
  const out = new Set();
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const [x, y] = a.address.split('.').map(Number);
      const isPrivate = x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31);
      if (isPrivate) out.add(a.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...out];
}

function probe(host, port = ADB_PORT, timeout = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function pool(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Lit les infos d'une TV connectée ; renvoie null si ADB ne répond pas
async function identify(target) {
  const script = [
    'echo serial=$(getprop ro.serialno)',
    'echo bserial=$(getprop ro.boot.serialno)',
    'echo brand=$(getprop ro.product.brand)',
    'echo manufacturer=$(getprop ro.product.manufacturer)',
    'echo model=$(getprop ro.product.model)',
    'echo device=$(getprop ro.product.device)',
    'echo android=$(getprop ro.build.version.release)',
    'echo sdk=$(getprop ro.build.version.sdk)',
    'echo name=$(settings get global device_name)',
    'echo aid=$(settings get secure android_id)',
    'echo leanback=$(pm list features 2>/dev/null | grep -c -E "leanback|android.software.leanback")',
  ].join('; ');
  const r = await A.shell(target, script, { timeout: 10000 });
  if (!r.ok && !r.out) return null;
  const kv = A.parseKv(r.out);
  const bad = (v) => !v || v === 'null' || v === 'unknown' || /^0+$/.test(v);
  const serial = [kv.serial, kv.bserial, kv.aid].find((v) => !bad(v));
  if (!serial) return null;
  const brand = kv.brand || kv.manufacturer || '';
  return {
    id: serial,
    brand: brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : '',
    manufacturer: kv.manufacturer || '',
    model: kv.model || '',
    device: kv.device || '',
    android: kv.android || '',
    sdk: Number(kv.sdk) || 0,
    deviceName: bad(kv.name) ? '' : kv.name,
    isTv: Number(kv.leanback) > 0,
  };
}

// Connecte une adresse et enregistre l'appareil s'il répond
async function addTarget(host, port = ADB_PORT, extra = {}, skipIds = null) {
  const target = `${host}:${port}`;
  const st = await A.connect(target);
  if (st !== 'device') return { target, host, port, state: st, ...extra };
  const info = await identify(target);
  if (!info) return { target, host, port, state: 'offline', ...extra };
  // Même TV déjà vue sur le réseau local : on garde l'adresse locale
  if (skipIds && skipIds.has(info.id)) {
    await A.disconnect(target);
    return { target, host, port, state: 'duplicate', id: info.id, ...extra };
  }
  const saved = store.upsertDevice({ ...info, host, port, ...extra, lastSeen: Date.now() });
  return { ...saved, target, state: 'device' };
}

// --- Tailscale (option) : API locale du démon via son socket, ou le CLI en secours
const TS_SOCKETS = [process.env.TAILSCALE_SOCKET, '/var/run/tailscale/tailscaled.sock', '/run/tailscale/tailscaled.sock'].filter(Boolean);

function tailscaleStatus() {
  const sock = TS_SOCKETS.find((p) => { try { return fs.statSync(p).isSocket(); } catch { return false; } });
  if (sock) {
    return new Promise((resolve) => {
      const req = http.get({ socketPath: sock, path: '/localapi/v0/status', headers: { Host: 'local-tailscaled.sock' }, timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }
  return new Promise((resolve) => {
    execFile('tailscale', ['status', '--json'], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

async function tailscalePeers() {
  const st = await tailscaleStatus();
  if (!st) return { ok: false, message: "Tailscale n'est pas détecté sur la machine qui fait tourner l'appli (installé et connecté ?)." };
  if (st.BackendState && st.BackendState !== 'Running') return { ok: false, message: `Tailscale n'est pas connecté (état : ${st.BackendState}).` };
  const peers = Object.values(st.Peer || {})
    .filter((p) => /android/i.test(p.OS || ''))
    .map((p) => ({
      host: (p.TailscaleIPs || []).find((ip) => ip.includes('.')),
      tsName: p.HostName || (p.DNSName || '').split('.')[0],
      online: !!p.Online,
      tagged: Array.isArray(p.Tags) && p.Tags.length > 0,
    }))
    .filter((p) => p.host);
  return { ok: true, peers };
}

// Scan complet : réseau local + Tailscale si activé
async function scan() {
  const subnets = localSubnets();
  const hosts = subnets.flatMap((s) => Array.from({ length: 254 }, (_, i) => `${s}.${i + 1}`));
  const open = (await pool(hosts, 96, async (h) => ((await probe(h)) ? h : null))).filter(Boolean);

  const found = await pool(open, 4, (host) => addTarget(host, ADB_PORT, { remote: false }));
  const localIds = new Set(found.filter((f) => f.state === 'device').map((f) => f.id));

  let tailscale = { enabled: false };
  if (store.settings().tailscale.enabled) {
    const ts = await tailscalePeers();
    tailscale = { enabled: true, ok: ts.ok, message: ts.message || '' };
    if (ts.ok) {
      const reachable = (await pool(ts.peers.filter((p) => p.online), 16, async (p) => ((await probe(p.host, ADB_PORT, 1500)) ? p : null))).filter(Boolean);
      const remote = await pool(reachable, 4, (p) => addTarget(p.host, ADB_PORT, { remote: true, tsName: p.tsName, tsTagged: p.tagged }, localIds));
      found.push(...remote.filter((r) => r.state !== 'duplicate'));
    }
  }
  return { subnets, found, tailscale };
}

// --- ATVM Connect : quand l'appli de la TV est connectée et autorisée, on enregistre la TV
const AG = require('./agents');
AG.setReadyHandler(async (agent) => {
  if (!agent) return;
  const target = `agent:${agent.id}`;
  const info = await identify(target);
  if (!info) return;
  const all = store.devices();
  const prev = all[info.id] || {};
  const users = new Set(prev.users || []);
  if (agent.userId) users.add(agent.userId);
  store.upsertDevice({ ...info, transport: 'agent', agentId: agent.id, host: 'ATVM Connect', port: 0, remote: true, users: [...users], lastSeen: Date.now() });
  const agents = AG.agents();
  if (agents[agent.id]) { agents[agent.id].deviceId = info.id; AG.saveAgents(agents); }
});

async function reachAgent(dev) {
  const st = AG.status(dev.agentId);
  if (!st.online) return { error: "La TV est hors ligne. Vérifie qu'elle est allumée et que l'appli ATVM Connect est ouverte au moins une fois.", code: 409, state: 'offline' };
  if (st.adb === 'unauthorized') return { error: "Sur la TV, accepte la fenêtre « Autoriser le débogage ? » (coche « Toujours autoriser »).", code: 409, state: 'unauthorized' };
  if (st.adb !== 'ok') return { error: st.message || "ATVM Connect n'arrive pas à utiliser le débogage de la TV. Vérifie que le débogage réseau est activé (onglet Connexion).", code: 409, state: 'adb' };
  const target = `agent:${dev.agentId}`;
  const info = await identify(target);
  if (!info || info.id !== dev.id) return { error: 'La TV ne répond pas correctement. Réessaie dans un instant.', code: 409, state: 'offline' };
  store.upsertDevice({ ...info, transport: 'agent', agentId: dev.agentId, host: 'ATVM Connect', lastSeen: Date.now() });
  return { dev: store.devices()[dev.id], target };
}

// Retrouve la cible d'un appareil enregistré, et le reconnecte
async function reach(id) {
  const dev = store.devices()[id];
  if (!dev) return { error: 'Appareil inconnu.', code: 404 };
  if (dev.transport === 'agent') return reachAgent(dev);
  const target = `${dev.host}:${dev.port || ADB_PORT}`;
  const st = await A.connect(target);
  if (st === 'unauthorized') return { error: 'La TV attend ton autorisation : accepte la fenêtre « Autoriser le débogage ? » sur l\'écran (coche « Toujours autoriser »).', code: 409, state: st };
  if (st !== 'device') return { error: `La TV ne répond pas à ${target}. Vérifie qu'elle est allumée, ou relance un scan si son adresse a changé.`, code: 409, state: st };
  // Vérifie qu'on parle bien au même appareil (l'IP a pu être réattribuée)
  const info = await identify(target);
  if (!info || info.id !== id) return { error: `Un autre appareil répond à ${target}. Relance un scan pour retrouver cette TV.`, code: 409, state: 'moved' };
  store.upsertDevice({ ...info, host: dev.host, port: dev.port || ADB_PORT, lastSeen: Date.now() });
  return { dev: store.devices()[id], target };
}

async function stats(target) {
  const r = await A.shell(target, 'grep -E "^(MemTotal|MemAvailable):" /proc/meminfo; echo ---; df /data 2>/dev/null | tail -1; echo ---; cat /proc/uptime', { timeout: 10000 });
  const [mem = '', disk = '', up = ''] = r.out.split('---');
  const kb = (k) => Number((mem.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1]) || 0;
  const cols = disk.trim().split(/\s+/);
  const nums = cols.filter((c) => /^\d+$/.test(c)).map(Number); // 1K-blocks, used, available
  return {
    ramTotalMb: Math.round(kb('MemTotal') / 1024),
    ramFreeMb: Math.round(kb('MemAvailable') / 1024),
    diskTotalMb: nums[0] ? Math.round(nums[0] / 1024) : 0,
    diskFreeMb: nums[2] ? Math.round(nums[2] / 1024) : 0,
    uptimeH: Math.round((Number(up.trim().split(/\s+/)[0]) || 0) / 360) / 10,
  };
}

module.exports = { scan, addTarget, reach, stats, identify, tailscalePeers, localSubnets, ADB_PORT };
