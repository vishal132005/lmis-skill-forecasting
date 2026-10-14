/**
 * Recommendation Engine – REC-v1
 *
 * Generates actionable training recommendations based on gap analysis,
 * supply forecasts, alert data, and training capacity. Each recommendation
 * includes a rationale, priority level, and expected impact.
 */
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';

export const RECOMMENDATION_VERSION = 'REC-v1';

type RecDb = Database<sqlite3.Database, sqlite3.Statement>;

export type RecommendationType =
  | 'INCREASE_SEATS'
  | 'REDUCE_SEATS'
  | 'NEW_COURSE'
  | 'PRIORITIZE_CENTRE'
  | 'REVISE_CURRICULUM'
  | 'MONITOR';

export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Recommendation {
  id: string;
  district_id: string;
  district_name: string;
  state_id: string;
  trade_id: string;
  trade_name: string;
  sector_id: string;
  sector_name: string;
  type: RecommendationType;
  priority: Priority;
  title: string;
  description: string;
  rationale: string;
  expected_impact: string;
  metrics: {
    current_seats: number | null;
    recommended_seats: number | null;
    seat_change: number | null;
    seat_change_pct: number | null;
    forecast_demand: number | null;
    effective_supply: number | null;
    gap: number | null;
    gap_ratio: number | null;
    gap_status: string | null;
    active_alerts: number;
  };
}

export interface RecommendationResponse {
  data: Recommendation[];
  methodology: {
    version: string;
    rules: string[];
    limitations: string[];
  };
  meta: {
    total: number;
    by_priority: Record<Priority, number>;
    by_type: Record<RecommendationType, number>;
  };
}

interface GapRow {
  district_id: string;
  district_name: string;
  state_id: string;
  trade_id: string;
  trade_name: string;
  sector_id: string;
  sector_name: string;
  period: string;
  forecast_demand: number | null;
  effective_supply: number | null;
  gap: number | null;
  gap_ratio: number | null;
  status: string;
}

interface CapacityRow {
  district_id: string;
  trade_id: string;
  year: number;
  sanctioned_seats: number | null;
  enrolled: number | null;
  certified: number | null;
  placed: number | null;
  placement_rate: number | null;
  centres_count: number | null;
}

interface AlertRow {
  district_id: string;
  trade_id: string;
  type: string;
  severity: string;
  count: number;
}

function makeId(districtId: string, tradeId: string, type: RecommendationType): string {
  return `${districtId}|${tradeId}|${type}`;
}

function clampSeats(seats: number): number {
  return Math.max(0, Math.round(seats));
}

/**
 * Generate recommendations based on current gap results, training capacity,
 * and alert data.
 */
