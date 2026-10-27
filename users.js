const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { league, tierIdx, TIERS } = require('./reward');

const DATA = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA, 'users.json');

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

let users = {};
try {
  if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
} catch (e) {
  users = {};
}

function save() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 0));
  } catch (e) {
    console.error('save users error', e.message);
  }
}

// Auto-save every 30s
setInterval(save, 30000);

function mkUser() {
  return {
    id: uuidv4(),
    name: 'Oyinchi' + (1000 + ((Math.random() * 9000) | 0)),
    av: '🙂',
    coins: 300,
    olmos: 40,
    adDay: '',
    adN: 0,
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
    token: uuidv4(),
    lastSeen: Date.now(),
  };
}

function byToken(token) {
  if (!token) return null;
  return Object.values(users).find((u) => u.token === token) || null;
}

function byId(id) {
  return users[id] || null;
}

function create() {
  const u = mkUser();
  users[u.id] = u;
  save();
  return u;
}

function getOrCreate(token) {
  let u = byToken(token);
  if (u) {
    u.lastSeen = Date.now();
    return u;
  }
  return create();
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
  const list = Object.values(users)
    .filter((x) => tierIdx(x.rating) === ti)
    .sort((a, b) => b.rating - a.rating);
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
  const list = Object.values(users)
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
  save();
  return { me: mine(u) };
}

module.exports = {
  getOrCreate,
  byToken,
  byId,
  create,
  pub,
  mine,
  top,
  updateProfile,
  save,
  users,
  league,
  tierIdx,
  TIERS,
};
