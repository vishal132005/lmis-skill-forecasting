import axios from 'axios';
import { z } from 'zod';
import { config } from '../config';
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const forecastPointSchema = z.object({
  period: z.string().regex(MONTH_PATTERN),
  value: z.number().finite().nonnegative(),
});
const originSchema = z.object({
  cutoff_period: z.string().regex(MONTH_PATTERN),
  target_periods: z.array(z.string().regex(MONTH_PATTERN)).min(1),
  training_observations: z.number().int().positive(),
  mae: z.number().finite().nonnegative(),
  rmse: z.number().finite().nonnegative(),
});
const candidateSchema = z.object({
  method: z.string().min(1),
  mae: z.number().finite().nonnegative(),
  rmse: z.number().finite().nonnegative(),
  evaluation_windows: z.number().int().positive(),
  evaluation_observations: z.number().int().positive(),
  training_observations_min: z.number().int().positive(),
  training_observations_max: z.number().int().positive(),
  minimum_history: z.number().int().positive(),
  origins: z.array(originSchema).min(1),
});
const evaluationSchema = z.object({
  selected_method: z.string().min(1),
  mae: z.number().finite().nonnegative(),
  rmse: z.number().finite().nonnegative(),
  evaluation_windows: z.number().int().positive(),
  evaluation_observations: z.number().int().positive(),
  training_observations_min: z.number().int().positive(),
  training_observations_max: z.number().int().positive(),
  forecast_horizon_months: z.number().int().min(1).max(12),
  minimum_history: z.number().int().positive(),
  minimum_history_met: z.boolean(),
  candidate_methods: z.array(candidateSchema).min(1),
});
const sourceForecastSchema = z.object({
  source: z.enum(['job_postings', 'industry_hiring']),
  status: z.enum(['forecasted', 'insufficient_history', 'unavailable_source']),
  reason: z.string().nullable(),
  method: z.string().nullable(),
  history: z.array(forecastPointSchema),
  history_observation_count: z.number().int().nonnegative(),
  forecast: z.array(forecastPointSchema),
  evaluation: evaluationSchema.nullable(),
  missing_periods: z.array(z.string().regex(MONTH_PATTERN)),
  invalid_observation_count: z.number().int().nonnegative(),
});
const aiForecastSchema = z.object({
  district_id: z.string().min(1),
  trade_id: z.string().min(1),
  horizon_months: z.number().int().min(1).max(12),
  methodology_version: z.string().min(1),
  methodology: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    selection_metric: z.string().min(1),
    minimum_history_months: z.number().int().positive(),
    minimum_evaluation_windows: z.number().int().positive(),
    seasonal_naive_minimum_history_months: z.number().int().positive(),
    methods: z.array(z.string().min(1)),
    method_details: z.record(z.string()),
    missing_history_policy: z.string().min(1),
    invalid_data_policy: z.string().min(1),
    uncertainty: z.string().min(1),
  }),
  sources: z.object({
    job_postings: sourceForecastSchema,
    industry_hiring: sourceForecastSchema,
  }),
  limitations: z.array(z.string()),
});

type SourceName = 'job_postings' | 'industry_hiring';
interface RawHistoryRow {
  period: unknown;
  value: unknown;
}
interface ForecastObservation {
  period: string;
  value: number | string | null;
}

function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value);
}

function isValidCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    Number.isFinite(value)
  );
}

export class ForecastServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ForecastServiceError';
  }
}

function nextMonth(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const absoluteMonth = year * 12 + month;
  return `${Math.floor(absoluteMonth / 12)
    .toString()
    .padStart(4, '0')}-${String((absoluteMonth % 12) + 1).padStart(2, '0')}`;
}

function hasConsecutivePeriods(periods: string[]): boolean {
  return periods.every((period, index) =>
    index === 0 ? true : period === nextMonth(periods[index - 1]),
  );
}

function serializeInvalidValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function aggregateMonthlyRows(rows: RawHistoryRow[]): ForecastObservation[] {
  const validTotals = new Map<string, number>();
  const invalid: ForecastObservation[] = [];
  for (const row of rows) {
    const period = row.period;
    const value = row.value;
    const validPeriod = isMonth(period);
    const validValue = isValidCount(value);
    if (!validPeriod || !validValue) {
      invalid.push({
        period: validPeriod ? period : serializeInvalidValue(period) ?? '',
        value: validValue ? value : serializeInvalidValue(value),
      });
      continue;
    }

    const total = (validTotals.get(period) ?? 0) + value;
    if (!Number.isSafeInteger(total)) {
      invalid.push({ period, value: 'unsafe_integer_total' });
      continue;
    }
    validTotals.set(period, total);
  }
  const aggregated = Array.from(validTotals, ([period, value]) => ({ period, value }));
  return [...aggregated, ...invalid].sort((left, right) =>
    left.period.localeCompare(right.period),
  );
}

