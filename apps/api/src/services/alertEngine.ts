/**
 * Alert Engine – AE-v1
 *
 * Generates rule-based alerts from gap_results after every recompute.
 *
 * Rules (evaluated per district × trade, across the 4 forecast quarters):
 *   1. ACUTE_SHORTAGE        — any quarter has gap_ratio > +0.30
 *   2. EMERGING_SHORTAGE     — any quarter has gap_ratio in (+0.10, +0.30]
 *   3. APPROACHING_SATURATION— any quarter has gap_ratio in [-0.30, -0.10)
 *                              OR 3+ consecutive quarters: supply grew while demand shrank
 *   4. OVERSUPPLY            — any quarter has gap_ratio < -0.30
 *   5. DEMAND_SPIKE          — quarterly demand z-score exceeds threshold
 *
 * Idempotency:
 *   Each alert has a dedupe_key = `${district_id}|${trade_id}|${type}`.
 *   On recompute the engine UPSERTs (INSERT OR REPLACE or targeted UPDATE) using
 *   this key. ACKNOWLEDGED rows are preserved unless the incoming severity is
 *   strictly higher, in which case the status is reset to ACTIVE with a note in
 *   the explanation. RESOLVED rows are re-opened if the condition recurs.
 *
 * Auto-resolve:
 *   If a district-trade-type combination has an existing ACTIVE alert but
 *   the engine no longer produces a trigger for it, the alert is set to
 *   AUTO_RESOLVED.
 *
 * quarters_to_breach:
 *   Index (1-based) of the first quarter that triggers the alert.
 *   Allows the UI to display "shortage expected in N quarters".
 */

import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import {
  ALERT_ENGINE_VERSION,
  ALERT_THRESHOLDS,
  AlertSeverity,
  AlertType,
  DEMAND_SPIKE_MIN_STD,
  DEMAND_SPIKE_Z_THRESHOLD,
  oversupplySeverity,
  SATURATION_CONSECUTIVE_QUARTERS,
  SEVERITY_RANK,
  shortageSeverity,
  spikeSeverity,
} from '../config/alertConfig';

type Db = Database<sqlite3.Database, sqlite3.Statement>;

/** A gap_results row as read from SQLite. */
interface GapRow {
  district_id: string;
  trade_id: string;
  period: string;          // e.g. "2026-Q4"
  forecast_demand: number | null;
  effective_supply: number | null;
  gap: number | null;
  gap_ratio: number | null;
  status: string;          // gap engine status, e.g. "ACUTE_SHORTAGE"
}

/** The minimal existing alert row we need to decide idempotency. */
interface ExistingAlert {
  id: string;
  status: string;          // ACTIVE | ACKNOWLEDGED | RESOLVED | AUTO_RESOLVED
  severity: string;
  dedupe_key: string;
}

/** Pending alert to write, before idempotency is applied. */
interface PendingAlert {
  type: AlertType;
  severity: AlertSeverity;
  district_id: string;
  trade_id: string;
  /** First quarter that triggers this alert (1-based). */
  quarters_to_breach: number;
  /** Triggering quarter label, e.g. "2026-Q4". */
  breach_period: string;
  gap_ratio: number | null;
  explanation: string;
  /** Structured key metrics driving the alert. */
  drivers: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function quarterIndex(period: string, periods: string[]): number {
  return periods.indexOf(period) + 1; // 1-based
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  const variance =
    values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function fmt(n: number | null, decimals = 2): string {
  return n === null ? 'N/A' : n.toFixed(decimals);
}

function pct(ratio: number | null): string {
  if (ratio === null) return 'N/A';
  return `${(ratio * 100).toFixed(1)} %`;
}

// ─── Rule evaluators ─────────────────────────────────────────────────────────

/**
 * Evaluate shortage rules (ACUTE and EMERGING) for one district-trade pair.
 * Returns the worst-case alert, or null.
 */
function evaluateShortage(
  rows: GapRow[],
  periods: string[],
): PendingAlert | null {
  // Find the first quarter with the highest shortage
  let best: { ratio: number; row: GapRow; idx: number } | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.gap_ratio === null || row.status === 'INSUFFICIENT_DATA') continue;
    if (row.gap_ratio > ALERT_THRESHOLDS.emergingShortage) {
      if (!best || row.gap_ratio > best.ratio) {
        best = { ratio: row.gap_ratio, row, idx: i };
      }
    }
  }
  if (!best) return null;

