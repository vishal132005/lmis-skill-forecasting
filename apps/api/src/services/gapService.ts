import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import {
  GAP_INTERVAL_COVERAGE,
  GAP_METHOD_VERSION,
  GAP_MINIMUM_INTERVAL_ERRORS,
  GAP_OPENING_CONVERSION_FACTOR,
  GAP_STATUSES,
  GAP_THRESHOLDS,
  GapStatus,
  MAX_GAP_FORECAST_HORIZON_MONTHS,
} from '../config/gapConfig';
import { runForecast } from './forecastService';

type ForecastRunner = typeof runForecast;

export interface GapFilters {
  state?: string;
  district_id?: string;
  trade_id?: string;
  sector?: string;
  period?: string;
}

interface DistrictTrade {
  district_id: string;
  trade_id: string;
}

interface CapacityRow {
  year: number;
  sanctioned_seats: number | null;
  placement_rate: number | null;
}

interface ForecastOrigin {
  cutoff_period: string;
  target_periods: string[];
  errors_by_horizon: number[];
}

interface ForecastSource {
  status: string;
  reason: string | null;
  method: string | null;
  forecast: Array<{ period: string; value: number }>;
  evaluation: {
    candidate_methods: Array<{ method: string; origins: ForecastOrigin[] }>;
  } | null;
}

interface ForecastResponse {
  sources: {
    job_postings: ForecastSource;
    industry_hiring: ForecastSource;
  };
}

export interface GapMetrics {
  forecast_demand: number;
  effective_supply: number;
  gap: number;
  gap_ratio: number | null;
  status: Exclude<GapStatus, 'INSUFFICIENT_DATA'>;
}

function classifyGap(gapRatio: number | null, effectiveSupply: number): GapMetrics['status'] {
  if (gapRatio === null) {
    return effectiveSupply > 0 ? 'OVERSUPPLY' : 'BALANCED';
  }
  const normalizedRatio = [
    GAP_THRESHOLDS.acuteShortage,
    GAP_THRESHOLDS.emergingShortage,
    GAP_THRESHOLDS.balanced,
    GAP_THRESHOLDS.approachingSaturation,
  ].reduce(
    (value, threshold) =>
      Math.abs(value - threshold) <= Number.EPSILON * 8 ? threshold : value,
    gapRatio,
  );
  if (normalizedRatio > GAP_THRESHOLDS.acuteShortage) return 'ACUTE_SHORTAGE';
  if (normalizedRatio > GAP_THRESHOLDS.emergingShortage) return 'EMERGING_SHORTAGE';
  if (normalizedRatio >= GAP_THRESHOLDS.balanced) return 'BALANCED';
  if (normalizedRatio >= GAP_THRESHOLDS.approachingSaturation) {
    return 'APPROACHING_SATURATION';
  }
  return 'OVERSUPPLY';
}

export function calculateGapMetrics(
  forecastDemand: number,
  effectiveSupply: number,
): GapMetrics {
  if (
    !Number.isFinite(forecastDemand) ||
    forecastDemand < 0 ||
    !Number.isFinite(effectiveSupply) ||
    effectiveSupply < 0
  ) {
    throw new Error('Forecast demand and effective supply must be finite non-negative numbers.');
  }
  const gap = forecastDemand - effectiveSupply;
  const gapRatio = forecastDemand === 0 ? null : gap / forecastDemand;
  return {
    forecast_demand: forecastDemand,
    effective_supply: effectiveSupply,
    gap,
    gap_ratio: gapRatio,
    status: classifyGap(gapRatio, effectiveSupply),
  };
}

function nextMonth(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const absoluteMonth = year * 12 + month;
  return `${Math.floor(absoluteMonth / 12)
    .toString()
    .padStart(4, '0')}-${String((absoluteMonth % 12) + 1).padStart(2, '0')}`;
}

function nextQuarterPeriods(latestMonth: string): string[] {
  const firstForecastMonth = nextMonth(latestMonth);
  const [, firstMonth] = firstForecastMonth.split('-').map(Number);
  const monthsToQuarterStart = (3 - ((firstMonth - 1) % 3)) % 3;
  let month = firstForecastMonth;
  for (let index = 0; index < monthsToQuarterStart; index += 1) month = nextMonth(month);
  return Array.from({ length: 4 }, (_, quarterIndex) => {
    const [year, quarterMonth] = month.split('-').map(Number);
    const period = `${year}-Q${Math.floor((quarterMonth - 1) / 3) + 1}`;
    month = nextMonth(nextMonth(nextMonth(month)));
    return period;
  });
}

