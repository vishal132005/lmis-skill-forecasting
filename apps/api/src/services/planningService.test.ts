import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';
import {
  calculateCapacityScenario,
  compareTarget,
  getCapacity,
  PlanningServiceError,
  savePlanningTarget,
  validatePlanningYear,
  validateSeatTarget,
} from './planningService';

describe('capacity planning', () => {
  let db: Database<sqlite3.Database, sqlite3.Statement>;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE states (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE districts (id TEXT PRIMARY KEY, state_id TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE sectors (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE trades (id TEXT PRIMARY KEY, sector_id TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE training_capacity (
        id INTEGER PRIMARY KEY, district_id TEXT NOT NULL, trade_id TEXT NOT NULL,
        year INTEGER NOT NULL, sanctioned_seats INTEGER
      );
      CREATE TABLE planning_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, district_id TEXT NOT NULL,
        trade_id TEXT NOT NULL, year INTEGER NOT NULL, target_seats INTEGER NOT NULL,
        baseline_sanctioned_seats INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO states VALUES ('S1', 'State');
      INSERT INTO districts VALUES ('D1', 'S1', 'District');
      INSERT INTO sectors VALUES ('SEC1', 'Sector');
      INSERT INTO trades VALUES ('T1', 'SEC1', 'Trade');
      INSERT INTO training_capacity VALUES (1, 'D1', 'T1', 2026, 500);
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  test('compares targets only when baseline is available and handles a zero baseline', () => {
    expect(compareTarget(600, 500)).toEqual({
      difference_seats: 100,
      difference_percent: 20,
    });
    expect(compareTarget(600, 0)).toEqual({
      difference_seats: 600,
      difference_percent: null,
    });
    expect(compareTarget(600, null)).toEqual({
      difference_seats: null,
      difference_percent: null,
    });
  });

  test('validates supported year and bounded whole-seat target inputs', () => {
    expect(validatePlanningYear(2026)).toBe(true);
    expect(validatePlanningYear(2026.5)).toBe(false);
    expect(validatePlanningYear(2101)).toBe(false);
    expect(validateSeatTarget(0)).toBe(true);
    expect(validateSeatTarget(10_000_000)).toBe(true);
    expect(validateSeatTarget(-1)).toBe(false);
    expect(validateSeatTarget(2.5)).toBe(false);
    expect(validateSeatTarget(Number.POSITIVE_INFINITY)).toBe(false);
  });

  test('calculates percent and explicit-seat scenarios in matching seat units', () => {
    expect(calculateCapacityScenario(501, 'percent', 10)).toMatchObject({
      baseline_seats: 501,
      scenario_seats: 551,
      delta_seats: 50,
      adjustment_type: 'percent',
    });
    expect(calculateCapacityScenario(500, 'seats', -75)).toMatchObject({
      baseline_seats: 500,
      scenario_seats: 425,
      delta_seats: -75,
      adjustment_type: 'seats',
    });
    expect(calculateCapacityScenario(500, 'percent', -100).scenario_seats).toBe(0);
  });

  test('rejects invalid adjustments and scenarios that cross seat bounds', () => {
    expect(() => calculateCapacityScenario(500, 'percent', -101)).toThrow(PlanningServiceError);
    expect(() => calculateCapacityScenario(500, 'percent', Number.NaN)).toThrow(PlanningServiceError);
    expect(() => calculateCapacityScenario(500, 'seats', 1.5)).toThrow(PlanningServiceError);
    expect(() => calculateCapacityScenario(500, 'seats', -501)).toThrow(PlanningServiceError);
    expect(() => calculateCapacityScenario(10_000_000, 'percent', 1)).toThrow(PlanningServiceError);
  });

  test('does not treat missing baseline capacity as zero', async () => {
    await expect(getCapacity(db, 'D1', 'T1', 2025)).rejects.toMatchObject({
      status: 404,
      code: 'UNSUPPORTED_SCOPE_PERIOD',
    });
    await db.run(
      'INSERT INTO training_capacity (district_id, trade_id, year, sanctioned_seats) VALUES (?, ?, ?, NULL)',
      ['D1', 'T1', 2025],
    );
    const missingValue = await getCapacity(db, 'D1', 'T1', 2025);
    expect(missingValue).toBeNull();
    expect(() => calculateCapacityScenario(missingValue, 'seats', 10)).toThrow(
      expect.objectContaining({ code: 'CAPACITY_UNAVAILABLE' }),
    );
  });

  test('saves a separate target snapshot without changing baseline capacity', async () => {
    const saved = await savePlanningTarget(db, {
      district_id: 'D1',
      trade_id: 'T1',
      year: 2026,
      target_seats: 650,
    });
    expect(saved).toMatchObject({
      target_seats: 650,
      baseline_sanctioned_seats: 500,
      district_name: 'District',
      trade_name: 'Trade',
    });
    expect(await getCapacity(db, 'D1', 'T1', 2026)).toBe(500);
    expect(await db.get('SELECT COUNT(*) AS count FROM planning_targets')).toMatchObject({ count: 1 });
  });

  test('refuses to save a target for an unsupported district–trade–year combination', async () => {
    await expect(savePlanningTarget(db, {
      district_id: 'D1',
      trade_id: 'T1',
      year: 2025,
      target_seats: 650,
    })).rejects.toMatchObject({
      status: 404,
      code: 'UNSUPPORTED_SCOPE_PERIOD',
    });
    expect(await db.get('SELECT COUNT(*) AS count FROM planning_targets')).toMatchObject({ count: 0 });
  });
});
