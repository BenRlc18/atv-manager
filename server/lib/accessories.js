'use strict';
// Accessoires d'une TV : Bluetooth, entrées (télécommandes, manettes…), USB, HDMI-CEC, sortie audio, réseau.
// Tout est lu en une seule commande shell (un seul aller-retour via ATVM Connect), en lecture seule.
// Chaque source est facultative : si elle manque sur la TV, la partie correspondante est simplement absente.
const A = require('./adb');

const MAC = /([0-9A-FX]{2}:){5}[0-9A-F]{2}/i;
const macKey = (m) => String(m || '').toLowerCase().slice(-5); // les 2 derniers octets : certaines versions masquent le début

// Sorties filtrées sur la TV pour limiter le volume renvoyé
const SCRIPT = [
  'echo @@bt',
  "dumpsys bluetooth_manager 2>/dev/null | sed '/BTSNOOP_LOG_SUMMARY/,$d' | grep -E '^  (enabled|state):|Bonded devices|([0-9A-FX]{2}:){5}[0-9A-F]{2}|^Profile: |[Bb]attery'",
  'echo @@input',
  "dumpsys input 2>/dev/null | sed -n '/Event Hub State/,/Input Reader State/p' | grep -E '^ +-?[0-9]+: |Classes:|Identifier:|UniqueId:|Descriptor:'",
  'echo @@power',
  'for p in /sys/class/power_supply/*; do [ -r "$p/capacity" ] && echo "${p##*/}|$(cat "$p/scope" 2>/dev/null)|$(cat "$p/capacity" 2>/dev/null)"; done',
  'echo @@mount',
  'dumpsys mount 2>/dev/null | grep -E "DiskInfo|VolumeInfo|type=|fsType=|path=|flags=|label="',
  'echo @@df',
  'df -k 2>/dev/null | grep -E " /(storage|mnt/media_rw)/"',
  'echo @@usb',
  "dumpsys usb 2>/dev/null | sed '/num_connects/,$d' | grep -E 'name=|class=|manufacturer_name=|product_name=|UsbDevice\\['",
  'echo @@hdmi',
  'dumpsys hdmi_control 2>/dev/null | grep -E "mIsCecAvailable|mArcEstablished|mSystemAudioActivated|mDeviceInfo: |^ +CEC: logical_address|port_id: [0-9]+, type" | head -60',
  'echo @@audio',
  'dumpsys audio 2>/dev/null | grep -A9 "^- STREAM_MUSIC:" | grep "Devices:" | head -1',
  'echo @@outputs',
  'dumpsys media.audio_policy 2>/dev/null | sed -n "/Available output devices/,/Available input devices/p" | grep -E "^  - (type|tag name): "',
  'echo @@net',
  'dumpsys connectivity 2>/dev/null | grep -m6 -E "Active default network|NetworkAgentInfo\\{" | cut -c1-200',
  'echo @@wifi',
  'dumpsys wifi 2>/dev/null | grep -m1 "mWifiInfo SSID" | cut -c1-500',
  'echo @@end',
].join('; ');

// Découpe la sortie en sections @@nom ; une section vide ou absente vaut ''
function sections(out) {
  const s = {};
  let cur = null;
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = /^@@(\w+)$/.exec(line.trim());
    if (m) { cur = m[1]; s[cur] = []; continue; }
    if (cur) s[cur].push(line);
  }
  return s;
}

// Type d'appareil d'après son nom (dernier recours quand Android ne le dit pas)
function kindFromName(name) {
  const n = String(name || '');
  if (/remote|t[ée]l[ée]commande|\brcu?\b|rc[_ -]?\d|_rc|\brc\d|g\d{2}s?\b|voice/i.test(n)) return 'remote';
  if (/controller|gamepad|manette|joy-?con|xbox|dual ?(shock|sense)|8bitdo|gamesir|stadia|ipega|joystick/i.test(n)) return 'gamepad';
  if (/keyboard|clavier|\bk\d{3}\b/i.test(n)) return 'keyboard';
  if (/mouse|souris|trackball|\bmx\b/i.test(n)) return 'mouse';
  if (/buds|airpods|head(phone|set)|casque|ecouteur|écouteur|earbud|speaker|enceinte|soundbar|barre|jbl|bose|sonos|marshall|beats|\bwh-|\bwf-|soundcore|audio/i.test(n)) return 'audio';
  return '';
}

