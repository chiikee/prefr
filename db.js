const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const usePostgres = Boolean(process.env.DATABASE_URL);
let sqliteDb = null;
let pool = null;

function normalizeSql(sql, params) {
  if (!usePostgres) return { sql, params };
  let index = 0;
  const normalized = sql.replace(/\?/g, () => `$${++index}`);
  return { sql: normalized, params };
}

function sqliteRun(sql, params = []) {
  return sqliteDb.prepare(sql).run(...params);
}

function sqliteGet(sql, params = []) {
  return sqliteDb.prepare(sql).get(...params);
}

function sqliteAll(sql, params = []) {
  return sqliteDb.prepare(sql).all(...params);
}

async function pgRun(sql, params = []) {
  const { sql: pgSql, params: pgParams } = normalizeSql(sql, params);
  return pool.query(pgSql, pgParams);
}

async function pgGet(sql, params = []) {
  const { sql: pgSql, params: pgParams } = normalizeSql(sql, params);
  const res = await pool.query(pgSql, pgParams);
  return res.rows[0] || null;
}

async function pgAll(sql, params = []) {
  const { sql: pgSql, params: pgParams } = normalizeSql(sql, params);
  const res = await pool.query(pgSql, pgParams);
  return res.rows;
}

async function initSqlite() {
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'votes.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id          TEXT PRIMARY KEY,
      admin_key   TEXT NOT NULL UNIQUE,
      title       TEXT NOT NULL,
      description TEXT,
      options     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      recovery_hash TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ballots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id    TEXT NOT NULL REFERENCES polls(id),
      alias      TEXT NOT NULL,
      ranking    TEXT NOT NULL,
      submitted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(poll_id, alias)
    );

    CREATE TABLE IF NOT EXISTS recovery_attempts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id    TEXT NOT NULL,
      ip         TEXT NOT NULL,
      attempted_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

async function initPostgres() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS polls (
      id          TEXT PRIMARY KEY,
      admin_key   TEXT NOT NULL UNIQUE,
      title       TEXT NOT NULL,
      description TEXT,
      options     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      recovery_hash TEXT,
      created_at  INTEGER NOT NULL DEFAULT (extract(epoch from now())::integer)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ballots (
      id         BIGSERIAL PRIMARY KEY,
      poll_id    TEXT NOT NULL REFERENCES polls(id),
      alias      TEXT NOT NULL,
      ranking    TEXT NOT NULL,
      submitted_at INTEGER NOT NULL DEFAULT (extract(epoch from now())::integer),
      UNIQUE(poll_id, alias)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recovery_attempts (
      id         BIGSERIAL PRIMARY KEY,
      poll_id    TEXT NOT NULL,
      ip         TEXT NOT NULL,
      attempted_at INTEGER NOT NULL DEFAULT (extract(epoch from now())::integer)
    );
  `);
}

async function init() {
  if (usePostgres) {
    await initPostgres();
  } else {
    await initSqlite();
  }
}

module.exports = {
  init,
  get: usePostgres ? pgGet : sqliteGet,
  all: usePostgres ? pgAll : sqliteAll,
  run: usePostgres ? pgRun : sqliteRun,
  nowExpr: usePostgres ? 'extract(epoch from now())::integer' : 'unixepoch()',
};