export async function generateRecommendations(
  db: RecDb,
  filters: {
    state?: string;
    district_id?: string;
    sector?: string;
    trade_id?: string;
  } = {},
): Promise<RecommendationResponse> {
  // Build filter conditions
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.state) { conditions.push('d.state_id = ?'); params.push(filters.state); }
  if (filters.district_id) { conditions.push('g.district_id = ?'); params.push(filters.district_id); }
  if (filters.sector) { conditions.push('t.sector_id = ?'); params.push(filters.sector); }
  if (filters.trade_id) { conditions.push('g.trade_id = ?'); params.push(filters.trade_id); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get latest gap results per district-trade (use latest period)
  const gapRows = (await db.all(
    `SELECT g.district_id, d.name AS district_name, d.state_id,
            g.trade_id, t.name AS trade_name, t.sector_id, s.name AS sector_name,
            g.period, g.forecast_demand, g.effective_supply,
            g.gap, g.gap_ratio, g.status
     FROM gap_results g
     JOIN districts d ON d.id = g.district_id
     JOIN trades t ON t.id = g.trade_id
     JOIN sectors s ON s.id = t.sector_id
     ${whereClause}
     AND g.status != 'INSUFFICIENT_DATA'
     ORDER BY g.district_id, g.trade_id, g.period DESC`,
    params,
  )) as GapRow[];

  // Deduplicate: keep latest period per district-trade
  const latestGaps = new Map<string, GapRow>();
  for (const row of gapRows) {
    const key = `${row.district_id}|${row.trade_id}`;
    if (!latestGaps.has(key)) latestGaps.set(key, row);
  }

  // Get training capacity for matching pairs
  const capacityRows = (await db.all(
    `SELECT tc.district_id, tc.trade_id, tc.year,
            SUM(tc.sanctioned_seats) AS sanctioned_seats,
            SUM(tc.enrolled) AS enrolled,
            SUM(tc.certified) AS certified,
            SUM(tc.placed) AS placed,
            AVG(tc.placement_rate) AS placement_rate,
            SUM(tc.centres_count) AS centres_count
     FROM training_capacity tc
     JOIN districts d ON d.id = tc.district_id
     JOIN trades t ON t.id = tc.trade_id
     ${whereClause.replace(/g\./g, 'tc.').replace(/s\./g, 'sec.')}
     GROUP BY tc.district_id, tc.trade_id, tc.year
     ORDER BY tc.year DESC`,
    params,
  )) as CapacityRow[];

  const latestCapacity = new Map<string, CapacityRow>();
  for (const row of capacityRows) {
    const key = `${row.district_id}|${row.trade_id}`;
    if (!latestCapacity.has(key)) latestCapacity.set(key, row);
  }

  // Get alert counts per district-trade
  const alertRows = (await db.all(
    `SELECT a.district_id, a.trade_id, a.type, a.severity, COUNT(*) as count
     FROM alerts a
     WHERE a.status = 'ACTIVE'
     GROUP BY a.district_id, a.trade_id, a.type, a.severity`,
  )) as AlertRow[];

  const alertCounts = new Map<string, number>();
  for (const row of alertRows) {
    const key = `${row.district_id}|${row.trade_id}`;
    alertCounts.set(key, (alertCounts.get(key) ?? 0) + row.count);
  }

  // Generate recommendations
  const recommendations: Recommendation[] = [];

  for (const [pairKey, gap] of latestGaps) {
    const capacity = latestCapacity.get(pairKey);
    const alerts = alertCounts.get(pairKey) ?? 0;
    const currentSeats = capacity?.sanctioned_seats ?? null;
    const gapRatio = gap.gap_ratio;
    const gapValue = gap.gap;

    // Rule 1: ACUTE_SHORTAGE → INCREASE_SEATS (CRITICAL)
    if (gap.status === 'ACUTE_SHORTAGE' && gapRatio !== null && gapRatio > 0.3) {
      const seatIncrease = currentSeats !== null
        ? clampSeats(Math.min(currentSeats * 0.5, Math.abs(gapValue ?? 0) * 0.6))
        : null;
      const recSeats = currentSeats !== null && seatIncrease !== null
        ? currentSeats + seatIncrease : null;

      recommendations.push({
        id: makeId(gap.district_id, gap.trade_id, 'INCREASE_SEATS'),
        district_id: gap.district_id,
        district_name: gap.district_name,
        state_id: gap.state_id,
        trade_id: gap.trade_id,
        trade_name: gap.trade_name,
        sector_id: gap.sector_id,
        sector_name: gap.sector_name,
        type: 'INCREASE_SEATS',
        priority: 'CRITICAL',
        title: `Urgently expand ${gap.trade_name} training in ${gap.district_name}`,
        description: `Acute labour shortage projected for ${gap.trade_name} in ${gap.district_name}. Demand exceeds supply by ${gapRatio !== null ? (gapRatio * 100).toFixed(1) : '—'}%. Immediate capacity expansion is recommended.`,
        rationale: `Gap analysis shows ${gap.status} with gap ratio ${gapRatio?.toFixed(3) ?? 'N/A'}. Forecasted demand of ${gap.forecast_demand?.toFixed(0) ?? 'N/A'} significantly exceeds effective supply of ${gap.effective_supply?.toFixed(0) ?? 'N/A'} workers per quarter.`,
        expected_impact: seatIncrease !== null
          ? `Adding ${seatIncrease} seats (from ${currentSeats} to ${recSeats}) could reduce the quarterly gap by approximately ${Math.round(seatIncrease * (capacity?.placement_rate ?? 0.5) / 4)} effective workers.`
          : 'Impact assessment requires training capacity data.',
        metrics: {
          current_seats: currentSeats,
          recommended_seats: recSeats,
          seat_change: seatIncrease,
          seat_change_pct: currentSeats && seatIncrease ? Math.round((seatIncrease / currentSeats) * 100) : null,
          forecast_demand: gap.forecast_demand,
          effective_supply: gap.effective_supply,
          gap: gapValue,
          gap_ratio: gapRatio,
          gap_status: gap.status,
          active_alerts: alerts,
        },
      });
    }

    // Rule 2: EMERGING_SHORTAGE → INCREASE_SEATS (HIGH)
    else if (gap.status === 'EMERGING_SHORTAGE' && gapRatio !== null && gapRatio > 0.1) {
      const seatIncrease = currentSeats !== null
        ? clampSeats(Math.min(currentSeats * 0.25, Math.abs(gapValue ?? 0) * 0.4))
        : null;
      const recSeats = currentSeats !== null && seatIncrease !== null
        ? currentSeats + seatIncrease : null;

      recommendations.push({
        id: makeId(gap.district_id, gap.trade_id, 'INCREASE_SEATS'),
        district_id: gap.district_id,
        district_name: gap.district_name,
        state_id: gap.state_id,
        trade_id: gap.trade_id,
        trade_name: gap.trade_name,
        sector_id: gap.sector_id,
        sector_name: gap.sector_name,
        type: 'INCREASE_SEATS',
        priority: 'HIGH',
        title: `Increase ${gap.trade_name} training capacity in ${gap.district_name}`,
        description: `Emerging shortage detected for ${gap.trade_name} in ${gap.district_name}. Demand is growing faster than available supply. Consider expanding intake targets.`,
        rationale: `Gap ratio of ${gapRatio.toFixed(3)} indicates demand growth outpacing supply. If unchecked, this may escalate to an acute shortage.`,
        expected_impact: seatIncrease !== null
          ? `Increasing by ${seatIncrease} seats could partially address the projected gap of ${gapValue?.toFixed(0) ?? '—'} workers.`
          : 'Capacity data needed for impact estimate.',
        metrics: {
          current_seats: currentSeats,
          recommended_seats: recSeats,
          seat_change: seatIncrease,
          seat_change_pct: currentSeats && seatIncrease ? Math.round((seatIncrease / currentSeats) * 100) : null,
          forecast_demand: gap.forecast_demand,
          effective_supply: gap.effective_supply,
          gap: gapValue,
          gap_ratio: gapRatio,
          gap_status: gap.status,
          active_alerts: alerts,
        },
      });
    }

    // Rule 3: OVERSUPPLY → REDUCE_SEATS
    else if (gap.status === 'OVERSUPPLY' && gapRatio !== null && gapRatio < -0.3) {
      const seatReduction = currentSeats !== null
        ? clampSeats(Math.min(currentSeats * 0.3, Math.abs(gapValue ?? 0) * 0.3))
        : null;
      const recSeats = currentSeats !== null && seatReduction !== null
        ? Math.max(0, currentSeats - seatReduction) : null;

      recommendations.push({
        id: makeId(gap.district_id, gap.trade_id, 'REDUCE_SEATS'),
        district_id: gap.district_id,
        district_name: gap.district_name,
        state_id: gap.state_id,
        trade_id: gap.trade_id,
        trade_name: gap.trade_name,
        sector_id: gap.sector_id,
        sector_name: gap.sector_name,
        type: 'REDUCE_SEATS',
        priority: 'MEDIUM',
        title: `Reduce ${gap.trade_name} intake in ${gap.district_name}`,
        description: `Oversupply detected for ${gap.trade_name} in ${gap.district_name}. Supply exceeds demand by ${Math.abs(gapRatio * 100).toFixed(1)}%. Consider redirecting training capacity to other trades.`,
        rationale: `Supply significantly exceeds forecasted demand, leading to potentially unplaced trainees and resource inefficiency.`,
        expected_impact: seatReduction !== null
          ? `Reducing by ${seatReduction} seats (to ${recSeats}) could redirect resources to higher-demand trades.`
          : 'Capacity data needed for impact estimate.',
        metrics: {
          current_seats: currentSeats,
          recommended_seats: recSeats,
          seat_change: seatReduction !== null ? -seatReduction : null,
          seat_change_pct: currentSeats && seatReduction ? Math.round((-seatReduction / currentSeats) * 100) : null,
          forecast_demand: gap.forecast_demand,
          effective_supply: gap.effective_supply,
          gap: gapValue,
          gap_ratio: gapRatio,
          gap_status: gap.status,
          active_alerts: alerts,
        },
      });
    }

    // Rule 4: APPROACHING_SATURATION → MONITOR
    else if (gap.status === 'APPROACHING_SATURATION') {
      recommendations.push({
        id: makeId(gap.district_id, gap.trade_id, 'MONITOR'),
        district_id: gap.district_id,
        district_name: gap.district_name,
        state_id: gap.state_id,
        trade_id: gap.trade_id,
        trade_name: gap.trade_name,
        sector_id: gap.sector_id,
        sector_name: gap.sector_name,
        type: 'MONITOR',
        priority: 'LOW',
        title: `Monitor ${gap.trade_name} capacity in ${gap.district_name}`,
        description: `Supply is approaching saturation for ${gap.trade_name} in ${gap.district_name}. Keep current intake stable and monitor quarterly.`,
        rationale: `Gap ratio of ${gapRatio?.toFixed(3) ?? 'N/A'} suggests supply is catching up with demand. Moderate intake to avoid oversupply.`,
        expected_impact: 'Maintaining current levels prevents potential oversupply while preserving training infrastructure.',
        metrics: {
          current_seats: currentSeats,
          recommended_seats: currentSeats,
          seat_change: 0,
          seat_change_pct: 0,
          forecast_demand: gap.forecast_demand,
          effective_supply: gap.effective_supply,
          gap: gapValue,
          gap_ratio: gapRatio,
          gap_status: gap.status,
          active_alerts: alerts,
        },
      });
    }

    // Rule 5: Low placement rate → REVISE_CURRICULUM
    if (capacity && capacity.placement_rate !== null && capacity.placement_rate < 0.4 && currentSeats !== null && currentSeats > 0) {
      recommendations.push({
        id: makeId(gap.district_id, gap.trade_id, 'REVISE_CURRICULUM'),
        district_id: gap.district_id,
        district_name: gap.district_name,
        state_id: gap.state_id,
        trade_id: gap.trade_id,
        trade_name: gap.trade_name,
        sector_id: gap.sector_id,
        sector_name: gap.sector_name,
        type: 'REVISE_CURRICULUM',
        priority: 'HIGH',
        title: `Review ${gap.trade_name} curriculum in ${gap.district_name}`,
        description: `Placement rate for ${gap.trade_name} in ${gap.district_name} is ${(capacity.placement_rate * 100).toFixed(1)}%, well below expectations. Curriculum revision or industry partnership may improve outcomes.`,
        rationale: `A placement rate of ${(capacity.placement_rate * 100).toFixed(1)}% means ${Math.round((1 - capacity.placement_rate) * (currentSeats || 0))} trained candidates per batch may not find relevant employment.`,
        expected_impact: `Improving placement rate to 60% would increase effective supply by approximately ${Math.round(currentSeats * (0.6 - capacity.placement_rate) / 4)} workers per quarter.`,
        metrics: {
          current_seats: currentSeats,
          recommended_seats: currentSeats,
          seat_change: 0,
          seat_change_pct: 0,
          forecast_demand: gap.forecast_demand,
          effective_supply: gap.effective_supply,
          gap: gapValue,
          gap_ratio: gapRatio,
          gap_status: gap.status,
          active_alerts: alerts,
        },
      });
    }
  }

  // Sort: CRITICAL first, then HIGH, MEDIUM, LOW
  const priorityOrder: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Build response metadata
  const byPriority: Record<Priority, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const byType: Record<RecommendationType, number> = {
    INCREASE_SEATS: 0, REDUCE_SEATS: 0, NEW_COURSE: 0,
    PRIORITIZE_CENTRE: 0, REVISE_CURRICULUM: 0, MONITOR: 0,
  };
  for (const rec of recommendations) {
    byPriority[rec.priority] += 1;
    byType[rec.type] += 1;
  }

  return {
    data: recommendations,
    methodology: {
      version: RECOMMENDATION_VERSION,
      rules: [
        'ACUTE_SHORTAGE (gap_ratio > 0.30) → INCREASE_SEATS at CRITICAL priority (up to +50% of current seats)',
        'EMERGING_SHORTAGE (gap_ratio 0.10–0.30) → INCREASE_SEATS at HIGH priority (up to +25% of current seats)',
        'OVERSUPPLY (gap_ratio < -0.30) → REDUCE_SEATS at MEDIUM priority (up to -30% of current seats)',
        'APPROACHING_SATURATION → MONITOR at LOW priority',
        'Placement rate below 40% → REVISE_CURRICULUM at HIGH priority',
      ],
      limitations: [
        'Recommendations are derived from synthetic demonstration data.',
        'Training cost, course duration, and centre capacity are not yet factored.',
        'No live labour market validation is applied.',
      ],
    },
    meta: {
      total: recommendations.length,
      by_priority: byPriority,
      by_type: byType,
    },
  };
}
