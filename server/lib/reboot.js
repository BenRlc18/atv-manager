'use strict';
// Redémarrage complet programmé (une fois par semaine, la nuit) et redémarrage à la demande.
// Beaucoup de TV (TCL notamment, avec le « démarrage rapide ») ne redémarrent jamais vraiment : mémoire et swap
// se remplissent au fil des jours. Un vrai redémarrage remet tout à zéro. Jamais pendant que la TV est utilisée.
const A = require('./adb');
const store = require('./store');

const TZ = process.env.TZ || 'Europe/Paris';
const WINDOW_H = 3; // si la TV est allumée à l'heure prévue, on réessaie pendant 3 heures
const CHECK_MS = 10 * 60000;

// Jour (0 = dimanche) et heure locale
function localNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: days[parts.find((p) => p.type === 'weekday').value], hour: Number(parts.find((p) => p.type === 'hour').value) };
}

function config(dev) {
  const c = dev.autoReboot || {};
  return { enabled: !!c.enabled, day: Number.isInteger(c.day) ? c.day : 1, hour: Number.isInteger(c.hour) ? c.hour : 4, last: dev.lastAutoReboot || null };
}

function save(id, value) {
  const day = Number(value.day);
  const hour = Number(value.hour);
  if (!(Number.isInteger(day) && day >= 0 && day <= 6 && Number.isInteger(hour) && hour >= 0 && hour <= 23)) {
    throw Object.assign(new Error('Jour ou heure invalide.'), { code: 400 });
  }
  const all = store.devices();
  if (!all[id]) throw Object.assign(new Error('Appareil inconnu.'), { code: 404 });
  all[id].autoReboot = { enabled: !!value.enabled, day, hour };
  store.saveDevices(all);
  return config(all[id]);
}

// L'écran est-il allumé ? (« Awake » = quelqu'un regarde peut-être la TV)
async function inUse(target) {
  const r = await A.shell(target, 'dumpsys power | grep -m1 mWakefulness=', { timeout: 10000 });
  return /Awake/i.test(r.out);
}

async function rebootNow(target) {
  // La TV coupe la connexion en redémarrant : une réponse vide ou une erreur de lien est normale
  await A.shell(target, 'reboot', { timeout: 8000 });
  return { ok: true, message: 'La TV redémarre. Elle sera de nouveau disponible dans une à deux minutes.' };
}

// Planificateur : reach() est fourni par devices.js (évite une dépendance circulaire)
function start(reach) {
  const tick = async () => {
    const now = localNow();
    for (const dev of Object.values(store.devices())) {
      const c = config(dev);
      if (!c.enabled || now.day !== c.day) continue;
      const late = now.hour - c.hour;
      if (late < 0 || late >= WINDOW_H) continue;
      if (c.last && Date.now() - Date.parse(c.last) < 20 * 3600000) continue;
      try {
        const r = await reach(dev.id);
        if (r.error) continue;
        if (await inUse(r.target)) { console.log(`[Redémarrage] ${dev.id} : TV allumée, nouvel essai plus tard`); continue; }
        await rebootNow(r.target);
        const all = store.devices();
        if (all[dev.id]) { all[dev.id].lastAutoReboot = new Date().toISOString(); store.saveDevices(all); }
        console.log(`[Redémarrage] ${dev.id} : redémarrage hebdomadaire lancé`);
      } catch (e) {
        console.log(`[Redémarrage] ${dev.id} : ${e.message}`);
      }
    }
  };
  setInterval(() => { tick().catch(() => {}); }, CHECK_MS).unref();
}

module.exports = { config, save, rebootNow, start };
