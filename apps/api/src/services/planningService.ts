import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';

export const MIN_PLANNING_YEAR = 2000;
export const MAX_PLANNING_YEAR = 2100;
export const MAX_PLANNING_SEATS = 10_000_000;
export const MAX_SCENARIO_PERCENT = 1000;

type PlanningDatabase = Database<sqlite3.Database, sqlite3.Statement>;
export type AdjustmentType = 'percent' | 'seats';

export interface CapacityOption {
  district_id: string;
  district_name: string;
  state_id: string;
  state_name: string;
  trade_id: string;
  trade_name: string;
  sector_id: string;
  sector_name: string;
  year: number;
  sanctioned_seats: number | null;
}

export class PlanningServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PlanningServiceError';
  }
}

function roundSeats(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function validatePlanningYear(year: unknown): year is number {
  return (
    typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= MIN_PLANNING_YEAR &&
    year <= MAX_PLANNING_YEAR
  );
}

export function validateSeatTarget(target: unknown): target is number {
  return (
    typeof target === 'number' &&
    Number.isSafeInteger(target) &&
    target >= 0 &&
    target <= MAX_PLANNING_SEATS
  );
}

export function compareTarget(
  targetSeats: number,
  currentCapacity: number | null,
): { difference_seats: number | null; difference_percent: number | null } {
  if (currentCapacity === null) {
    return { difference_seats: null, difference_percent: null };
  }
  const differenceSeats = targetSeats - currentCapacity;
  return {
    difference_seats: differenceSeats,
    difference_percent:
      currentCapacity === 0
        ? null
        : Math.round((differenceSeats / currentCapacity) * 10_000) / 100,
  };
}

export function calculateCapacityScenario(
  baselineSeats: number | null,
  adjustmentType: AdjustmentType,
  adjustmentValue: number,
): {
  baseline_seats: number;
  scenario_seats: number;
  delta_seats: number;
  adjustment_type: AdjustmentType;
  adjustment_value: number;
} {
  if (baselineSeats === null) {
    throw new PlanningServiceError(
      'Sanctioned-seat capacity is unavailable for this district, trade, and year.',
      409,
      'CAPACITY_UNAVAILABLE',
    );
  }
  if (
    !Number.isSafeInteger(baselineSeats) ||
    baselineSeats < 0 ||
    baselineSeats > MAX_PLANNING_SEATS
  ) {
    throw new PlanningServiceError(
      'The stored capacity is not a valid seat count for scenario planning.',
      409,
      'INVALID_BASELINE_CAPACITY',
    );
  }
  if (adjustmentType !== 'percent' && adjustmentType !== 'seats') {
    throw new PlanningServiceError('adjustment_type must be percent or seats.', 400, 'INVALID_ADJUSTMENT');
  }
  if (!Number.isFinite(adjustmentValue)) {
    throw new PlanningServiceError('adjustment_value must be finite.', 400, 'INVALID_ADJUSTMENT');
  }

  let deltaSeats: number;
  if (adjustmentType === 'percent') {
    if (adjustmentValue < -100 || adjustmentValue > MAX_SCENARIO_PERCENT) {
      throw new PlanningServiceError(
        `Percentage adjustment must be between -100 and ${MAX_SCENARIO_PERCENT}.`,
        400,
        'INVALID_ADJUSTMENT',
      );
    }
    deltaSeats = roundSeats((baselineSeats * adjustmentValue) / 100);
  } else {
    if (
      !Number.isSafeInteger(adjustmentValue) ||
      Math.abs(adjustmentValue) > MAX_PLANNING_SEATS
    ) {
      throw new PlanningServiceError(
        `Seat adjustment must be a whole number between -${MAX_PLANNING_SEATS} and ${MAX_PLANNING_SEATS}.`,
        400,
        'INVALID_ADJUSTMENT',
      );
    }
    deltaSeats = adjustmentValue;
  }

  const scenarioSeats = baselineSeats + deltaSeats;
  if (scenarioSeats < 0 || scenarioSeats > MAX_PLANNING_SEATS) {
    throw new PlanningServiceError(
      'The resulting scenario capacity must be between 0 and 10,000,000 seats.',
      400,
      'SCENARIO_CAPACITY_OUT_OF_RANGE',
    );
  }
  return {
    baseline_seats: baselineSeats,
    scenario_seats: scenarioSeats,
    delta_seats: deltaSeats,
    adjustment_type: adjustmentType,
    adjustment_value: adjustmentValue,
  };
}

export async function listCapacityOptions(db: PlanningDatabase): Promise<CapacityOption[]> {
  return db.all(`
    SELECT d.id AS district_id, d.name AS district_name, d.state_id,
           s.name AS state_name, t.id AS trade_id, t.name AS trade_name,
           sec.id AS sector_id, sec.name AS sector_name, tc.year,
           SUM(tc.sanctioned_seats) AS sanctioned_seats
    FROM training_capacity tc
    JOIN districts d ON d.id = tc.district_id
    JOIN states s ON s.id = d.state_id
    JOIN trades t ON t.id = tc.trade_id
    JOIN sectors sec ON sec.id = t.sector_id
    GROUP BY d.id, t.id, tc.year
    ORDER BY tc.year DESC, s.name, d.name, t.name
  `) as Promise<CapacityOption[]>;
}

export async function getCapacity(
  db: PlanningDatabase,
  districtId: string,
  tradeId: string,
  year: number,
): Promise<number | null> {
  const row = await db.get(
    `SELECT COUNT(*) AS records, SUM(sanctioned_seats) AS sanctioned_seats
     FROM training_capacity WHERE district_id = ? AND trade_id = ? AND year = ?`,
    [districtId, tradeId, year],
  ) as { records: number; sanctioned_seats: number | null };
  if (row.records === 0) {
    throw new PlanningServiceError(
      'No training-capacity record supports this district, trade, and year combination.',
      404,
      'UNSUPPORTED_SCOPE_PERIOD',
    );
  }
  return row.sanctioned_seats;
}

export async function savePlanningTarget(
  db: PlanningDatabase,
  input: { district_id: string; trade_id: string; year: number; target_seats: number },
) {
  const supported = await db.get(
    'SELECT 1 AS found FROM training_capacity WHERE district_id = ? AND trade_id = ? AND year = ? LIMIT 1',
    [input.district_id, input.trade_id, input.year],
  );
  if (!supported) {
    throw new PlanningServiceError(
      'No training-capacity record supports this district, trade, and year combination.',
      404,
      'UNSUPPORTED_SCOPE_PERIOD',
    );
  }

  const baselineSeats = await getCapacity(db, input.district_id, input.trade_id, input.year);
  const result = await db.run(
    `INSERT INTO planning_targets
       (district_id, trade_id, year, target_seats, baseline_sanctioned_seats)
     VALUES (?, ?, ?, ?, ?)`,
    [input.district_id, input.trade_id, input.year, input.target_seats, baselineSeats],
  );
  return db.get(
    `SELECT pt.*, d.name AS district_name, t.name AS trade_name,
            sec.name AS sector_name
     FROM planning_targets pt
     JOIN districts d ON d.id = pt.district_id
     JOIN trades t ON t.id = pt.trade_id
     JOIN sectors sec ON sec.id = t.sector_id
     WHERE pt.id = ?`,
    [result.lastID],
  );
}

export async function listPlanningTargets(
  db: PlanningDatabase,
  filters: { district_id?: string; trade_id?: string; year?: number },
) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.district_id) {
    where.push('pt.district_id = ?');
    params.push(filters.district_id);
  }
  if (filters.trade_id) {
    where.push('pt.trade_id = ?');
    params.push(filters.trade_id);
  }
  if (filters.year !== undefined) {
    where.push('pt.year = ?');
    params.push(filters.year);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const targets = await db.all(
    `SELECT pt.*, d.name AS district_name, t.name AS trade_name,
            sec.name AS sector_name
     FROM planning_targets pt
     JOIN districts d ON d.id = pt.district_id
     JOIN trades t ON t.id = pt.trade_id
     JOIN sectors sec ON sec.id = t.sector_id
     ${clause}
     ORDER BY pt.created_at DESC, pt.id DESC
     LIMIT 500`,
    params,
  ) as Array<Record<string, unknown> & {
    target_seats: number;
    baseline_sanctioned_seats: number | null;
  }>;
  return targets.map((target) => ({
    ...target,
    ...compareTarget(target.target_seats, target.baseline_sanctioned_seats),
  }));
}
