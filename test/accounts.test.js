process.env.DB_DRIVER = 'memory';
process.env.RECOVERY_SECRET = 'test-secret';
process.env.AD_DAILY = '3';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const U = require('../users');

const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

test.before(async () => {
  await db.init();
  await U.init();
});

test.after(async () => {
  await db.close();
});

test('yangi hisob yaratiladi va token orqali topiladi', async () => {
  const { u, code } = await U.getOrCreate(null);
  assert.match(code, CODE_RE);
  assert.equal(U.byToken(u.token).id, u.id);
  assert.equal(U.byToken('mavjud-emas'), null);
  assert.equal(U.AD_DAILY, 3);
});

test("o'zgarishlar flush orqali bazaga yoziladi", async () => {
  const { u } = await U.getOrCreate(null);
  u.coins = 777;
  U.save(u);
  await U.flush();
  const { rows } = await db.getPool().query('SELECT coins FROM users WHERE id=$1', [u.id]);
  assert.equal(Number(rows[0].coins), 777);
});

test('tiklash kodi bilan kirish tokenni almashtiradi', async () => {
  const { u, code } = await U.getOrCreate(null);
  const oldToken = u.token;
  const recovered = U.recoverByCode(code);
  assert.equal(recovered.id, u.id);
  assert.notEqual(u.token, oldToken);
  assert.equal(U.byToken(oldToken), null);
  assert.equal(U.byToken(u.token).id, u.id);
  await U.flush();
});

test("eski kod yangi kod olingandan keyin ishlamaydi", async () => {
  const { u, code } = await U.getOrCreate(null);
  const code2 = U.rotateCode(u);
  assert.match(code2, CODE_RE);
  assert.notEqual(code2, code);
  assert.equal(U.recoverByCode(code), null);
  assert.equal(U.recoverByCode(code2).id, u.id);
});

test("noto'g'ri formatdagi kod rad etiladi", async () => {
  assert.equal(U.recoverByCode('1234'), null);
  assert.equal(U.recoverByCode('OOOO-OOOO-OOOO'), null);
  assert.equal(U.recoverByCode(''), null);
});

test("hisobni o'chirish bazadan ham o'chiradi", async () => {
  const { u } = await U.getOrCreate(null);
  await U.removeUser(u);
  assert.equal(U.byId(u.id), null);
  const { rows } = await db.getPool().query('SELECT 1 FROM users WHERE id=$1', [u.id]);
  assert.equal(rows.length, 0);
});