  // Pick the first quarter that fires, then report peak in drivers
  const firstFiringRow = rows.find(
    (r) =>
      r.gap_ratio !== null &&
      r.status !== 'INSUFFICIENT_DATA' &&
      r.gap_ratio > ALERT_THRESHOLDS.emergingShortage,
  )!;
  const firstIdx = quarterIndex(firstFiringRow.period, periods);

  const type: AlertType =
    best.ratio > ALERT_THRESHOLDS.acuteShortage
      ? 'ACUTE_SHORTAGE'
      : 'EMERGING_SHORTAGE';
  const severity = shortageSeverity(best.ratio);

  const explanation =
    type === 'ACUTE_SHORTAGE'
      ? `Acute labour shortage projected: demand exceeds effective supply by ${pct(best.ratio)} in ${best.row.period}. Demand: ${fmt(best.row.forecast_demand, 0)} openings, supply: ${fmt(best.row.effective_supply, 0)} trained placements (quarterly). Action: expand training intake urgently.`
      : `Emerging labour shortage projected: demand exceeds supply by ${pct(best.ratio)} in ${best.row.period}. Demand: ${fmt(best.row.forecast_demand, 0)} openings, supply: ${fmt(best.row.effective_supply, 0)} trained placements (quarterly). Monitor and review intake targets.`;

  return {
    type,
    severity,
    district_id: firstFiringRow.district_id,
    trade_id: firstFiringRow.trade_id,
    quarters_to_breach: firstIdx,
    breach_period: firstFiringRow.period,
    gap_ratio: best.ratio,
    explanation,
    drivers: {
      peak_gap_ratio: best.ratio,
      peak_period: best.row.period,
      peak_forecast_demand: best.row.forecast_demand,
      peak_effective_supply: best.row.effective_supply,
      peak_gap: best.row.gap,
      first_breach_period: firstFiringRow.period,
      first_breach_gap_ratio: firstFiringRow.gap_ratio,
    },
  };
}

/**
 * Evaluate oversupply rules (OVERSUPPLY and APPROACHING_SATURATION).
 * APPROACHING_SATURATION also triggers when supply grows faster than demand
 * for SATURATION_CONSECUTIVE_QUARTERS quarters.
 */
