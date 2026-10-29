const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 40000 + Math.floor(Math.random() * 20000);
const URL = `http://localhost:${PORT}`;
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

let child;

async function waitReady() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${URL}/health`);
      if (r.ok) return;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server ishga tushmadi');
}

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

const ask = (s, event, data) => new Promise((res) => s.emit(event, data, res));
const askNoData = (s, event) => new Promise((res) => s.emit(event, res));

test.before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_DRIVER: 'memory', RECOVERY_SECRET: 'test-secret', PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitReady();
});

test.after(async () => {
  if (!child) return;
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  if (child.exitCode === null) child.kill('SIGKILL');
});

test('hello yangi hisob va tiklash kodini qaytaradi', async () => {
  const s = await connect();
  const hello = await ask(s, 'hello', {});
  assert.ok(hello.token);
  assert.match(hello.recoveryCode, CODE_RE);
  assert.ok(hello.me.id);
  s.close();
});

test('recover yangi token beradi, eski token boshqa hisob ochadi', async () => {
  const s1 = await connect();
  const first = await ask(s1, 'hello', {});

  const s2 = await connect();
  const rec = await ask(s2, 'recover', { code: first.recoveryCode });
  assert.equal(rec.me.id, first.me.id);
  assert.notEqual(rec.token, first.token);

  const old = await ask(s2, 'hello', { token: first.token });
  assert.notEqual(old.me.id, first.me.id);

  s1.close();
  s2.close();
});

test('newcode eski kodni bekor qiladi', async () => {
  const s = await connect();
  const hello = await ask(s, 'hello', {});
  const nc = await askNoData(s, 'newcode');
  assert.match(nc.code, CODE_RE);

  const s2 = await connect();
  const oldCode = await ask(s2, 'recover', { code: hello.recoveryCode });
  assert.equal(oldCode.err, 'Kod topilmadi');
  const newCode = await ask(s2, 'recover', { code: nc.code });
  assert.equal(newCode.me.id, hello.me.id);

  s.close();
  s2.close();
});

test("delete hisobni o'chiradi", async () => {
  const s = await connect();
  const hello = await ask(s, 'hello', {});
  const del = await askNoData(s, 'delete');
  assert.equal(del.ok, 1);

  const again = await askNoData(s, 'newcode');
  assert.equal(again.err, 'Avval kirish kerak');

  const s2 = await connect();
  const rec = await ask(s2, 'recover', { code: hello.recoveryCode });
  assert.equal(rec.err, 'Kod topilmadi');

  s.close();
  s2.close();
});

test("recover brute-force limiti ishlaydi", async () => {
  const s = await connect();
  const results = [];
  for (let i = 0; i < 6; i++) {
    results.push(await ask(s, 'recover', { code: 'AAAA-AAAA-AAAA' }));
  }
  assert.equal(results[0].err, 'Kod topilmadi');
  assert.match(results[5].err, /Juda ko'p urinish/);
  s.close();
});
