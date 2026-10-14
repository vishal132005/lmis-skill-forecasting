/**
 * Supply Forecast Service – SFS-v1
 *
 * Models the supply side of the labour market by projecting future worker
 * availability from training capacity trends. Uses linear trend estimation
 * on historical sanctioned seats and placement rates, with pipeline stage
 * modeling to estimate effective supply.
 *
 * Pipeline stages: sanctioned_seats → enrolled → certified → placed
 * Each stage has a conversion rate derived from historical data.
 */
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';

export const SUPPLY_FORECAST_VERSION = 'SFS-v1';
const MIN_HISTORY_YEARS = 2;
const MAX_PROJECTION_QUARTERS = 8;

type SupplyDb = Database<sqlite3.Database, sqlite3.Statement>;

export interface SupplyHistoryRow {
  year: number;
  sanctioned_seats: number | null;
  enrolled: number | null;
  certified: number | null;
  placed: number | null;
  placement_rate: number | null;
  centres_count: number | null;
}

export interface PipelineRates {
  enrolment_rate: number;       // enrolled / sanctioned_seats
  certification_rate: number;   // certified / enrolled
  placement_rate: number;       // placed / certified
  overall_yield: number;        // placed / sanctioned_seats
}

export interface SupplyProjection {
  period: string;               // e.g. "2027-Q1"
  projected_seats: number;
  projected_enrolled: number;
  projected_certified: number;
  projected_placed: number;
  effective_quarterly_supply: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface SupplyForecastResult {
  district_id: string;
  district_name: string;
  trade_id: string;
  trade_name: string;
  methodology_version: string;
  history: SupplyHistoryRow[];
  pipeline_rates: PipelineRates;
  projections: SupplyProjection[];
  trend: {
    seats_annual_growth: number;
    seats_trend_direction: 'growing' | 'declining' | 'stable';
    placement_rate_trend: 'improving' | 'declining' | 'stable';
  };
  limitations: string[];
}

/**
 * Simple linear regression: returns slope and intercept.
 */
function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (xs[i] - meanX) * (ys[i] - meanY);
    ssXX += (xs[i] - meanX) ** 2;
    ssYY += (ys[i] - meanY) ** 2;
  }
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r2 = ssXX === 0 || ssYY === 0 ? 0 : (ssXY ** 2) / (ssXX * ssYY);
  return { slope, intercept, r2 };
}

/**
 * Compute pipeline conversion rates from historical data.
 * Uses weighted averages with more recent years weighted higher.
 */
function computePipelineRates(history: SupplyHistoryRow[]): PipelineRates {
  const valid = history.filter(
    (row) =>
      row.sanctioned_seats !== null &&
      row.sanctioned_seats > 0 &&
      row.enrolled !== null &&
      row.certified !== null &&
      row.placed !== null,
  );

  if (valid.length === 0) {
    return {
      enrolment_rate: 0.85,      // default assumptions
      certification_rate: 0.75,
      placement_rate: 0.60,
      overall_yield: 0.85 * 0.75 * 0.60,
    };
  }

  // Weighted average: weight = index + 1 (newer data gets higher weight)
  let totalWeight = 0;
  let wEnrol = 0, wCert = 0, wPlace = 0;
  for (let i = 0; i < valid.length; i++) {
    const weight = i + 1;
    totalWeight += weight;
    const seats = valid[i].sanctioned_seats as number;
    const enrolled = Math.min(valid[i].enrolled as number, seats);
    const certified = Math.min(valid[i].certified as number, enrolled);
    const placed = Math.min(valid[i].placed as number, certified);
    wEnrol += (enrolled / seats) * weight;
    wCert += (enrolled > 0 ? certified / enrolled : 0) * weight;
    wPlace += (certified > 0 ? placed / certified : 0) * weight;
  }

  const enrolmentRate = Math.max(0, Math.min(1, wEnrol / totalWeight));
  const certificationRate = Math.max(0, Math.min(1, wCert / totalWeight));
  const placementRate = Math.max(0, Math.min(1, wPlace / totalWeight));

  return {
    enrolment_rate: Math.round(enrolmentRate * 1000) / 1000,
    certification_rate: Math.round(certificationRate * 1000) / 1000,
    placement_rate: Math.round(placementRate * 1000) / 1000,
    overall_yield: Math.round(enrolmentRate * certificationRate * placementRate * 1000) / 1000,
  };
}