function quarterMonths(period: string): string[] {
  const [year, quarter] = period.split('-Q');
  const firstMonth = (Number(quarter) - 1) * 3 + 1;
  return [0, 1, 2].map((offset) =>
    `${year}-${String(firstMonth + offset).padStart(2, '0')}`,
  );
}

function getSelectedOrigins(source: ForecastSource): ForecastOrigin[] {
  if (source.status !== 'forecasted' || source.method === null || !source.evaluation) return [];
  return source.evaluation.candidate_methods.find(
    (candidate) => candidate.method === source.method,
  )?.origins ?? [];
}

function intervalMarginForQuarter(
  postings: ForecastSource,
  hiring: ForecastSource,
  months: string[],
  period: string,
): { margin: number | null; reason: string | null } {
  const postingsOrigins = new Map(
    getSelectedOrigins(postings).map((origin) => [origin.cutoff_period, origin]),
  );
  const errors: number[] = [];
  for (const hiringOrigin of getSelectedOrigins(hiring)) {
    const postingsOrigin = postingsOrigins.get(hiringOrigin.cutoff_period);
    if (!postingsOrigin) continue;
    let quarterError = 0;
    let hasCompleteQuarter = true;
    for (const month of months) {
      const postingsIndex = postingsOrigin.target_periods.indexOf(month);
      const hiringIndex = hiringOrigin.target_periods.indexOf(month);
      if (postingsIndex < 0 || hiringIndex < 0) {
        hasCompleteQuarter = false;
        break;
      }
      quarterError +=
        postingsOrigin.errors_by_horizon[postingsIndex] +
        hiringOrigin.errors_by_horizon[hiringIndex];
    }
    if (hasCompleteQuarter) errors.push(quarterError * GAP_OPENING_CONVERSION_FACTOR);
  }
  if (errors.length < GAP_MINIMUM_INTERVAL_ERRORS) {
    return {
      margin: null,
      reason: `Only ${errors.length} paired rolling-origin errors are available for ${period}; at least ${GAP_MINIMUM_INTERVAL_ERRORS} are required to calibrate the nominal ${GAP_INTERVAL_COVERAGE * 100}% interval.`,
    };
  }
  const scores = errors.map(Math.abs).sort((left, right) => left - right);
  const rank = Math.min(
    scores.length,
    Math.ceil((scores.length + 1) * GAP_INTERVAL_COVERAGE),
  );
  return { margin: scores[rank - 1], reason: null };
}

function insufficientReason(forecast: ForecastResponse): string | null {
  const unavailable = (['job_postings', 'industry_hiring'] as const)
    .filter((sourceName) => forecast.sources[sourceName].status !== 'forecasted')
    .map((sourceName) => {
      const source = forecast.sources[sourceName];
      return `${sourceName}: ${source.reason ?? source.status}`;
    });
  return unavailable.length ? `Forecast unavailable (${unavailable.join('; ')}).` : null;
}

async function saveGap(
  db: Database<sqlite3.Database, sqlite3.Statement>,
  record: Record<string, unknown>,
): Promise<void> {
  await db.run(
    `INSERT INTO gap_results (
      district_id, trade_id, period, forecast_demand, demand_lower, demand_upper,
      sanctioned_seats, placement_rate, effective_supply, gap, gap_ratio,
      status, reason, computed_at, method_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(district_id, trade_id, period) DO UPDATE SET
      forecast_demand=excluded.forecast_demand,
      demand_lower=excluded.demand_lower,
      demand_upper=excluded.demand_upper,
      sanctioned_seats=excluded.sanctioned_seats,
      placement_rate=excluded.placement_rate,
      effective_supply=excluded.effective_supply,
      gap=excluded.gap,
      gap_ratio=excluded.gap_ratio,
      status=excluded.status,
      reason=excluded.reason,
      computed_at=excluded.computed_at,
      method_version=excluded.method_version`,
    [
      record.district_id,
      record.trade_id,
      record.period,
      record.forecast_demand,
      record.demand_lower,
      record.demand_upper,
      record.sanctioned_seats,
      record.placement_rate,
      record.effective_supply,
      record.gap,
      record.gap_ratio,
      record.status,
      record.reason,
      record.computed_at,
      record.method_version,
    ],
  );
}

async function markInsufficient(
  db: Database<sqlite3.Database, sqlite3.Statement>,
  pair: DistrictTrade,
  periods: string[],
  reason: string,
  computedAt: string,
): Promise<number> {
  for (const period of periods) {
    await saveGap(db, {
      district_id: pair.district_id,
      trade_id: pair.trade_id,
      period,
      forecast_demand: null,
      demand_lower: null,
      demand_upper: null,
      sanctioned_seats: null,
      placement_rate: null,
      effective_supply: null,
      gap: null,
      gap_ratio: null,
      status: 'INSUFFICIENT_DATA',
      reason,
      computed_at: computedAt,
      method_version: GAP_METHOD_VERSION,
    });
  }
  return periods.length;
}

