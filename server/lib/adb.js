'use strict';
// Petit wrapper autour du binaire adb : chaque appel renvoie {ok, out, err} et ne lève jamais d'exception.
const { execFile } = require('child_process');

const ADB = process.env.ADB_PATH || 'adb';

function adb(args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(ADB, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const out = (stdout || '').trim();
      let err = (stderr || '').trim();
      if (error && error.killed) err = err || 'délai dépassé';
      if (error && error.code === 'ENOENT') err = `adb introuvable (${ADB})`;
      resolve({ ok: !error, out, err });
    });
  });
}

// Même chose, mais la sortie reste binaire (captures d'écran)
function adbBuffer(args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(ADB, args, { timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (error, stdout, stderr) => {
      let err = (stderr || '').toString().trim();
      if (error && error.killed) err = err || 'délai dépassé';
      resolve({ ok: !error, out: stdout || Buffer.alloc(0), err });
    });
  });
}

// Une cible "agent:<id>" passe par l'appli ATVM Connect installée sur la TV
function shell(target, cmd, opts = {}) {
  if (target.startsWith('agent:')) return require('./agents').call(target.slice(6), cmd, opts.timeout || 15000);
  return adb(['-s', target, 'shell', cmd], opts);
}

// État ADB d'une cible : device | unauthorized | offline | absent
async function state(target) {
  const r = await adb(['-s', target, 'get-state'], { timeout: 5000 });
  const text = `${r.out} ${r.err}`;
  if (/\bdevice\b/.test(r.out)) return 'device';
  if (/unauthorized/.test(text)) return 'unauthorized';
  if (/offline/.test(text)) return 'offline';
  return 'absent';
}

// Connexion réseau : renvoie l'état final après connexion
async function connect(target) {
  const r = await adb(['connect', target], { timeout: 8000 });
  const text = `${r.out} ${r.err}`;
  if (/failed to authenticate|unauthorized/i.test(text)) return 'unauthorized';
  if (!/connected to|already connected/i.test(text)) return 'absent';
  // Laisse le temps à la TV d'afficher (ou non) la demande d'autorisation
  for (let i = 0; i < 6; i++) {
    const s = await state(target);
    if (s === 'device' || s === 'unauthorized') return s;
    await sleep(500);
  }
  return state(target);
}

const disconnect = (target) => adb(['disconnect', target], { timeout: 5000 });

// Appairage "Débogage sans fil" (Android 11+) : adb pair ip:port code
const pair = (hostPort, code) => adb(['pair', hostPort, String(code)], { timeout: 15000 });

// Lit des lignes "clé=valeur" produites par un script shell
function parseKv(text) {
  const o = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { ADB, adb, adbBuffer, shell, state, connect, disconnect, pair, parseKv, sleep };