/**
 * Project future quarters using linear trend extrapolation
 * with pipeline stage modeling.
 */
function projectSupply(
  history: SupplyHistoryRow[],
  pipelineRates: PipelineRates,
  quarters: number,
): { projections: SupplyProjection[]; seatsTrend: { slope: number; r2: number } } {
  const validSeats = history.filter(
    (row) => row.sanctioned_seats !== null && row.sanctioned_seats >= 0,
  );

  if (validSeats.length === 0) {
    const currentYear = new Date().getFullYear();
    const projections: SupplyProjection[] = [];
    for (let q = 1; q <= quarters; q++) {
      const projectedYear = currentYear + Math.ceil(q / 4);
      const quarterNum = ((q - 1) % 4) + 1;
      projections.push({
        period: `${projectedYear}-Q${quarterNum}`,
        projected_seats: 0,
        projected_enrolled: 0,
        projected_certified: 0,
        projected_placed: 0,
        effective_quarterly_supply: 0,
        confidence: 'low',
      });
    }
    return { projections, seatsTrend: { slope: 0, r2: 0 } };
  }

  const years = validSeats.map((row) => row.year);
  const seats = validSeats.map((row) => row.sanctioned_seats as number);
  const seatsTrend = linearRegression(years, seats);

  // Project placement rate trend
  const validPlacement = history.filter(
    (row) => row.placement_rate !== null && row.placement_rate >= 0 && row.placement_rate <= 1,
  );
  const placementTrend = validPlacement.length >= 2
    ? linearRegression(
        validPlacement.map((r) => r.year),
        validPlacement.map((r) => r.placement_rate as number),
      )
    : null;

  const latestYear = Math.max(...years);
  const projections: SupplyProjection[] = [];

  for (let q = 1; q <= quarters; q++) {
    const projectedYear = latestYear + Math.ceil(q / 4);
    const quarterNum = ((q - 1) % 4) + 1;
    const period = `${projectedYear}-Q${quarterNum}`;

    // Project annual seats using linear trend, then divide by 4 for quarterly
    let annualSeats = Math.max(0, Math.round(
      seatsTrend.intercept + seatsTrend.slope * projectedYear,
    ));

    // Apply pipeline stages
    const enrolled = Math.round(annualSeats * pipelineRates.enrolment_rate);
    const certified = Math.round(enrolled * pipelineRates.certification_rate);

    // Use trended placement rate if available
    let effectivePlacementRate = pipelineRates.placement_rate;
    if (placementTrend && placementTrend.r2 > 0.3) {
      effectivePlacementRate = Math.max(0, Math.min(1,
        placementTrend.intercept + placementTrend.slope * projectedYear,
      ));
    }

    const placed = Math.round(certified * effectivePlacementRate);
    const quarterlySupply = Math.round(placed / 4); // Divide annual by 4 quarters

    // Confidence based on trend fit and data availability
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (seatsTrend.r2 > 0.7 && validSeats.length >= 3) confidence = 'high';
    else if (seatsTrend.r2 < 0.3 || validSeats.length < MIN_HISTORY_YEARS) confidence = 'low';

    projections.push({
      period,
      projected_seats: annualSeats,
      projected_enrolled: enrolled,
      projected_certified: certified,
      projected_placed: placed,
      effective_quarterly_supply: quarterlySupply,
      confidence,
    });
  }

  return { projections, seatsTrend };
}

/**
 * Run a supply forecast for a specific district-trade pair.
 */