// Classe Bluetooth (Android 13+ l'affiche) : catégorie principale
function kindFromClass(cls) {
  if (!cls) return '';
  const major = (cls >> 8) & 0x1f;
  const minor = (cls >> 2) & 0x3f;
  if (major === 0x04) return 'audio';
  if (major === 0x05) {
    if (minor & 0x10) return 'keyboard';
    if (minor & 0x20) return 'mouse';
    const sub = minor & 0x0f;
    if (sub === 0x02) return 'gamepad';
    if (sub === 0x03) return 'remote';
    return 'input';
  }
  if (major === 0x02) return 'phone';
  if (major === 0x01) return 'computer';
  return '';
}

function parseBluetooth(lines, hidBattery) {
  if (!lines || !lines.length) return null;
  const txt = lines.join('\n');
  const en = /^\s+enabled:\s*(\w+)/m.exec(txt);
  const st = /^\s+state:\s*(\w+)/m.exec(txt);
  if (!en && !st && !/Bonded devices/.test(txt)) return null;
  const enabled = en ? en[1] === 'true' : st ? st[1] === 'ON' : true;

  const devices = [];
  const byKey = new Map();
  let bonded = false;
  let profile = '';
  for (const line of lines) {
    if (/Bonded devices/.test(line)) { bonded = true; continue; }
    const p = /^Profile: (\w+)/.exec(line);
    if (p) { profile = p[1]; bonded = false; continue; }
    const mac = (MAC.exec(line) || [])[0];
    if (!mac) { if (!/^\s{4}/.test(line)) bonded = false; continue; }
    const key = macKey(mac);
    // Liste des appareils appairés : « MAC [ LE ] Nom » ou « MAC [ DUAL ][ 0x240404 ] Nom »
    const b = bonded && new RegExp(`^\\s+${mac}\\s*\\[\\s*([\\w/]+)\\s*\\](?:\\s*\\[\\s*0x([0-9a-f]+)\\s*\\])?\\s*(.*)$`, 'i').exec(line);
    if (b) {
      if (!byKey.has(key)) {
        const d = { name: b[3].trim() || 'Appareil sans nom', key, tech: b[1].toUpperCase(), kind: kindFromClass(parseInt(b[2] || '0', 16)), connected: false, battery: null, policies: {} };
        byKey.set(key, d);
        devices.push(d);
      }
      continue;
    }
    const d = byKey.get(key);
    if (!d) continue;
    // Journal horodaté : n'indique pas l'état actuel
    if (/^\s*\d{2}-\d{2} \d{2}:\d{2}/.test(line)) continue;
    // Règles de connexion par profil (A2DP=100, HID_HOST=100…)
    const pol = /profile connection policy\(([^)]*)\)/.exec(line);
    if (pol) for (const [, k, v] of pol[1].matchAll(/(\w+)=(-?\d+)/g)) d.policies[k] = Number(v);
    if (profile === 'HidHostService' && new RegExp(`${mac}\\s*:\\s*2\\s*$`, 'i').test(line)) d.connected = true;
    if (/mActiveDevice:/.test(line) || /\bstate=Connected\b|\bSTATE_CONNECTED\b|\bCONNECTED\b(?!_)/.test(line)) {
      if (!/DISCONNECTED|Disconnected/.test(line)) d.connected = true;
    }
    // Niveau de batterie si la version d'Android l'affiche (pas les seuils « low_battery_threshold »)
    const bat = /\bbattery(?:[ _]?level)?\s*[:=]\s*(\d{1,3})\b|main_battery\s*[:=]\s*(\d{1,3})\b/i.exec(line);
    const lvl = bat ? Number(bat[1] || bat[2]) : -1;
    if (lvl >= 0 && lvl <= 100) d.battery = lvl;
  }
  for (const d of devices) {
    if (!d.kind) d.kind = kindFromName(d.name);
    if (!d.kind && d.policies.HID_HOST > 0) d.kind = 'input';
    if (!d.kind && (d.policies.A2DP > 0 || d.policies.HEADSET > 0 || d.policies.LE_AUDIO > 0)) d.kind = 'audio';
    if (d.battery === null && hidBattery.has(d.key)) d.battery = hidBattery.get(d.key);
    delete d.policies;
  }
  return { enabled, devices };
}