function validateForecastContract(
  result: unknown,
  districtId: string,
  tradeId: string,
  horizon: number,
) {
  const parsed = aiForecastSchema.safeParse(result);
  if (!parsed.success) {
    throw new ForecastServiceError(
      'The forecasting service returned a malformed response.',
      502,
      'INVALID_FORECAST_RESPONSE',
    );
  }
  const response = parsed.data;
  if (
    response.district_id !== districtId ||
    response.trade_id !== tradeId ||
    response.horizon_months !== horizon
  ) {
    throw new ForecastServiceError(
      'The forecasting service response did not match the request.',
      502,
      'FORECAST_RESPONSE_MISMATCH',
    );
  }

  for (const sourceName of ['job_postings', 'industry_hiring'] as const) {
    const source = response.sources[sourceName];
    if (source.source !== sourceName) {
      throw new ForecastServiceError(
        'The forecasting service returned a mismatched source.',
        502,
        'FORECAST_RESPONSE_MISMATCH',
      );
    }
    if (source.status === 'forecasted') {
      if (
        source.forecast.length !== horizon ||
        source.history.length !== source.history_observation_count ||
        source.history.length === 0 ||
        !hasConsecutivePeriods(source.history.map((point) => point.period)) ||
        source.method === null ||
        source.evaluation === null ||
        source.evaluation.selected_method !== source.method ||
        source.evaluation.forecast_horizon_months !== horizon ||
        !source.evaluation.minimum_history_met ||
        source.forecast.some(
          (point, index) =>
            point.period !== nextMonth(
              index === 0
                ? source.history[source.history.length - 1].period
                : source.forecast[index - 1].period,
            ),
        )
      ) {
        throw new ForecastServiceError(
          'The forecasting service returned an incomplete forecast.',
          502,
          'INVALID_FORECAST_RESPONSE',
        );
      }
      const historyPeriods = new Set(source.history.map((point) => point.period));
      const selectedCandidate = source.evaluation.candidate_methods.find(
        (candidate) => candidate.method === source.method,
      );
      if (
        !selectedCandidate ||
        selectedCandidate.evaluation_windows !== source.evaluation.evaluation_windows ||
        selectedCandidate.evaluation_observations !==
          source.evaluation.evaluation_observations ||
        selectedCandidate.origins.some(
          (origin) =>
            origin.training_observations > source.history.length ||
            source.history[origin.training_observations - 1]?.period !==
              origin.cutoff_period ||
            origin.target_periods.length !== horizon ||
            origin.target_periods[0] !== nextMonth(origin.cutoff_period) ||
            !hasConsecutivePeriods(origin.target_periods) ||
            origin.target_periods.some((period) => !historyPeriods.has(period)),
        )
      ) {
        throw new ForecastServiceError(
          'The forecasting service returned inconsistent backtest results.',
          502,
          'INVALID_FORECAST_RESPONSE',
        );
      }
    } else if (source.forecast.length > 0 || source.method !== null || source.evaluation !== null) {
      throw new ForecastServiceError(
        'The forecasting service returned forecasts for a source that is unavailable.',
        502,
        'INVALID_FORECAST_RESPONSE',
      );
    }
  }
  return response;
}

export async function runForecast(
  db: Database<sqlite3.Database, sqlite3.Statement>,
  districtId: string,
  tradeId: string,
  horizon: number,
) {
  const [district, trade] = await Promise.all([
    db.get('SELECT id FROM districts WHERE id = ?', [districtId]),
    db.get('SELECT id FROM trades WHERE id = ?', [tradeId]),
  ]);
  if (!district || !trade) {
    throw new ForecastServiceError(
      !district ? 'District not found.' : 'Trade not found.',
      404,
      !district ? 'DISTRICT_NOT_FOUND' : 'TRADE_NOT_FOUND',
    );
  }

  const [jobPostings, industryHiring] = await Promise.all([
    db.all(
      'SELECT month AS period, postings_count AS value FROM job_posting_signals WHERE district_id = ? AND trade_id = ? ORDER BY month',
      [districtId, tradeId],
    ),
    db.all(
      'SELECT month AS period, hires AS value FROM industry_hiring_signals WHERE district_id = ? AND trade_id = ? ORDER BY month',
      [districtId, tradeId],
    ),
  ]);
  const histories: Record<SourceName, ForecastObservation[]> = {
    job_postings: aggregateMonthlyRows(jobPostings as RawHistoryRow[]),
    industry_hiring: aggregateMonthlyRows(industryHiring as RawHistoryRow[]),
  };

  if (!Number.isInteger(config.ai.timeout) || config.ai.timeout <= 0) {
    throw new ForecastServiceError(
      'AI_SERVICE_TIMEOUT must be a positive integer.',
      500,
      'INVALID_AI_SERVICE_CONFIGURATION',
    );
  }

  const endpoint = `${config.ai.url.replace(/\/+$/, '')}/ai/forecast`;
  let aiResult: unknown;
  try {
    const response = await axios.post<unknown>(
      endpoint,
      {
        district_id: districtId,
        trade_id: tradeId,
        horizon_months: horizon,
        sources: histories,
      },
      { timeout: config.ai.timeout },
    );
    aiResult = response.data;
  } catch (error) {
    if (!axios.isAxiosError(error)) throw error;
    const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    throw new ForecastServiceError(
      timedOut
        ? 'The forecasting service timed out.'
        : 'The forecasting service is unavailable.',
      timedOut ? 504 : 503,
      timedOut ? 'FORECAST_SERVICE_TIMEOUT' : 'FORECAST_SERVICE_UNAVAILABLE',
    );
  }

  const response = validateForecastContract(aiResult, districtId, tradeId, horizon);
  return {
    ...response,
    data_provenance: {
      classification: 'synthetic_demo' as const,
      description:
        'The repository seed generates the source histories used here. These outputs are synthetic demonstration forecasts, not employment statistics.',
      observed_source_integrations: [] as string[],
    },
    limitations: [
      ...response.limitations,
      'The SQLite schema does not record per-row source provenance; current repository seed histories are labelled synthetic demonstration data.',
    ],
  };
}

export function isSupportedHorizon(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;
}
