'use strict';
// Dépannage à distance : télécommande, captures d'écran, vidéo en direct (scrcpy) et bandeau
// « Accès à distance : dépannage en cours » affiché sur la TV tant qu'une session est ouverte.
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const A = require('./adb');
const AG = require('./agents');

const err = (message, code = 400) => Object.assign(new Error(message), { code });

// Touches autorisées (codes KEYCODE_* d'Android)
const KEYS = {
  up: 19, down: 20, left: 21, right: 22, ok: 23, back: 4, home: 3, menu: 82, recent: 187, settings: 176,
  volup: 24, voldown: 25, mute: 164, playpause: 85, rewind: 89, forward: 90, power: 26, wake: 224, del: 67,
};

const isAgent = (target) => target.startsWith('agent:');
const agentId = (target) => target.slice(6);
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

async function key(target, name) {
  const code = KEYS[name];
  if (!code) throw err('Touche inconnue.');
  const r = await A.shell(target, `input keyevent ${code}`, { timeout: 10000 });
  if (!r.ok) throw err(r.err || "La TV n'a pas reçu la touche.", 409);
  return { ok: true };
}

// « input text » ne gère que l'ASCII ; les espaces s'écrivent %s
async function text(target, value) {
  const t = String(value || '').slice(0, 500);
  if (!t) return { ok: true };
  if (/[^\x20-\x7e]/.test(t)) throw err('Seuls les caractères sans accent peuvent être tapés à distance.');
  const r = await A.shell(target, `input text ${quote(t.replace(/%/g, '\\%').replace(/ /g, '%s'))}`, { timeout: 15000 });
  if (!r.ok) throw err(r.err || "La TV n'a pas reçu le texte.", 409);
  return { ok: true };
}

const sizes = new Map(); // cible -> { w, h, at }
async function screenSize(target) {
  const c = sizes.get(target);
  if (c && Date.now() - c.at < 600000) return c;
  const r = await A.shell(target, 'wm size', { timeout: 8000 });
  const all = [...r.out.matchAll(/(\d+)x(\d+)/g)];
  const m = all[all.length - 1]; // « Override size » si présent, sinon « Physical size »
  if (!m) throw err("Taille de l'écran inconnue.", 409);
  const s = { w: Number(m[1]), h: Number(m[2]), at: Date.now() };
  sizes.set(target, s);
  return s;
}

// Appui à l'écran ; x et y entre 0 et 1
async function tap(target, x, y) {
  const fx = Number(x);
  const fy = Number(y);
  if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) throw err('Position invalide.');
  const { w, h } = await screenSize(target);
  const r = await A.shell(target, `input tap ${Math.round(fx * (w - 1))} ${Math.round(fy * (h - 1))}`, { timeout: 10000 });
  if (!r.ok) throw err(r.err || "La TV n'a pas reçu l'appui.", 409);
  return { ok: true };
}

// Capture d'écran : PNG en ADB direct ; JPEG réduit par ATVM Connect (0.11.0 et plus), sinon PNG en base64
async function screenshot(target) {
  if (!isAgent(target)) {
    const r = await A.adbBuffer(['-s', target, 'exec-out', 'screencap -p'], { timeout: 20000 });
    if (!r.ok || r.out.length < 100) throw err(r.err || "Capture d'écran impossible.", 409);
    return { type: 'image/png', data: r.out };
  }
  const st = AG.status(agentId(target));
  if (AG.supports(st.version, '0.11.0')) {
    const r = await AG.screenshot(agentId(target));
    if (!r.ok) throw err(r.err || "Capture d'écran impossible.", 409);
    return { type: 'image/jpeg', data: Buffer.from(r.out, 'base64') };
  }
  const r = await A.shell(target, 'screencap -p | base64', { timeout: 30000 });
  const data = Buffer.from(r.out.replace(/\s+/g, ''), 'base64');
  if (!r.ok || data.length < 100) throw err(r.err || "Capture d'écran impossible.", 409);
  return { type: 'image/png', data };
}

// ---------------------------------------------------------------------
// Bandeau sur la TV (affiché par ATVM Connect 0.11.0 et plus)
// ---------------------------------------------------------------------
const CONNECT_PKG = 'io.github.benrlc18.atvmconnect';
const BANNER_SERVICE = `${CONNECT_PKG}/.BannerService`;
const BANNER_TTL = 90000; // le bandeau disparaît seul s'il n'est plus rafraîchi
const LOCAL_APK = `http://127.0.0.1:${Number(process.env.PORT) || 8420}/connect.apk`;