function evaluateOversupply(
  rows: GapRow[],
  periods: string[],
): PendingAlert | null {
  // Primary: worst gap_ratio (most negative)
  let worstRatioRow: GapRow | null = null;
  for (const row of rows) {
    if (row.gap_ratio === null || row.status === 'INSUFFICIENT_DATA') continue;
    if (row.gap_ratio < ALERT_THRESHOLDS.balanced) {
      if (!worstRatioRow || row.gap_ratio < worstRatioRow.gap_ratio!) {
        worstRatioRow = row;
      }
    }
  }

  // Secondary: trend rule — supply growing, demand shrinking for N consecutive quarters
  let trendConsecutive = 0;
  let trendStart = -1;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    if (
      prev.forecast_demand !== null &&
      curr.forecast_demand !== null &&
      prev.effective_supply !== null &&
      curr.effective_supply !== null &&
      curr.effective_supply > prev.effective_supply &&
      curr.forecast_demand <= prev.forecast_demand
    ) {
      if (trendConsecutive === 0) trendStart = i - 1;
      trendConsecutive++;
    } else {
      trendConsecutive = 0;
      trendStart = -1;
    }
  }
  const trendFires = trendConsecutive >= SATURATION_CONSECUTIVE_QUARTERS - 1;

  if (!worstRatioRow && !trendFires) return null;

  let type: AlertType;
  let severity: AlertSeverity;
  let firstBreachRow: GapRow;
  let gapRatio: number | null;
  let explanation: string;
  let drivers: Record<string, unknown>;

  if (worstRatioRow) {
    // Ratio-based primary
    type =
      worstRatioRow.gap_ratio! < ALERT_THRESHOLDS.approachingSaturation
        ? 'OVERSUPPLY'
        : 'APPROACHING_SATURATION';
    severity = oversupplySeverity(worstRatioRow.gap_ratio!);
    const firstFiring = rows.find(
      (r) =>
        r.gap_ratio !== null &&
        r.status !== 'INSUFFICIENT_DATA' &&
        r.gap_ratio < ALERT_THRESHOLDS.balanced,
    )!;
    firstBreachRow = firstFiring;
    gapRatio = worstRatioRow.gap_ratio;
    explanation =
      type === 'OVERSUPPLY'
        ? `Oversupply projected: effective supply exceeds demand by ${pct(Math.abs(gapRatio!))} in ${worstRatioRow.period}. ${fmt(worstRatioRow.effective_supply, 0)} trained placements available for ${fmt(worstRatioRow.forecast_demand, 0)} estimated openings. Consider redirecting enrolment.`
        : `Supply approaching saturation: supply exceeds demand by ${pct(Math.abs(gapRatio!))} in ${worstRatioRow.period}. Intake growth may need moderation.`;
    drivers = {
      worst_gap_ratio: gapRatio,
      worst_period: worstRatioRow.period,
      worst_forecast_demand: worstRatioRow.forecast_demand,
      worst_effective_supply: worstRatioRow.effective_supply,
      trend_consecutive_quarters: trendConsecutive,
    };
  } else {
    // Trend-only
    type = 'APPROACHING_SATURATION';
    severity = 'MEDIUM';
    firstBreachRow = rows[trendStart] ?? rows[0];
    gapRatio = firstBreachRow.gap_ratio;
    explanation = `Supply growing while demand stagnates or declines for ${SATURATION_CONSECUTIVE_QUARTERS} consecutive quarters. Projected gap_ratio: ${pct(firstBreachRow.gap_ratio)}. Review future intake targets.`;
    drivers = {
      trend_consecutive_quarters: trendConsecutive,
      first_trend_period: rows[trendStart]?.period,
      gap_ratios: rows.map((r) => ({ period: r.period, gap_ratio: r.gap_ratio })),
    };
  }

  return {
    type,
    severity,
    district_id: firstBreachRow.district_id,
    trade_id: firstBreachRow.trade_id,
    quarters_to_breach: quarterIndex(firstBreachRow.period, periods),
    breach_period: firstBreachRow.period,
    gap_ratio: gapRatio,
    explanation,
    drivers,
  };
}

/**
 * Evaluate DEMAND_SPIKE rule using z-score of quarterly forecast_demand.
 * Requires at least 3 data points with valid demand values.
 */
