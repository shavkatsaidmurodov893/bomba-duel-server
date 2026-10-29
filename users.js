const crypto = require('crypto');
const db = require('./db');
const { league, tierIdx, TIERS } = require('./reward');

const AD_DAILY = Math.max(0, Number(process.env.AD_DAILY || 10) | 0);
const SECRET = process.env.RECOVERY_SECRET || (process.env.DB_DRIVER === 'memory' ? 'dev-only-secret' : '');
if (!SECRET) throw new Error('RECOVERY_SECRET talab qilinadi');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 12;

const users = new Map();
const tokenIdx = new Map();
const recIdx = new Map();
const dirty = new Set();
let flushing = false;

const INSERT_SQL = `INSERT INTO users
  (id, token, recovery, name, av, coins, olmos, rating, games, w, d, l, streak, best, wday, pday, dn, pairs, ad_day, ad_n, created, last_seen)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`;

const UPDATE_SQL = `UPDATE users SET
  token=$2, recovery=$3, name=$4, av=$5, coins=$6, olmos=$7, rating=$8, games=$9,
  w=$10, d=$11, l=$12, streak=$13, best=$14, wday=$15, pday=$16, dn=$17,
  pairs=$18, ad_day=$19, ad_n=$20, last_seen=$21
  WHERE id=$1`;

function normalizeRecovery(code) {
  const s = String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (s.length !== CODE_LEN) return '';
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return '';
  return s;
}

function hashRecovery(code) {
  const s = normalizeRecovery(code);
  if (!s) return '';
  return crypto.createHmac('sha256', SECRET).update(s).digest('hex');
}

function newRecoveryCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s.replace(/(.{4})(?=.)/g, '$1-');
}

function mkUser() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    recovery: '',
    name: 'Oyinchi' + (1000 + ((Math.random() * 9000) | 0)),
    av: '🙂',
    coins: 300,
    olmos: 40,
    rating: 0,
    games: 0,
    w: 0,
    d: 0,
    l: 0,
    streak: 0,
    best: 0,
    wday: '',
    pday: '',
    dn: 0,
    pairs: {},
    adDay: '',
    adN: 0,
    created: now,
    lastSeen: now,
  };
}

function baseParams(u) {
  return [
    u.id,
    u.token,
    u.recovery,
    u.name,
    u.av,
    u.coins | 0,
    u.olmos | 0,
    u.rating | 0,
    u.games | 0,
    u.w | 0,
    u.d | 0,
    u.l | 0,
    u.streak | 0,
    u.best | 0,
    u.wday || '',
    u.pday || '',
    u.dn | 0,
    JSON.stringify(u.pairs || {}),
    u.adDay || '',
    u.adN | 0,
  ];
}

const insertParams = (u) => [...baseParams(u), u.created, u.lastSeen];
const updateParams = (u) => [...baseParams(u), u.lastSeen];

function fromRow(r) {
  let pairs = {};
  try {
    pairs = JSON.parse(r.pairs || '{}');
  } catch (e) {
    pairs = {};
  }
  return {
    id: r.id,
    token: r.token,
    recovery: r.recovery,
    name: r.name,
    av: r.av,
    coins: r.coins | 0,
    olmos: r.olmos | 0,
    rating: r.rating | 0,
    games: r.games | 0,
    w: r.w | 0,
    d: r.d | 0,
    l: r.l | 0,
    streak: r.streak | 0,
    best: r.best | 0,
    wday: r.wday || '',
    pday: r.pday || '',
    dn: r.dn | 0,
    pairs,
    adDay: r.ad_day || '',
    adN: r.ad_n | 0,
    created: Number(r.created) || Date.now(),
    lastSeen: Number(r.last_seen) || Date.now(),
  };
}

function index(u) {
  users.set(u.id, u);
  tokenIdx.set(u.token, u.id);
  recIdx.set(u.recovery, u.id);
}

function unindex(u) {
  users.delete(u.id);
  tokenIdx.delete(u.token);
  recIdx.delete(u.recovery);
}

async function init() {
  const { rows } = await db.getPool().query('SELECT * FROM users');
  users.clear();
  tokenIdx.clear();
  recIdx.clear();
  for (const r of rows) index(fromRow(r));

  const timer = setInterval(() => flush().catch(() => {}), 1000);
  timer.unref();
  console.log(`[users] ${users.size} ta hisob yuklandi`);
}

