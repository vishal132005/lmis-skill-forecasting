const DEFAULT_OPENING_CONVERSION_FACTOR = 0.5;
const configuredConversionFactor = Number(
  process.env.GAP_OPENING_CONVERSION_FACTOR ?? DEFAULT_OPENING_CONVERSION_FACTOR,
);

if (
  !Number.isFinite(configuredConversionFactor) ||
  configuredConversionFactor < 0 ||
  configuredConversionFactor > 1
) {
  throw new Error('GAP_OPENING_CONVERSION_FACTOR must be a number from 0 to 1.');
}

export const GAP_OPENING_CONVERSION_FACTOR = configuredConversionFactor;
export const GAP_METHOD_VERSION = 'GAP-v1+TSF-v1';
export const GAP_INTERVAL_COVERAGE = 0.9;
export const GAP_MINIMUM_INTERVAL_ERRORS = 9;
export const MAX_GAP_FORECAST_HORIZON_MONTHS = 14;

export const GAP_STATUSES = [
  'ACUTE_SHORTAGE',
  'EMERGING_SHORTAGE',
  'BALANCED',
  'APPROACHING_SATURATION',
  'OVERSUPPLY',
  'INSUFFICIENT_DATA',
] as const;

export type GapStatus = (typeof GAP_STATUSES)[number];

export const GAP_THRESHOLDS = {
  acuteShortage: 0.3,
  emergingShortage: 0.1,
  balanced: -0.1,
  approachingSaturation: -0.3,
} as const;