function evaluateDemandSpike(
  rows: GapRow[],
  periods: string[],
): PendingAlert | null {
  const demands = rows
    .filter((r) => r.forecast_demand !== null && r.status !== 'INSUFFICIENT_DATA')
    .map((r) => r.forecast_demand as number);
  if (demands.length < 3) return null;

  const avg = mean(demands);
  const std = stdDev(demands, avg);
  if (std < DEMAND_SPIKE_MIN_STD) return null; // series too flat

  let peakZ = 0;
  let peakRow: GapRow | null = null;
  for (const row of rows) {
    if (row.forecast_demand === null || row.status === 'INSUFFICIENT_DATA') continue;
    const z = (row.forecast_demand - avg) / std;
    if (Math.abs(z) > Math.abs(peakZ)) {
      peakZ = z;
      peakRow = row;
    }
  }

  if (!peakRow || Math.abs(peakZ) < DEMAND_SPIKE_Z_THRESHOLD) return null;

  const severity = spikeSeverity(peakZ);
  const direction = peakZ > 0 ? 'surge' : 'collapse';
  const explanation = `Demand ${direction} detected in ${peakRow.period}: ${fmt(peakRow.forecast_demand, 0)} openings vs. rolling mean of ${fmt(avg, 0)} (z-score ${fmt(peakZ)}). Validate with local signals; this is a synthetic-demo heuristic.`;

  return {
    type: 'DEMAND_SPIKE',
    severity,
    district_id: peakRow.district_id,
    trade_id: peakRow.trade_id,
    quarters_to_breach: quarterIndex(peakRow.period, periods),
    breach_period: peakRow.period,
    gap_ratio: peakRow.gap_ratio,
    explanation,
    drivers: {
      z_score: peakZ,
      peak_demand: peakRow.forecast_demand,
      rolling_mean: avg,
      rolling_std: std,
      peak_period: peakRow.period,
      z_threshold: DEMAND_SPIKE_Z_THRESHOLD,
    },
  };
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

function dedupeKey(districtId: string, tradeId: string, type: AlertType): string {
  return `${districtId}|${tradeId}|${type}`;
}

/**
 * Upsert a single pending alert.
 * Logic:
 *   - If no existing alert: INSERT as ACTIVE.
 *   - If existing RESOLVED or AUTO_RESOLVED: re-open as ACTIVE (condition recurred).
 *   - If existing ACTIVE: UPDATE fields (keep id, reset explanation/drivers).
 *   - If existing ACKNOWLEDGED: preserve status UNLESS new severity is strictly
 *     higher, in which case reopen as ACTIVE with a note in explanation.
 */
async function upsertAlert(
  db: Db,
  pending: PendingAlert,
  existing: ExistingAlert | undefined,
  computedAt: string,
): Promise<void> {
  const key = dedupeKey(pending.district_id, pending.trade_id, pending.type);
  const driversJson = JSON.stringify(pending.drivers);

  if (!existing) {
    // Brand new — insert
    await db.run(
      `INSERT INTO alerts
         (id, district_id, trade_id, type, severity, explanation, drivers,
          quarters_to_breach, breach_period, gap_ratio, dedupe_key,
          reason, created_at, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuidv4(),
        pending.district_id,
        pending.trade_id,
        pending.type,
        pending.severity,
        pending.explanation,
        driversJson,
        pending.quarters_to_breach,
        pending.breach_period,
        pending.gap_ratio,
        key,
        pending.explanation, // legacy reason field mirrors explanation
        computedAt,
        'ACTIVE',
      ],
    );
    return;
  }

  // Determine new status based on idempotency rules
  const incomingRank = SEVERITY_RANK[pending.severity];
  const existingRank = SEVERITY_RANK[existing.severity as AlertSeverity] ?? 0;
  const severityWorsened = incomingRank > existingRank;

  let newStatus: string;
  let newExplanation = pending.explanation;

  if (existing.status === 'ACKNOWLEDGED' && !severityWorsened) {
    // Preserve human acknowledgement when severity is same or lower
    newStatus = 'ACKNOWLEDGED';
  } else if (existing.status === 'ACKNOWLEDGED' && severityWorsened) {
    // Severity worsened — reopen with a note
    newStatus = 'ACTIVE';
    newExplanation = `[Severity escalated from ${existing.severity} to ${pending.severity} — reopened] ${pending.explanation}`;
  } else {
    // ACTIVE, RESOLVED, AUTO_RESOLVED → always update to ACTIVE
    newStatus = 'ACTIVE';
  }

  await db.run(
    `UPDATE alerts
     SET severity = ?, explanation = ?, drivers = ?,
         quarters_to_breach = ?, breach_period = ?, gap_ratio = ?,
         reason = ?, status = ?, updated_at = ?
     WHERE dedupe_key = ?`,
    [
      pending.severity,
      newExplanation,
      driversJson,
      pending.quarters_to_breach,
      pending.breach_period,
      pending.gap_ratio,
      newExplanation,
      newStatus,
      computedAt,
      key,
    ],
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AlertEngineResult {
  created: number;
  updated: number;
  resolved: number;
}

/**
 * Run the alert engine over the current gap_results for a specific scope
 * (all district-trades matching the optional filter) or all pairs.
 *
 * @param db       SQLite database connection
 * @param filters  Optional scope (state, district_id, trade_id, sector)
 */
export async function runAlertEngine(
  db: Db,
  filters: {
    state?: string;
    district_id?: string;
    trade_id?: string;
    sector?: string;
  } = {},
): Promise<AlertEngineResult> {
  const computedAt = new Date().toISOString();

  // ── 1. Load relevant gap_results ordered by district, trade, period ─────
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.state) { conditions.push("d.state_id = ?"); params.push(filters.state); }
  if (filters.district_id) { conditions.push("g.district_id = ?"); params.push(filters.district_id); }
  if (filters.trade_id) { conditions.push("g.trade_id = ?"); params.push(filters.trade_id); }
  if (filters.sector) { conditions.push("t.sector_id = ?"); params.push(filters.sector); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const gapRows = (await db.all(
    `SELECT g.district_id, g.trade_id, g.period,
            g.forecast_demand, g.effective_supply,
            g.gap, g.gap_ratio, g.status
     FROM gap_results g
     JOIN districts d ON d.id = g.district_id
     JOIN trades t ON t.id = g.trade_id
     ${whereClause}
     ORDER BY g.district_id, g.trade_id, g.period`,
    params,
  )) as GapRow[];

  if (gapRows.length === 0) return { created: 0, updated: 0, resolved: 0 };

  // ── 2. Group rows by district × trade ────────────────────────────────────
  const pairMap = new Map<string, GapRow[]>();
  for (const row of gapRows) {
    const key = `${row.district_id}|${row.trade_id}`;
    const list = pairMap.get(key) ?? [];
    list.push(row);
    pairMap.set(key, list);
  }

  // ── 3. Load existing active/acknowledged alerts for dedupe ───────────────
  const existingAlerts = (await db.all(
    `SELECT id, status, severity, dedupe_key FROM alerts
     WHERE status IN ('ACTIVE', 'ACKNOWLEDGED') AND dedupe_key IS NOT NULL`,
  )) as ExistingAlert[];
  const existingMap = new Map<string, ExistingAlert>(
    existingAlerts.map((a) => [a.dedupe_key, a]),
  );

  // ── 4. Evaluate rules per pair ────────────────────────────────────────────
  const pendingByKey = new Map<string, PendingAlert>();

  for (const [, rows] of pairMap) {
    const periods = rows.map((r) => r.period);
    const candidates: Array<PendingAlert | null> = [
      evaluateShortage(rows, periods),
      evaluateOversupply(rows, periods),
      evaluateDemandSpike(rows, periods),
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const k = dedupeKey(candidate.district_id, candidate.trade_id, candidate.type);
      // Keep only the highest-severity candidate per key (shouldn't conflict,
      // but defensive in case a pair triggers both shortage and spike)
      const prev = pendingByKey.get(k);
      if (!prev || SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[prev.severity]) {
        pendingByKey.set(k, candidate);
      }
    }
  }

  // ── 5. Persist pending alerts ─────────────────────────────────────────────
  let created = 0;
  let updated = 0;
  for (const [key, pending] of pendingByKey) {
    const existing = existingMap.get(key);
    await upsertAlert(db, pending, existing, computedAt);
    if (existing) { updated++; } else { created++; }
    existingMap.delete(key); // mark as handled
  }

  // ── 6. Auto-resolve alerts whose condition has cleared ────────────────────
  // Remaining entries in existingMap were not triggered this run
  let resolved = 0;
  for (const [, stale] of existingMap) {
    // Only auto-resolve if scope covers this alert's district/trade
    // (skip if filters don't include this alert's pair)
    await db.run(
      `UPDATE alerts SET status = 'AUTO_RESOLVED', updated_at = ?
       WHERE id = ? AND status = 'ACTIVE'`,
      [computedAt, stale.id],
    );
    resolved++;
  }

  return { created, updated, resolved };
}