export async function runSupplyForecast(
  db: SupplyDb,
  districtId: string,
  tradeId: string,
  quarters: number = 4,
): Promise<SupplyForecastResult> {
  if (quarters < 1 || quarters > MAX_PROJECTION_QUARTERS) {
    throw new Error(`Quarters must be between 1 and ${MAX_PROJECTION_QUARTERS}.`);
  }

  const [district, trade] = await Promise.all([
    db.get('SELECT id, name FROM districts WHERE id = ?', [districtId]),
    db.get('SELECT id, name FROM trades WHERE id = ?', [tradeId]),
  ]) as [{ id: string; name: string } | undefined, { id: string; name: string } | undefined];

  if (!district) throw new Error('District not found.');
  if (!trade) throw new Error('Trade not found.');

  const history = (await db.all(
    `SELECT year, sanctioned_seats, enrolled, certified, placed, placement_rate, centres_count
     FROM training_capacity
     WHERE district_id = ? AND trade_id = ?
     ORDER BY year ASC`,
    [districtId, tradeId],
  )) as SupplyHistoryRow[];

  const pipelineRates = computePipelineRates(history);
  const { projections, seatsTrend } = projectSupply(history, pipelineRates, quarters);

  // Determine trend directions
  const slopeThreshold = 5; // seats per year
  const seatsDirection: 'growing' | 'declining' | 'stable' =
    seatsTrend.slope > slopeThreshold ? 'growing' :
    seatsTrend.slope < -slopeThreshold ? 'declining' : 'stable';

  const validPlacement = history.filter(
    (r) => r.placement_rate !== null && r.placement_rate >= 0,
  );
  let placementDirection: 'improving' | 'declining' | 'stable' = 'stable';
  if (validPlacement.length >= 2) {
    const pTrend = linearRegression(
      validPlacement.map((r) => r.year),
      validPlacement.map((r) => r.placement_rate as number),
    );
    placementDirection = pTrend.slope > 0.01 ? 'improving' :
                         pTrend.slope < -0.01 ? 'declining' : 'stable';
  }

  return {
    district_id: districtId,
    district_name: district.name,
    trade_id: tradeId,
    trade_name: trade.name,
    methodology_version: SUPPLY_FORECAST_VERSION,
    history,
    pipeline_rates: pipelineRates,
    projections,
    trend: {
      seats_annual_growth: Math.round(seatsTrend.slope * 10) / 10,
      seats_trend_direction: seatsDirection,
      placement_rate_trend: placementDirection,
    },
    limitations: [
      'Supply projections use linear trend extrapolation on synthetic seed data.',
      'Pipeline conversion rates are weighted averages of historical rates.',
      'No external factors (policy changes, budget allocations) are modeled.',
      'Projections assume continuation of current training patterns.',
    ],
  };
}

/**
 * Batch supply forecast for all district-trade pairs in scope.
 */
export async function batchSupplyForecast(
  db: SupplyDb,
  filters: { state?: string; district_id?: string; sector?: string; trade_id?: string } = {},
  quarters: number = 4,
): Promise<SupplyForecastResult[]> {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.state) { conditions.push('d.state_id = ?'); params.push(filters.state); }
  if (filters.district_id) { conditions.push('d.id = ?'); params.push(filters.district_id); }
  if (filters.sector) { conditions.push('t.sector_id = ?'); params.push(filters.sector); }
  if (filters.trade_id) { conditions.push('t.id = ?'); params.push(filters.trade_id); }

  const pairs = await db.all(
    `SELECT d.id AS district_id, t.id AS trade_id
     FROM districts d
     CROSS JOIN trades t
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY d.id, t.id`,
    params,
  ) as Array<{ district_id: string; trade_id: string }>;

  const results: SupplyForecastResult[] = [];
  for (const pair of pairs) {
    try {
      results.push(await runSupplyForecast(db, pair.district_id, pair.trade_id, quarters));
    } catch {
      // Skip pairs that fail
    }
  }
  return results;
}
