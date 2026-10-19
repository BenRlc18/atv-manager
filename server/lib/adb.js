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

const shell = (target, cmd, opts) => adb(['-s', target, 'shell', cmd], opts);

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

module.exports = { adb, shell, state, connect, disconnect, pair, parseKv, sleep };