function sourceForecastMap(source: ForecastSource): Map<string, number> {
  return new Map(source.forecast.map((point) => [point.period, point.value]));
}

export async function recomputeGaps(
  db: Database<sqlite3.Database, sqlite3.Statement>,
  filters: Omit<GapFilters, 'period'> = {},
  forecastRunner: ForecastRunner = runForecast,
): Promise<{ computed: number; insufficient: number }> {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.state) {
    conditions.push('d.state_id = ?');
    params.push(filters.state);
  }
  if (filters.district_id) {
    conditions.push('d.id = ?');
    params.push(filters.district_id);
  }
  if (filters.trade_id) {
    conditions.push('t.id = ?');
    params.push(filters.trade_id);
  }
  if (filters.sector) {
    conditions.push('t.sector_id = ?');
    params.push(filters.sector);
  }
  const pairs = (await db.all(
    `SELECT d.id AS district_id, t.id AS trade_id
     FROM districts d CROSS JOIN trades t
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY d.id, t.id`,
    params,
  )) as DistrictTrade[];

  const latestRows = (await db.all(
    `SELECT MAX(period) AS latest_period FROM (
      SELECT MAX(month) AS period FROM job_posting_signals
      UNION ALL
      SELECT MAX(month) AS period FROM industry_hiring_signals
    )`,
  )) as Array<{ latest_period: string | null }>;
  const latestMonth =
    latestRows[0]?.latest_period ??
    `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
  const periods = nextQuarterPeriods(latestMonth);
  const forecastHorizon = quarterMonths(periods[3])[2];
  const latestAbsoluteMonth = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    return year * 12 + month;
  };
  const horizonMonths =
    latestAbsoluteMonth(forecastHorizon) - latestAbsoluteMonth(latestMonth);
  if (horizonMonths > MAX_GAP_FORECAST_HORIZON_MONTHS) {
    throw new Error('Calendar-aligned gap forecast exceeded the supported horizon.');
  }

  let computed = 0;
  let insufficient = 0;
  const computedAt = new Date().toISOString();
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(4, pairs.length) }, async () => {
    while (nextIndex < pairs.length) {
      const pair = pairs[nextIndex];
      nextIndex += 1;
      let forecast: ForecastResponse;
      try {
        forecast = (await forecastRunner(
          db,
          pair.district_id,
          pair.trade_id,
          horizonMonths,
        )) as ForecastResponse;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        insufficient += await markInsufficient(
          db,
          pair,
          periods,
          `Forecast failed: ${message}`,
          computedAt,
        );
        continue;
      }

      const failure = insufficientReason(forecast);
      if (failure) {
        insufficient += await markInsufficient(db, pair, periods, failure, computedAt);
        continue;
      }
      const postingForecast = sourceForecastMap(forecast.sources.job_postings);
      const hiringForecast = sourceForecastMap(forecast.sources.industry_hiring);
      const annualCapacity = (await db.all(
        `SELECT year, sanctioned_seats, placement_rate
         FROM training_capacity WHERE district_id = ? AND trade_id = ?`,
        [pair.district_id, pair.trade_id],
      )) as CapacityRow[];

      for (const period of periods) {
        const months = quarterMonths(period);
        if (
          months.some(
            (month) => !postingForecast.has(month) || !hiringForecast.has(month),
          )
        ) {
          insufficient += await markInsufficient(
            db,
            pair,
            [period],
            `Forecast did not include all three months required for ${period}.`,
            computedAt,
          );
          continue;
        }
        const [yearString] = period.split('-Q');
        const yearRows = annualCapacity.filter((row) => row.year === Number(yearString));
        if (
          yearRows.length === 0 ||
          yearRows.some(
            (row) =>
              row.sanctioned_seats === null ||
              !Number.isFinite(row.sanctioned_seats) ||
              row.sanctioned_seats < 0 ||
              row.placement_rate === null ||
              !Number.isFinite(row.placement_rate) ||
              row.placement_rate < 0 ||
              row.placement_rate > 1,
          )
        ) {
          insufficient += await markInsufficient(
            db,
            pair,
            [period],
            `Sanctioned-seat or placement-rate data is missing or invalid for ${yearString}.`,
            computedAt,
          );
          continue;
        }
        const sanctionedSeats = yearRows.reduce(
          (total, row) => total + (row.sanctioned_seats as number),
          0,
        );
        const placementRate =
          sanctionedSeats === 0
            ? 0
            : yearRows.reduce(
                (total, row) =>
                  total +
                  (row.sanctioned_seats as number) * (row.placement_rate as number),
                0,
              ) / sanctionedSeats;
        const quarterlySeats = sanctionedSeats / 4;
        const effectiveSupply = quarterlySeats * placementRate;
        const monthlyDemand = months.map(
          (month) =>
            ((postingForecast.get(month) as number) +
              (hiringForecast.get(month) as number)) *
            GAP_OPENING_CONVERSION_FACTOR,
        );
        const demand = monthlyDemand.reduce((total, value) => total + value, 0);
        const interval = intervalMarginForQuarter(
          forecast.sources.job_postings,
          forecast.sources.industry_hiring,
          months,
          period,
        );
        if (interval.margin === null) {
          insufficient += await markInsufficient(
            db,
            pair,
            [period],
            interval.reason ?? 'Prediction interval could not be calibrated.',
            computedAt,
          );
          continue;
        }
        const demandMargin = interval.margin;
        const metrics = calculateGapMetrics(demand, effectiveSupply);
        await saveGap(db, {
          district_id: pair.district_id,
          trade_id: pair.trade_id,
          period,
          forecast_demand: demand,
          demand_lower: Math.max(0, demand - demandMargin),
          demand_upper: demand + demandMargin,
          sanctioned_seats: sanctionedSeats,
          placement_rate: placementRate,
          effective_supply: effectiveSupply,
          gap: metrics.gap,
          gap_ratio: metrics.gap_ratio,
          status: metrics.status,
          reason: null,
          computed_at: computedAt,
          method_version: GAP_METHOD_VERSION,
        });
        computed += 1;
      }
    }
  });
  await Promise.all(workers);
  return { computed, insufficient };
}

function buildGapWhere(filters: GapFilters): { where: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.state) {
    conditions.push('d.state_id = ?');
    params.push(filters.state);
  }
  if (filters.district_id) {
    conditions.push('g.district_id = ?');
    params.push(filters.district_id);
  }
  if (filters.trade_id) {
    conditions.push('g.trade_id = ?');
    params.push(filters.trade_id);
  }
  if (filters.sector) {
    conditions.push('t.sector_id = ?');
    params.push(filters.sector);
  }
  if (filters.period) {
    conditions.push('g.period = ?');
    params.push(filters.period);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export async function getGapResults(
  db: Database<sqlite3.Database, sqlite3.Statement>,
  filters: GapFilters,
) {
  const { where, params } = buildGapWhere(filters);
  const data = await db.all(
    `SELECT g.district_id, d.name AS district_name, d.state_id,
            g.trade_id, t.name AS trade_name, t.sector_id, s.name AS sector_name,
            g.period, g.forecast_demand, g.demand_lower, g.demand_upper,
            g.sanctioned_seats, g.placement_rate, g.effective_supply,
            g.gap, g.gap_ratio,
            g.demand_lower - g.effective_supply AS best_case_gap,
            g.demand_upper - g.effective_supply AS worst_case_gap,
            g.status, g.reason, g.computed_at,
            g.method_version
     FROM gap_results g
     JOIN districts d ON d.id = g.district_id
     JOIN trades t ON t.id = g.trade_id
     JOIN sectors s ON s.id = t.sector_id
     ${where}
     ORDER BY g.period, d.name, t.name`,
    params,
  );
  return {
    data,
    methodology: {
      gap_formula: 'forecast_demand - effective_supply',
      effective_supply_formula: 'sanctioned_seats / 4 * placement_rate',
      demand_conversion_factor: GAP_OPENING_CONVERSION_FACTOR,
      prediction_interval_coverage: GAP_INTERVAL_COVERAGE,
    },
  };
}

export async function getGapSummary(
  db: Database<sqlite3.Database, sqlite3.Statement>,
  period?: string,
) {
  const params = period ? [period] : [];
  const periodWhere = period ? 'WHERE g.period = ?' : '';
  const rows = (await db.all(
    `SELECT d.state_id, g.status, COUNT(*) AS count
     FROM gap_results g
     JOIN districts d ON d.id = g.district_id
     ${periodWhere}
     GROUP BY d.state_id, g.status`,
    params,
  )) as Array<{ state_id: string; status: GapStatus; count: number }>;
  const createCounts = () =>
    Object.fromEntries(GAP_STATUSES.map((status) => [status, 0])) as Record<GapStatus, number>;
  const national = createCounts();
  const states: Record<string, Record<GapStatus, number>> = {};
  for (const row of rows) {
    national[row.status] += row.count;
    states[row.state_id] ??= createCounts();
    states[row.state_id][row.status] += row.count;
  }
  return { period: period ?? null, national, states };
}
