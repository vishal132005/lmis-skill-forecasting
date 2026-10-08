/**
 * SQLite database setup with sqlite and sqlite3.
 */
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { config } from './config';

let db: Database<sqlite3.Database, sqlite3.Statement>;

export async function getDb(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
  if (!db) {
    const dbDir = path.dirname(config.db.sqlitePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    db = await open({
      filename: config.db.sqlitePath,
      driver: sqlite3.Database
    });
    await db.exec('PRAGMA journal_mode = WAL');
    await db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

export async function initializeDatabase(): Promise<void> {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS states (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_hi TEXT, name_mr TEXT, name_ta TEXT,
      lgd_code INTEGER, lat REAL, lng REAL
    );

    CREATE TABLE IF NOT EXISTS districts (
      id TEXT PRIMARY KEY,
      state_id TEXT NOT NULL REFERENCES states(id),
      name TEXT NOT NULL,
      name_hi TEXT, name_mr TEXT, name_ta TEXT,
      lgd_code INTEGER, lat REAL, lng REAL
    );

    CREATE TABLE IF NOT EXISTS sectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_hi TEXT, name_mr TEXT, name_ta TEXT,
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      sector_id TEXT NOT NULL REFERENCES sectors(id),
      name TEXT NOT NULL,
      name_hi TEXT, name_ta TEXT,
      nco_code TEXT, nsqf_level INTEGER, qp_code TEXT
    );

    CREATE TABLE IF NOT EXISTS job_posting_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      district_id TEXT NOT NULL REFERENCES districts(id),
      trade_id TEXT NOT NULL REFERENCES trades(id),
      month TEXT NOT NULL,
      postings_count INTEGER NOT NULL,
      source TEXT
    );

    CREATE TABLE IF NOT EXISTS industry_hiring_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      district_id TEXT NOT NULL REFERENCES districts(id),
      trade_id TEXT NOT NULL REFERENCES trades(id),
      month TEXT NOT NULL,
      hires INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eshram_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      district_id TEXT NOT NULL REFERENCES districts(id),
      trade_id TEXT NOT NULL REFERENCES trades(id),
      month TEXT NOT NULL,
      registered_workers INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS training_capacity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      district_id TEXT NOT NULL REFERENCES districts(id),
      trade_id TEXT NOT NULL REFERENCES trades(id),
      year INTEGER NOT NULL,
      sanctioned_seats INTEGER, enrolled INTEGER,
      certified INTEGER, placed INTEGER,
      centres_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS demand_indices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      district_id TEXT NOT NULL, trade_id TEXT NOT NULL,
      month TEXT NOT NULL,
      index_value REAL NOT NULL,
      components TEXT
    );

    CREATE TABLE IF NOT EXISTS forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      district_id TEXT NOT NULL, trade_id TEXT NOT NULL,
      horizon_month TEXT NOT NULL,
      demand_forecast REAL, supply_forecast REAL,
      gap REAL, lower_ci REAL, upper_ci REAL
    );

    CREATE TABLE IF NOT EXISTS gap_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      district_id TEXT NOT NULL, trade_id TEXT NOT NULL,
      severity_score REAL, category TEXT,
      demand_total REAL, supply_total REAL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      district_id TEXT NOT NULL, trade_id TEXT NOT NULL,
      type TEXT NOT NULL, severity TEXT NOT NULL,
      reason TEXT, created_at TEXT, status TEXT DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS plfs_benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state_id TEXT NOT NULL, sector_id TEXT NOT NULL,
      year INTEGER, employment_rate REAL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL, password_hash TEXT,
      state_scope TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_job_postings_dt ON job_posting_signals(district_id, trade_id, month);
    CREATE INDEX IF NOT EXISTS idx_hiring_dt ON industry_hiring_signals(district_id, trade_id, month);
    CREATE INDEX IF NOT EXISTS idx_demand_idx ON demand_indices(district_id, trade_id, month);
    CREATE INDEX IF NOT EXISTS idx_forecasts_dt ON forecasts(district_id, trade_id);
    CREATE INDEX IF NOT EXISTS idx_gaps_dt ON gap_scores(district_id, trade_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_dt ON alerts(district_id, trade_id, status);
    CREATE INDEX IF NOT EXISTS idx_training_dt ON training_capacity(district_id, trade_id, year);
  `);

  console.log('✅ Database schema initialized');
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.close();
  }
}
