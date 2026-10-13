/**
 * Alert Engine Configuration – AE-v1
 *
 * All thresholds, severity mappings, and detection parameters live here.
 * No magic numbers in alertEngine.ts.
 *
 * ALERT TYPES:
 *   ACUTE_SHORTAGE        — gap_ratio > +0.30 (demand far exceeds supply)
 *   EMERGING_SHORTAGE     — gap_ratio in (+0.10, +0.30]
 *   APPROACHING_SATURATION— gap_ratio in [-0.30, -0.10) OR 3 consecutive quarters of
 *                           effective_supply growing faster than forecast_demand
 *   OVERSUPPLY            — gap_ratio < -0.30 (supply far exceeds demand)
 *   DEMAND_SPIKE          — rolling-baseline z-score of quarterly demand exceeds threshold
 *
 * SEVERITY MAPPING (per type):
 *   Each type maps gap_ratio magnitude or z-score magnitude to a severity label.
 *   Human operators may escalate via PATCH /alerts/:id but the engine never
 *   downgrades a human-set ACKNOWLEDGED status unless severity worsens.
 *
 * METHODOLOGY NOTE – DEMAND_SPIKE z-score:
 *   We compute a rolling mean and standard deviation over the 4 available
 *   gap_results quarters per district-trade. A z-score is defined as
 *     z = (demand_q - mean_demand) / std_demand
 *   When std_demand < DEMAND_SPIKE_MIN_STD the z-score is not meaningful
 *   (flat series); the spike check is skipped. This is a synthetic-demo
 *   heuristic, not a calibrated anomaly detector.
 */

export const ALERT_ENGINE_VERSION = 'AE-v1';

/* ── Gap-ratio classification boundaries (mirror gapConfig thresholds) ── */
export const ALERT_THRESHOLDS = {
  acuteShortage: 0.30,        // gap_ratio above this → ACUTE_SHORTAGE
  emergingShortage: 0.10,     // gap_ratio above this → EMERGING_SHORTAGE
  balanced: -0.10,            // gap_ratio above this (and ≤ emergingShortage) → BALANCED
  approachingSaturation: -0.30, // gap_ratio above this → APPROACHING_SATURATION
  // below approachingSaturation → OVERSUPPLY
} as const;

/* ── Saturation trend detection ── */
/** Number of consecutive quarters where supply growth > demand growth that
 *  triggers an APPROACHING_SATURATION alert via the trend rule. */
export const SATURATION_CONSECUTIVE_QUARTERS = 3;

/* ── Demand-spike detection ── */
/** z-score above this → DEMAND_SPIKE alert. */
export const DEMAND_SPIKE_Z_THRESHOLD = 2.0;

/** Minimum standard deviation (in absolute demand units) to consider the
 *  z-score meaningful. Below this, the series is too flat to judge spikes. */
export const DEMAND_SPIKE_MIN_STD = 1.0;

/* ── Severity mapping ── */
export type AlertSeverity = 'CRITICAL' | 'SEVERE' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Map a gap_ratio value to an alert severity for shortage-type alerts.
 *  Called for ACUTE_SHORTAGE and EMERGING_SHORTAGE. */
export function shortageSeverity(gapRatio: number): AlertSeverity {
  if (gapRatio > 0.60) return 'CRITICAL';
  if (gapRatio > 0.45) return 'SEVERE';
  if (gapRatio > 0.30) return 'HIGH';
  if (gapRatio > 0.20) return 'MEDIUM';
  return 'LOW';
}

/** Map a gap_ratio value to an alert severity for oversupply-type alerts.
 *  Called for OVERSUPPLY and APPROACHING_SATURATION. */
export function oversupplySeverity(gapRatio: number): AlertSeverity {
  const magnitude = Math.abs(gapRatio);
  if (magnitude > 0.70) return 'CRITICAL';
  if (magnitude > 0.50) return 'SEVERE';
  if (magnitude > 0.30) return 'HIGH';
  if (magnitude > 0.20) return 'MEDIUM';
  return 'LOW';
}

/** Severity for DEMAND_SPIKE based on z-score magnitude. */
export function spikeSeverity(zScore: number): AlertSeverity {
  const mag = Math.abs(zScore);
  if (mag > 4.0) return 'CRITICAL';
  if (mag > 3.0) return 'SEVERE';
  if (mag > 2.5) return 'HIGH';
  return 'MEDIUM';
}

/** Relative ordering so we can compare two severities numerically. */
export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  CRITICAL: 5,
  SEVERE: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export const ALERT_TYPES = [
  'ACUTE_SHORTAGE',
  'EMERGING_SHORTAGE',
  'APPROACHING_SATURATION',
  'OVERSUPPLY',
  'DEMAND_SPIKE',
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];