function byId(id) {
  return users.get(id) || null;
}

function byToken(token) {
  const id = token && tokenIdx.get(String(token));
  return id ? users.get(id) || null : null;
}

function save(u) {
  if (u && users.has(u.id)) dirty.add(u.id);
}

async function create() {
  const u = mkUser();
  const code = newRecoveryCode();
  u.recovery = hashRecovery(code);
  await db.getPool().query(INSERT_SQL, insertParams(u));
  index(u);
  return { u, code };
}

async function getOrCreate(token) {
  const u = byToken(token);
  if (u) {
    u.lastSeen = Date.now();
    save(u);
    return { u, code: null };
  }
  return create();
}

function rotateToken(u) {
  const old = u.token;
  u.token = crypto.randomUUID();
  tokenIdx.delete(old);
  tokenIdx.set(u.token, u.id);
  save(u);
}

function recoverByCode(code) {
  const h = hashRecovery(code);
  if (!h) return null;
  const id = recIdx.get(h);
  if (!id) return null;
  const u = users.get(id);
  if (!u) return null;
  rotateToken(u);
  return u;
}

function rotateCode(u) {
  const code = newRecoveryCode();
  recIdx.delete(u.recovery);
  u.recovery = hashRecovery(code);
  recIdx.set(u.recovery, u.id);
  save(u);
  return code;
}

async function removeUser(u) {
  await db.getPool().query('DELETE FROM users WHERE id=$1', [u.id]);
  dirty.delete(u.id);
  unindex(u);
}

async function flush() {
  if (flushing || dirty.size === 0) return;
  flushing = true;
  const batch = [...dirty];
  dirty.clear();
  let client = null;
  try {
    client = await db.getPool().connect();
    await client.query('BEGIN');
    for (const id of batch) {
      const u = users.get(id);
      if (u) await client.query(UPDATE_SQL, updateParams(u));
    }
    await client.query('COMMIT');
  } catch (e) {
    for (const id of batch) if (users.has(id)) dirty.add(id);
    try {
      if (client) await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    if (client) client.release();
    flushing = false;
  }
}

function pub(u) {
  return {
    id: u.id,
    name: u.name,
    av: u.av,
    rating: u.rating,
    league: league(u.rating),
  };
}

function mine(u) {
  const ti = tierIdx(u.rating);
  const list = [...users.values()].filter((x) => tierIdx(x.rating) === ti).sort((a, b) => b.rating - a.rating);
  const rank = list.findIndex((x) => x.id === u.id) + 1;
  return {
    ...pub(u),
    tierRank: rank || 1,
    tierTotal: list.length || 1,
    olmos: u.olmos || 0,
    coins: u.coins,
    games: u.games,
    w: u.w,
    d: u.d,
    l: u.l,
    streak: u.streak,
    rating: u.rating,
  };
}

function top(tier) {
  const ti = Number.isInteger(tier) ? tier : 0;
  const list = [...users.values()]
    .filter((x) => tierIdx(x.rating) === ti)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 50)
    .map((x, i) => ({ ...pub(x), rank: i + 1 }));
  return { tier: ti, total: list.length, list };
}

function updateProfile(u, name, av) {
  const n = String(name || '')
    .replace(/[^\p{L}\p{N} _'’-]/gu, '')
    .trim()
    .slice(0, 12);
  if (n.length < 2) return { err: "Ism kamida 2 belgidan iborat bo'lsin" };
  u.name = n;
  const AVS = ['🙂', '😎', '🤠', '🥷', '🦊', '🐯', '🐼', '🦁', '👽', '🤖', '👻', '🐸'];
  if (AVS.includes(av)) u.av = av;
  save(u);
  return { me: mine(u) };
}

module.exports = {
  AD_DAILY,
  init,
  getOrCreate,
  byToken,
  byId,
  create,
  pub,
  mine,
  top,
  updateProfile,
  save,
  flush,
  recoverByCode,
  rotateCode,
  removeUser,
  normalizeRecovery,
  users,
  league,
  tierIdx,
  TIERS,
};
