'use strict';
// Applis proposées par l'administrateur : installation depuis un lien APK, ou fiche ouverte sur le store de la TV.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./adb');
const store = require('./store');

const err = (message, code = 400) => Object.assign(new Error(message), { code });

const list = () => store.read('apps.json', []);
const save = (l) => store.write('apps.json', l);

function upsert(body) {
  const name = String(body.name || '').trim().slice(0, 60);
  const desc = String(body.desc || '').trim().slice(0, 200);
  const pkg = String(body.pkg || '').trim();
  const apkUrl = String(body.apkUrl || '').trim();
  const downloaderCode = String(body.downloaderCode || '').replace(/\D/g, '').slice(0, 10);
  if (!name) throw err("Donne un nom à l'appli.");
  if (pkg && !/^[a-zA-Z][\w]*(\.[\w]+)+$/.test(pkg)) throw err('Identifiant invalide (exemple : com.plexapp.android).');
  if (apkUrl && !/^https?:\/\/\S+$/i.test(apkUrl)) throw err('Le lien APK doit commencer par https://');
  if (!pkg && !apkUrl) throw err("Indique l'identifiant Play Store ou un lien APK.");
  const all = list();
  const id = body.id && all.some((a) => a.id === body.id) ? body.id : crypto.randomBytes(6).toString('hex');
  const app = { id, name, desc, pkg, apkUrl, downloaderCode, updatedAt: new Date().toISOString() };
  const i = all.findIndex((a) => a.id === id);
  if (i >= 0) all[i] = app; else all.push(app);
  save(all);
  return app;
}

function remove(id) {
  const all = list();
  if (!all.some((a) => a.id === id)) throw err('Appli introuvable.', 404);
  save(all.filter((a) => a.id !== id));
}

const isFireTv = (dev) => /amazon/i.test(`${(dev && dev.manufacturer) || ''} ${(dev && dev.brand) || ''}`);

// Ouvre la fiche d'une appli sur le store de la TV (Appstore Amazon sur Fire TV)
async function openStore(target, dev, pkg) {
  const uri = isFireTv(dev) ? `amzn://apps/android?p=${pkg}` : `market://details?id=${pkg}`;
  const r = await A.shell(target, `am start -a android.intent.action.VIEW -d '${uri}'`);
  if (/Error|No Activity/i.test(`${r.out} ${r.err}`)) throw err("Impossible d'ouvrir le store sur la TV.", 409);
}

// Installe une APK depuis un lien : par la TV elle-même (ATVM Connect) ou par ce serveur (ADB réseau)
async function installApk(target, url) {
  if (target.startsWith('agent:')) {
    const r = await require('./agents').install(target.slice(6), url);
    if (!r.ok) throw err(r.err || "L'installation a échoué.", 409);
    return;
  }
  const file = path.join(os.tmpdir(), `atvm-${crypto.randomBytes(6).toString('hex')}.apk`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(180000), redirect: 'follow' });
    if (!res.ok) throw err(`Téléchargement impossible (erreur ${res.status}).`, 502);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const r = await A.adb(['-s', target, 'install', '-r', file], { timeout: 300000 });
    if (!/Success/i.test(`${r.out} ${r.err}`)) throw err(`Installation refusée par la TV : ${(r.err || r.out).slice(0, 200)}`, 409);
  } finally {
    fs.rm(file, () => {});
  }
}

// État des applis proposées sur une TV (installées ou non)
async function status(target) {
  const r = await A.shell(target, 'pm list packages', { timeout: 30000 });
  const installed = new Set(r.out.split(/\r?\n/).map((l) => l.trim().replace(/^package:/, '')).filter(Boolean));
  return list().map((a) => ({ ...a, installed: a.pkg ? installed.has(a.pkg) : null }));
}

async function install(target, dev, appId) {
  const app = list().find((a) => a.id === appId);
  if (!app) throw err('Appli introuvable.', 404);
  if (app.apkUrl) {
    await installApk(target, app.apkUrl);
    return { mode: 'apk', message: `${app.name} est installée.` };
  }
  await openStore(target, dev, app.pkg);
  return { mode: 'store', message: `La fiche de ${app.name} est ouverte sur la TV : choisis « Installer » avec la télécommande.` };
}

module.exports = { list, upsert, remove, status, install, openStore, isFireTv };