// Batterie exposée par le noyau pour les appareils HID (hid-<mac>-battery)
function parsePower(lines) {
  const m = new Map();
  for (const line of lines || []) {
    const [name, scope, cap] = line.trim().split('|');
    if (!name || !/^hid-|^wacom|^sony_controller|^nintendo/i.test(name) && scope !== 'Device') continue;
    const mac = (MAC.exec(name) || [])[0];
    const v = Number(cap);
    if (mac && cap !== '' && v >= 0 && v <= 100) m.set(macKey(mac), v);
  }
  return m;
}

const BUS = { '0x0003': 'usb', '0x0005': 'bluetooth' };

function parseInputs(lines) {
  if (!lines || !lines.length) return null;
  const raw = [];
  let cur = null;
  for (const line of lines) {
    const h = /^\s+(-?\d+): (.+)$/.exec(line);
    if (h && !/^(Classes|Identifier|UniqueId|Descriptor)/.test(h[2])) { cur = { id: Number(h[1]), name: h[2].trim(), classes: '', bus: '', uniq: '', desc: '' }; raw.push(cur); continue; }
    if (!cur) continue;
    let m;
    if ((m = /Classes:\s*(.*)$/.exec(line))) cur.classes = m[1];
    else if ((m = /Identifier:.*bus=(0x[0-9a-f]+)/i.exec(line))) cur.bus = m[1].toLowerCase();
    else if ((m = /UniqueId:\s*(.*)$/.exec(line))) cur.uniq = m[1].trim();
    else if ((m = /Descriptor:\s*(\w+)/.exec(line))) cur.desc = m[1];
  }
  const out = [];
  const seen = new Map();
  let ir = false;
  for (const d of raw) {
    if (d.id < 0 || /VIRTUAL/.test(d.classes)) continue;
    const via = BUS[d.bus];
    if (!via) {
      // Récepteur infrarouge intégré : c'est la télécommande d'origine
      const n = d.name.replace(/[_-]+/g, ' ');
      if (!ir && /\bir\b|infrared|\bremote ?ctl\b|\brc keys?\b/i.test(n) && !/virtual/i.test(n)) {
        ir = true;
        out.push({ name: 'Télécommande infrarouge', kind: 'remote', via: 'ir', detail: 'Récepteur intégré à la TV', mac: '' });
      }
      continue; // entrées virtuelles et boutons de la TV ignorés
    }
    // Un même appareil peut créer plusieurs entrées (clavier + souris…) : on les regroupe
    const base = d.name.replace(/\s+(Consumer Control|System Control|Keyboard|Mouse|Touchpad|Motion Sensors|Keys)$/i, '').trim();
    const group = d.desc || `${via}:${base}`;
    const c = d.classes;
    let kind = kindFromName(base);
    if (!kind) {
      if (/GAMEPAD|JOYSTICK/.test(c)) kind = 'gamepad';
      else if (/ALPHAKEY/.test(c)) kind = 'keyboard';
      else if (/CURSOR|TOUCH/.test(c)) kind = 'mouse';
      else if (/DPAD|KEYBOARD/.test(c)) kind = 'remote';
      else kind = 'input';
    }
    const prev = seen.get(group);
    if (prev) {
      // Priorité au type le plus parlant (une manette expose aussi un « clavier »)
      const rank = { gamepad: 4, keyboard: 3, remote: 2, mouse: 1, input: 0, audio: 0 };
      if ((rank[kind] || 0) > (rank[prev.kind] || 0)) prev.kind = kind;
      continue;
    }
    const item = { name: base || d.name, kind, via, detail: '', mac: via === 'bluetooth' && MAC.test(d.uniq) ? macKey(d.uniq) : '' };
    seen.set(group, item);
    out.push(item);
  }
  return out;
}

