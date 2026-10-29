const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  recovery TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  av TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT 300,
  olmos INTEGER NOT NULL DEFAULT 40,
  rating INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  w INTEGER NOT NULL DEFAULT 0,
  d INTEGER NOT NULL DEFAULT 0,
  l INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  wday TEXT NOT NULL DEFAULT '',
  pday TEXT NOT NULL DEFAULT '',
  dn INTEGER NOT NULL DEFAULT 0,
  pairs TEXT NOT NULL DEFAULT '{}',
  ad_day TEXT NOT NULL DEFAULT '',
  ad_n INTEGER NOT NULL DEFAULT 0,
  created BIGINT NOT NULL,
  last_seen BIGINT NOT NULL
)`;

let pool = null;

async function init() {
  if (pool) return;

  if (process.env.DB_DRIVER === 'memory') {
    const { newDb } = require('pg-mem');
    const { Pool } = newDb().adapters.createPg();
    pool = new Pool();
    console.warn('[db] DB_DRIVER=memory: ma\'lumotlar faqat jarayon davomida saqlanadi');
  } else {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL talab qilinadi (lokal ish uchun DB_DRIVER=memory)');
    }
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }

  await pool.query(SCHEMA);
}

function getPool() {
  if (!pool) throw new Error('db.init() chaqirilmagan');
  return pool;
}

async function close() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

module.exports = { init, getPool, close };