async function connectVersion(target) {
  const r = await A.shell(target, `dumpsys package ${CONNECT_PKG} | grep -m1 versionName`, { timeout: 10000 });
  return (r.out.match(/versionName=(\S+)/) || [])[1] || '';
}

// TV en ADB direct : installe ou met à jour ATVM Connect si besoin, puis affiche le bandeau par le service
async function bannerDirect(target, on) {
  if (on) {
    if (!AG.supports(await connectVersion(target), '0.11.0')) {
      try { await require('./apps').installApk(target, LOCAL_APK); } catch (e) { console.log(`[Dépannage] ${target} : bandeau indisponible (${e.message})`); }
    }
    await A.shell(target, `appops set ${CONNECT_PKG} SYSTEM_ALERT_WINDOW allow`);
  }
  const r = await A.shell(target, `am start-foreground-service -n ${BANNER_SERVICE} --ez on ${on} --el ttl ${BANNER_TTL}`, { timeout: 10000 });
  // Repli : simple notification si l'appli ne peut pas afficher le bandeau
  if (on && (!r.ok || /Error/i.test(r.out + r.err))) {
    await A.shell(target, "cmd notification post -S bigtext -t 'Accès à distance' atvm-depannage 'Dépannage en cours depuis ATV Manager'");
  }
  if (!on) await A.shell(target, 'cmd notification cancel atvm-depannage 2>/dev/null; true');
}

async function banner(target, on) {
  if (isAgent(target)) {
    const st = AG.status(agentId(target));
    if (AG.supports(st.version, '0.11.0')) AG.banner(agentId(target), on, BANNER_TTL);
    return;
  }
  await bannerDirect(target, on);
}

// Sessions de dépannage : une par TV, maintenue par la page ouverte (rafraîchie toutes les 30 s)
const sessions = new Map(); // deviceId -> { target, expires, user }
async function start(dev, target, user) {
  const s = sessions.get(dev.id);
  const fresh = !s || s.expires < Date.now();
  sessions.set(dev.id, { target, user: user.name || user.username, expires: Date.now() + 75000 });
  if (fresh) console.log(`[Dépannage] ${dev.id} : session ouverte par ${user.username}`);
  await banner(target, true);
  return { ok: true, video: true };
}
function sessionTarget(id) {
  const s = sessions.get(id);
  return s && s.expires > Date.now() ? s.target : null;
}
async function stop(dev) {
  const s = sessions.get(dev.id);
  if (!s) return { ok: true };
  sessions.delete(dev.id);
  console.log(`[Dépannage] ${dev.id} : session fermée`);
  await banner(s.target, false).catch(() => {});
  return { ok: true };
}
setInterval(() => {
  for (const [id, s] of sessions) {
    if (s.expires < Date.now()) {
      sessions.delete(id);
      console.log(`[Dépannage] ${id} : session expirée`);
      banner(s.target, false).catch(() => {});
    }
  }
}, 15000).unref();

// ---------------------------------------------------------------------
// Vidéo en direct : scrcpy-server (Apache 2.0) lancé sur la TV, flux H.264 relayé au navigateur
// ---------------------------------------------------------------------
const SCRCPY_VERSION = '3.1';
const SCRCPY_JAR = path.join(__dirname, '..', 'vendor', `scrcpy-server-v${SCRCPY_VERSION}`);
const DEVICE_JAR = '/data/local/tmp/atvm-scrcpy.jar';

function serverCommand(scid) {
  const opts = [
    `scid=${scid}`, 'log_level=warn', 'audio=false', 'control=false', 'tunnel_forward=true',
    'send_device_meta=false', 'send_dummy_byte=false', 'max_size=1280', 'video_bit_rate=3000000', 'max_fps=30',
    'video_codec_options=i-frame-interval=2', 'cleanup=true', 'power_off_on_close=false',
  ];
  return `CLASSPATH=${DEVICE_JAR} app_process / com.genymobile.scrcpy.Server ${SCRCPY_VERSION} ${opts.join(' ')}`;
}

