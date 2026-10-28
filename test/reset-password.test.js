'use strict';
// Tests de la réinitialisation du mot de passe par l'administrateur (mot de passe provisoire, sessions
// fermées, changement obligatoire), sur un dossier de données temporaire.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atvm-reset-'));
process.env.DATA_DIR = TMP; // store.js ne doit jamais toucher aux vraies données

const auth = require('../server/lib/auth');

const ADMIN_PASS = 'Admin#2026x';
const USER_PASS = 'Alice!2026y';
const fakeReq = (token) => ({ headers: { cookie: token ? `atvm_session=${token}` : '' }, socket: {} });
const usersFile = () => fs.readFileSync(path.join(TMP, 'users.json'), 'utf8');

let admin, alice, logs = [];
const origLog = console.log;

test.before(() => {
  admin = auth.setup({ username: 'admin', password: ADMIN_PASS });
  const inv = auth.createInvite(admin, '');
  alice = auth.register({ username: 'alice', password: USER_PASS, invite: inv.code });
  console.log = (...a) => { logs.push(a.join(' ')); };
});
test.after(() => { console.log = origLog; fs.rmSync(TMP, { recursive: true, force: true }); });

test("l'administrateur ne peut pas réinitialiser son propre mot de passe", () => {
  assert.throws(() => auth.resetPassword(admin.id, admin), (e) => e.code === 400 && /Mon compte/.test(e.message));
});

test('compte inconnu : 404', () => {
  assert.throws(() => auth.resetPassword('inconnu', admin), (e) => e.code === 404);
});

test('réinitialisation : mot de passe provisoire valide, sessions fermées, rien en clair', () => {
  const t1 = auth.openSession(alice);
  const t2 = auth.openSession(alice);
  const tAdmin = auth.openSession(admin);
  assert.ok(auth.currentUser(fakeReq(t1)));

  logs = [];
  const out = auth.resetPassword(alice.id, admin);
  assert.strictEqual(out.username, 'alice');
  assert.strictEqual(out.twoFactor, false);
  assert.match(out.password, /^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/);

  // Toutes les sessions d'Alice sont fermées, pas celle de l'administrateur
  assert.strictEqual(auth.currentUser(fakeReq(t1)), null);
  assert.strictEqual(auth.currentUser(fakeReq(t2)), null);
  assert.ok(auth.currentUser(fakeReq(tAdmin)));

  // Ancien mot de passe refusé, provisoire accepté, drapeau exposé
  assert.throws(() => auth.login({ username: 'alice', password: USER_PASS }, '10.0.0.1'), (e) => e.code === 401);
  const u = auth.login({ username: 'alice', password: out.password }, '10.0.0.2');
  assert.strictEqual(auth.publicUser(u).mustChangePassword, true);

  // Ni le mot de passe provisoire ni l'ancien en clair dans users.json ou dans le journal
  const raw = usersFile();
  assert.ok(!raw.includes(out.password));
  assert.ok(!raw.includes(USER_PASS));
  assert.ok(/scrypt\$/.test(JSON.parse(raw)[alice.id].pass));
  assert.ok(logs.some((l) => l.includes('mot de passe réinitialisé par admin pour alice')));
  assert.ok(!logs.some((l) => l.includes(out.password)));

  // Changement : refusé si identique au provisoire, puis accepté et drapeau levé
  assert.throws(() => auth.changePassword(u, out.password, out.password), (e) => e.code === 400);
  auth.changePassword(u, out.password, 'Nouveau#2026z');
  const after = auth.login({ username: 'alice', password: 'Nouveau#2026z' }, '10.0.0.3');
  assert.strictEqual(auth.publicUser(after).mustChangePassword, false);
  assert.ok(!('mustChangePassword' in JSON.parse(usersFile())[alice.id]));
});

test('deux réinitialisations donnent deux mots de passe différents', () => {
  const a = auth.resetPassword(alice.id, admin).password;
  const b = auth.resetPassword(alice.id, admin).password;
  assert.notStrictEqual(a, b);
});

test('la 2FA est conservée et signalée', () => {
  const all = JSON.parse(usersFile());
  all[alice.id].totp = { secret: 'JBSWY3DPEHPK3PXP', lastStep: 0, recovery: [], enabledAt: new Date().toISOString() };
  fs.writeFileSync(path.join(TMP, 'users.json'), JSON.stringify(all));
  const out = auth.resetPassword(alice.id, admin);
  assert.strictEqual(out.twoFactor, true);
  assert.ok(JSON.parse(usersFile())[alice.id].totp, 'la 2FA ne doit pas être touchée');
});
