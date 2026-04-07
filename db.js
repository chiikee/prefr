const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'votes.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS polls (
    id          TEXT PRIMARY KEY,
    admin_key   TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT,
    options     TEXT NOT NULL, -- JSON array of strings
    status      TEXT NOT NULL DEFAULT 'open', -- 'open' | 'closed'
    recovery_hash TEXT, -- bcrypt hash of recovery passphrase
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS ballots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id    TEXT NOT NULL REFERENCES polls(id),
    alias      TEXT NOT NULL,
    ranking    TEXT NOT NULL, -- JSON array of option indices in ranked order
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

module.exports = db;