function parseStorage(mountLines, dfLines) {
  if (!mountLines || (!mountLines.length && !(dfLines || []).length)) return null;
  const vols = [];
  const disks = {};
  let cur = null;
  let disk = null;
  for (const line of mountLines) {
    const dk = /DiskInfo\{([^}]+)\}/.exec(line);
    if (dk) { disk = disks[dk[1]] = { flags: '', label: '' }; cur = null; }
    const vi = /VolumeInfo\{([^}]+)\}/.exec(line);
    if (vi) { cur = { id: vi[1], type: '', state: '', fsType: '', label: '', path: '', diskId: '' }; vols.push(cur); disk = null; }
    if (disk) {
      const f = /flags=(\S+)/.exec(line); if (f) disk.flags = f[1];
      const l = /label=(.+?)(?:\s+\w+=|$)/.exec(line); if (l && l[1] !== 'null') disk.label = l[1].trim();
    }
    if (cur) {
      for (const [, k, v] of line.matchAll(/(\w+)=(\S*)/g)) {
        if (k === 'type') cur.type = v;
        else if (k === 'state') cur.state = v;
        else if (k === 'fsType') cur.fsType = v === 'null' ? '' : v;
        else if (k === 'path') cur.path = v === 'null' ? '' : v;
        else if (k === 'diskId') cur.diskId = v === 'null' ? '' : v;
      }
      // Le nom d'une clé peut contenir des espaces
      const fl = /fsLabel=(.*?)(?:\s+\w+=|\s*$)/.exec(line);
      if (fl) cur.label = fl[1] === 'null' ? '' : fl[1].trim();
    }
  }
  // Espace libre lu avec df (1K-blocks, utilisé, disponible)
  const space = {};
  for (const line of dfLines || []) {
    const cols = line.trim().split(/\s+/);
    const mount = cols[cols.length - 1];
    const nums = cols.filter((x) => /^\d+$/.test(x)).map(Number);
    if (nums.length >= 3) space[mount.split('/').pop()] = { totalMb: Math.round(nums[0] / 1024), freeMb: Math.round(nums[2] / 1024) };
  }
  const out = [];
  for (const v of vols) {
    if (v.type !== 'PUBLIC') continue; // stockage interne et partitions privées ignorés
    const d = disks[v.diskId] || {};
    const uuid = (v.path || '').split('/').pop();
    const sp = space[uuid] || null;
    out.push({
      name: v.label || d.label || 'Stockage USB',
      fs: v.fsType.toUpperCase(),
      sd: /SD/.test(d.flags || ''),
      mounted: v.state === 'MOUNTED',
      state: v.state,
      totalMb: sp ? sp.totalMb : null,
      freeMb: sp ? sp.freeMb : null,
    });
  }
  // Aucune information de dumpsys mount : on se rabat sur df seul
  if (!vols.length) {
    for (const [uuid, sp] of Object.entries(space)) {
      if (uuid === 'emulated' || /^\d+$/.test(uuid)) continue;
      out.push({ name: uuid, fs: '', sd: false, mounted: true, state: 'MOUNTED', ...sp });
    }
  }
  return out;
}

// Périphériques USB branchés (hors puces internes : Wi-Fi, Bluetooth, concentrateurs)
const USB_CLASS = { 1: 'audio', 3: 'input', 6: 'camera', 7: 'printer', 8: 'storage', 9: 'hub', 10: 'network', 14: 'camera', 224: 'radio', 2: 'network' };