// Découpe le flux scrcpy : en-tête codec (12 octets) puis paquets (8 octets pts/drapeaux, 4 octets taille, données)
class StreamParser extends EventEmitter {
  constructor() { super(); this.buf = Buffer.alloc(0); this.meta = null; }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (!this.meta) {
        if (this.buf.length < 12) return;
        this.meta = { codec: this.buf.readUInt32BE(0), width: this.buf.readUInt32BE(4), height: this.buf.readUInt32BE(8) };
        this.buf = this.buf.subarray(12);
        this.emit('meta', this.meta);
        continue;
      }
      if (this.buf.length < 12) return;
      const hi = this.buf.readUInt32BE(0);
      const size = this.buf.readUInt32BE(8);
      if (this.buf.length < 12 + size) return;
      const data = Buffer.from(this.buf.subarray(12, 12 + size));
      this.buf = this.buf.subarray(12 + size);
      this.emit('packet', { config: (hi & 0x80000000) !== 0, key: (hi & 0x40000000) !== 0, data });
    }
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

// TV en ADB direct : envoi du serveur, redirection de port, connexion au flux
async function videoDirect(target, parser, onEnd) {
  const scid = crypto.randomInt(0, 0x7fffffff).toString(16).padStart(8, '0');
  const push = await A.adb(['-s', target, 'push', SCRCPY_JAR, DEVICE_JAR], { timeout: 30000 });
  if (!push.ok) throw err(`Envoi du module vidéo impossible : ${push.err}`, 409);
  const port = await freePort();
  const fwd = await A.adb(['-s', target, 'forward', `tcp:${port}`, `localabstract:scrcpy_${scid}`]);
  if (!fwd.ok) throw err(`Redirection impossible : ${fwd.err}`, 409);
  const proc = spawn(A.ADB, ['-s', target, 'shell', serverCommand(scid)], { stdio: 'ignore' });
  let sock = null;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    try { sock && sock.destroy(); } catch { /* déjà fermé */ }
    try { proc.kill(); } catch { /* déjà arrêté */ }
    A.adb(['-s', target, 'forward', '--remove', `tcp:${port}`]);
    onEnd();
  };
  proc.on('exit', end);
  // Le serveur met un instant à écouter : sans données reçues, on réessaie
  for (let i = 0; i < 40 && !ended; i++) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      let got = false;
      s.on('data', (d) => {
        if (!got) { got = true; sock = s; resolve(true); }
        parser.push(d);
      });
      s.on('close', () => { if (!got) resolve(false); else end(); });
      s.on('error', () => {});
    });
    if (ok) return end;
    await A.sleep(250);
  }
  end();
  throw err('Le module vidéo ne répond pas sur cette TV.', 409);
}

// TV via ATVM Connect : l'appli lance le serveur et relaie le flux par son tunnel
async function videoAgent(target, parser, onEnd) {
  const id = agentId(target);
  if (!AG.supports(AG.status(id).version, '0.11.0')) throw err('La vidéo en direct demande ATVM Connect 0.11.0 ou plus (mise à jour automatique en cours).', 409);
  const scid = crypto.randomInt(0, 0x7fffffff).toString(16).padStart(8, '0');
  const sid = AG.videoStart(id, { scid, jar: `/scrcpy-server-v${SCRCPY_VERSION}.jar`, path: DEVICE_JAR, cmd: serverCommand(scid) },
    (chunk) => parser.push(chunk), onEnd);
  return () => AG.videoStop(id, sid);
}

// Relaie le flux vers le navigateur : un message JSON « meta », puis des messages binaires (1 octet de drapeaux + données)
async function video(target, ws) {
  const parser = new StreamParser();
  let stopFn = null;
  let closed = false;
  const onEnd = () => { if (!closed) { closed = true; ws.close(1000); } };
  parser.on('meta', (m) => ws.send({ type: 'meta', codec: m.codec === 0x68323634 ? 'h264' : 'autre', width: m.width, height: m.height }));
  parser.on('packet', (p) => ws.frame(0x2, Buffer.concat([Buffer.from([(p.config ? 1 : 0) | (p.key ? 2 : 0)]), p.data])));
  ws.on('close', () => { closed = true; if (stopFn) stopFn(); });
  try {
    stopFn = isAgent(target) ? await videoAgent(target, parser, onEnd) : await videoDirect(target, parser, onEnd);
    if (closed) stopFn();
  } catch (e) {
    ws.send({ type: 'error', message: e.message });
    ws.close(1011);
  }
}

module.exports = { KEYS, key, text, tap, screenshot, start, stop, sessionTarget, video, SCRCPY_JAR, SCRCPY_VERSION };