function parseUsb(lines) {
  if (!lines || !lines.length) return null;
  const devs = [];
  let cur = null;
  for (const line of lines) {
    // Ancien format : tout sur une ligne
    const old = /UsbDevice\[mName=([^,]+).*?mClass=(\d+).*?mManufacturerName=([^,]*),\s*mProductName=([^,]*)/.exec(line);
    if (old) {
      const ifc = [...line.matchAll(/UsbInterface\[[^\]]*?mClass=(\d+)/g)].map((m) => Number(m[1]));
      devs.push({ path: old[1], cls: Number(old[2]), maker: old[3], product: old[4], ifaces: ifc, ifaceNames: [] });
      continue;
    }
    const nm = /^\s*name=(.*)$/.exec(line);
    if (nm && nm[1].startsWith('/dev/bus/usb')) { cur = { path: nm[1], cls: null, maker: '', product: '', ifaces: [], ifaceNames: [] }; devs.push(cur); continue; }
    if (!cur) continue;
    if (nm) { cur.ifaceNames.push(nm[1]); continue; }
    let m;
    if ((m = /^\s*class=(\d+)/.exec(line))) { if (cur.cls === null) cur.cls = Number(m[1]); else cur.ifaces.push(Number(m[1])); }
    else if ((m = /manufacturer_name=(.*)$/.exec(line))) cur.maker = m[1].trim();
    else if ((m = /product_name=(.*)$/.exec(line))) cur.product = m[1].trim();
  }
  const out = [];
  for (const d of devs) {
    const all = [d.cls, ...d.ifaces].filter((x) => x !== null);
    const label = `${d.maker} ${d.product} ${d.ifaceNames.join(' ')}`;
    if (all.includes(224) || all.includes(9) || /802\.11|wlan|wi-?fi|wireless|bluetooth|\bnic\b|\bhub\b/i.test(label)) continue;
    const classes = all.map((c) => USB_CLASS[c]).filter(Boolean);
    const kind = classes.includes('storage') ? 'storage' : classes.includes('camera') ? 'camera' : classes.includes('audio') ? 'audio'
      : classes.includes('network') ? 'network' : classes.includes('input') ? 'input' : 'usb';
    const name = [d.maker, d.product].filter((x) => x && x !== 'null').join(' ').trim();
    out.push({ name: name || 'Périphérique USB', kind });
  }
  return out;
}

const CEC_TYPE = { 1: 'recorder', 3: 'tuner', 4: 'player', 5: 'audio', 6: 'switch', 7: 'processor' };

function parseHdmi(lines) {
  if (!lines || !lines.length) return null;
  const txt = lines.join('\n');
  const flag = (k) => { const m = new RegExp(`${k}:\\s*(\\w+)`).exec(txt); return m ? m[1] === 'true' : null; };
  const locals = new Set();
  const ports = {};
  for (const line of lines) {
    const p = /port_id: (\d+), type: (\w+), address: (0x[0-9a-f]+).*?arc: (\w+)/i.exec(line);
    if (p) ports[p[1]] = { arc: p[4] === 'true' };
    const l = /mDeviceInfo: CEC: logical_address: (0x[0-9a-f]+)/i.exec(line);
    if (l) locals.add(l[1].toLowerCase());
  }
  const devices = [];
  const seen = new Set();
  for (const line of lines) {
    if (!/^\s+CEC: logical_address/.test(line)) continue;
    const g = (k) => (new RegExp(`${k}: (\\S+(?: (?!\\w+:)\\S+)*)`).exec(line) || [])[1] || '';
    const la = g('logical_address').toLowerCase();
    if (locals.has(la) || seen.has(la)) continue;
    seen.add(la);
    const type = Number(g('device_type'));
    const power = Number(g('power_status'));
    const port = Number(g('port_id'));
    devices.push({
      name: g('display_name') || 'Appareil HDMI',
      kind: CEC_TYPE[type] || 'other',
      port: port > 0 ? port : null,
      on: power === 0 ? true : power === 1 ? false : null,
    });
  }
  return {
    cec: flag('mIsCecAvailable'),
    arc: flag('mArcEstablished'),
    systemAudio: flag('mSystemAudioActivated'),
    arcPort: Object.keys(ports).find((k) => ports[k].arc) || null,
    devices,
  };
}

// Noms courts des sorties audio Android (dumpsys audio) et des types AUDIO_DEVICE_OUT_*
function audioKind(s) {
  const t = String(s || '').toLowerCase();
  if (/earc/.test(t)) return 'hdmi_earc';
  if (/arc/.test(t)) return 'hdmi_arc';
  if (/hdmi|aux_digital/.test(t)) return 'hdmi';
  if (/bt|bluetooth|ble_(headset|speaker|broadcast)/.test(t)) return 'bluetooth';
  if (/spdif/.test(t)) return 'spdif';
  if (/usb/.test(t)) return 'usb';
  if (/wired|headphone|headset/.test(t)) return 'headphone';
  if (/line/.test(t)) return 'line';
  if (/speaker/.test(t)) return 'speaker';
  return '';
}

function parseAudio(activeLines, outLines) {
  const act = ((activeLines || []).join(' ').match(/Devices:\s*(.*)$/) || [])[1];
  const active = act ? [...new Set(act.split(/[,\s]+/).map(audioKind).filter(Boolean))] : [];
  const outputs = [];
  for (const line of outLines || []) {
    const m = /- type: (AUDIO_DEVICE_OUT_\w+)/.exec(line);
    if (!m || /SUBMIX|TELEPHONY|ECHO|BUS|STUB|PROXY|FM|IP\b/.test(m[1])) continue;
    const k = audioKind(m[1].replace('AUDIO_DEVICE_OUT_', ''));
    if (k && !outputs.includes(k)) outputs.push(k);
  }
  if (!active.length && !outputs.length) return null;
  return { active, outputs };
}

function parseNetwork(netLines, wifiLines) {
  const net = netLines || [];
  const def = (/Active default network:\s*(\d+)/.exec(net.join('\n')) || [])[1];
  const nais = net.filter((l) => /NetworkAgentInfo\{/.test(l));
  const main = nais.find((l) => def && new RegExp(`network\\{${def}\\}`).test(l)) || nais.find((l) => /CONNECTED/.test(l));
  let type = '';
  if (main) type = /ni\{ETHERNET/.test(main) ? 'ethernet' : /ni\{WIFI/.test(main) ? 'wifi' : /ni\{VPN/.test(main) ? 'vpn' : '';
  const w = (wifiLines || []).join(' ');
  const ssid = (/SSID: "?([^",]*)"?,/.exec(w) || [])[1];
  const connected = /Supplicant state: COMPLETED/.test(w);
  if (!type && connected) type = 'wifi';
  if (!type) return null;
  const out = { type };
  if (type === 'wifi' && connected) {
    const rssi = Number((/RSSI: (-?\d+)/.exec(w) || [])[1]);
    const freq = Number((/Frequency: (\d+)/.exec(w) || [])[1]);
    const speed = Number((/Link speed: (\d+)/.exec(w) || [])[1]);
    out.ssid = ssid && ssid !== '<unknown ssid>' ? ssid : '';
    if (rssi && rssi < 0 && rssi > -127) {
      out.rssi = rssi;
      out.signal = rssi >= -55 ? 'excellent' : rssi >= -67 ? 'good' : rssi >= -75 ? 'fair' : 'weak';
    }
    if (freq) out.band = freq >= 5900 ? '6 GHz' : freq >= 4900 ? '5 GHz' : '2,4 GHz';
    if (speed > 0) out.linkMbps = speed;
  }
  return out;
}

async function list(target) {
  const r = await A.shell(target, SCRIPT, { timeout: 30000 });
  if (!r.ok && !r.out) throw Object.assign(new Error("La TV n'a pas répondu. Réessaie dans un instant."), { code: 409 });
  const s = sections(r.out);
  const hidBattery = parsePower(s.power);
  const bluetooth = parseBluetooth(s.bt, hidBattery);
  const inputs = parseInputs(s.input);
  // Un appareil Bluetooth visible parmi les entrées est forcément connecté
  if (bluetooth && inputs) {
    for (const i of inputs) {
      if (i.via !== 'bluetooth') continue;
      const b = bluetooth.devices.find((d) => (i.mac && d.key === i.mac) || d.name === i.name);
      if (b) {
        b.connected = true;
        if (!b.kind || b.kind === 'input') b.kind = i.kind;
        if (b.battery === null && hidBattery.has(b.key)) b.battery = hidBattery.get(b.key);
      }
      if (i.mac && hidBattery.has(i.mac)) i.battery = hidBattery.get(i.mac);
    }
  }
  for (const i of inputs || []) delete i.mac;
  if (bluetooth) for (const d of bluetooth.devices) delete d.key;
  const volumes = parseStorage(s.mount, s.df);
  const usbDevices = parseUsb(s.usb);
  // Clés et disques déjà listés avec leur espace libre ; claviers et manettes USB listés dans les entrées
  const others = (usbDevices || []).filter((d) => d.kind !== 'input' && !(d.kind === 'storage' && volumes && volumes.length));
  const usb = volumes === null && usbDevices === null ? null : { volumes: volumes || [], devices: others };
  return {
    at: new Date().toISOString(),
    bluetooth,
    inputs,
    usb,
    hdmi: parseHdmi(s.hdmi),
    audio: parseAudio(s.audio, s.outputs),
    network: parseNetwork(s.net, s.wifi),
  };
}

module.exports = { list, _parse: { sections, parseBluetooth, parseInputs, parseStorage, parseUsb, parseHdmi, parseAudio, parseNetwork, parsePower } };
