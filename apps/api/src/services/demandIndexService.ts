import { createHash } from 'crypto';
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';

export const DEMAND_INDEX_VERSION = 'LDI-v1';

export const DEMAND_INDEX_WEIGHTS = Object.freeze({
  job_postings: 0.5,
  industry_hiring: 0.3,
  ncs_vacancies: 0.2,
});

const SOURCES = ['job_postings', 'industry_hiring', 'ncs_vacancies'] as const;
type DemandSource = (typeof SOURCES)[number];
type MeasuredSource = Exclude<DemandSource, 'ncs_vacancies'>;

export interface DemandIndexFilters {
  state?: string;
  district?: string;
  sector?: string;
  trade?: string;
  period?: string;
  from?: string;
  to?: string;
}

export interface SignalObservation {
  district_id: unknown;
  trade_id: unknown;
  period: unknown;
  value: unknown;
}

export interface DemandIndexDataset {
  job_postings: readonly SignalObservation[];
  industry_hiring: readonly SignalObservation[];
}

interface DistrictRecord {
  id: string;
  state_id: string;
  name: string;
}

interface TradeRecord {
  id: string;
  sector_id: string;
  name: string;
}

export interface DemandIndexComponent {
  raw_value: number | null;
  normalized_value: number | null;
  configured_weight: number;
  effective_weight: number | null;
  weighted_contribution: number | null;
  observation_count: number;
  invalid_observation_count: number;
  status: 'available' | 'no_observation' | 'invalid_observation' | 'source_unavailable';
}

export interface DemandIndexRecord {
  district_id: string;
  district_name: string | null;
  state_id: string | null;
  trade_id: string;
  trade_name: string | null;
  sector_id: string | null;
  period: string;
  demand_index: number | null;
  computation_status: 'computed' | 'insufficient_data';
  normalized_signals: Record<DemandSource, number | null>;
  source_weights: Record<DemandSource, number | null>;
  weighted_contributions: Record<DemandSource, number | null>;
  components: Record<DemandSource, DemandIndexComponent>;
  available_sources: DemandSource[];
  missing_sources: Array<{
    source: DemandSource;
    reason: DemandIndexComponent['status'];
  }>;
  source_coverage_percent: number;
  methodology_version: typeof DEMAND_INDEX_VERSION;
}

export interface DemandIndexResponse {
  data: DemandIndexRecord[];
  methodology: {
    version: typeof DEMAND_INDEX_VERSION;
    formula: string;
    normalization: string;
    reference_population: string;
    weights: typeof DEMAND_INDEX_WEIGHTS;
    coverage: string;
    limitations: string[];
    contextual_sources: string[];
    unavailable_sources: string[];
    data_classification: 'synthetic_demo';
  };
  meta: {
    returned_records: number;
    applied_filters: DemandIndexFilters;
    normalization_reference_id: string;
    reference_population_size: Record<MeasuredSource, number>;
    invalid_observation_counts: Record<MeasuredSource, number>;
    data_provenance: {
      classification: 'synthetic_demo';
      description: string;
      observed_source_integrations: string[];
    };
  };
}

interface Aggregate {
  total: number;
  observationCount: number;
  invalidObservationCount: number;
}

interface AggregatedSource {
  groups: Map<string, Aggregate>;
  invalidObservationCount: number;
  referencePopulation: number[];
}

const METHODOLOGY: DemandIndexResponse['methodology'] = {
  version: DEMAND_INDEX_VERSION,
  formula:
    'For each district-trade-month, sum valid observations independently per source, normalize each source to 0-100, then compute sum(normalized_source * configured_weight) / sum(configured_weights for available sources).',
  normalization:
    'Empirical cumulative percentile of log1p of each source total against that source\'s full valid district-trade-month population. A valid zero is explicitly normalized to 0. Positive values receive 100 * (number of reference values <= value / reference population size); results are rounded to 2 decimals. This rank normalization limits outlier influence.',
  reference_population:
    'All valid aggregated records in the corresponding direct-signal table in the current database snapshot, before any request filters. Thus filters cannot change an otherwise identical score. The reference id identifies the distributions used for a response; changed underlying records can change later snapshots.',
  weights: DEMAND_INDEX_WEIGHTS,
  coverage:
    'Source coverage is the sum of configured weights for sources with a valid observation divided by the full configured weight total (1.00), expressed as a percentage. Available-source weights are renormalized for the index.',
  limitations: [
    'Weights are provisional assumptions, not empirically validated or nationally calibrated.',
    'The index is a relative methodology output, not a trained model, a forecast, or an employment statistic.',
    'Seeded demonstration records are synthetic. No live source integration is established by this API.',
    'Percentile values depend on the complete database snapshot and may change when source data changes.',
    'District-trade-month combinations with no direct-source rows cannot be enumerated or scored without inventing observations.',
  ],
  contextual_sources: [
    'eshram_signals.registered_workers is workforce registration context and is not a positive demand input.',
    'plfs_benchmarks.employment_rate is state-sector employment context and is not a positive demand input.',
  ],
  unavailable_sources: [
    'No NCS vacancy table/source exists. A synthetic source label on job-posting rows is not an independent NCS vacancy observation.',
  ],
  data_classification: 'synthetic_demo',
};

function isValidPeriod(period: unknown): period is string {
  return typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

function isValidIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function observationKey(districtId: string, tradeId: string, period: string): string {
  return `${districtId}\u0000${tradeId}\u0000${period}`;
}

function roundToTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundToSix(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function aggregateSource(observations: readonly SignalObservation[]): AggregatedSource {
  const groups = new Map<string, Aggregate>();
  let invalidObservationCount = 0;

  for (const observation of observations) {
    if (
      !isValidIdentifier(observation.district_id) ||
      !isValidIdentifier(observation.trade_id) ||
      !isValidPeriod(observation.period)
    ) {
      invalidObservationCount += 1;
      continue;
    }

    const key = observationKey(observation.district_id, observation.trade_id, observation.period);
    const aggregate = groups.get(key) ?? {
      total: 0,
      observationCount: 0,
      invalidObservationCount: 0,
    };
    const value = observation.value;

    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      aggregate.invalidObservationCount += 1;
      invalidObservationCount += 1;
      groups.set(key, aggregate);
      continue;
    }

    const total = aggregate.total + value;
    if (!Number.isSafeInteger(total)) {
      aggregate.invalidObservationCount += 1;
      invalidObservationCount += 1;
      groups.set(key, aggregate);
      continue;
    }

    aggregate.total = total;
    aggregate.observationCount += 1;
    groups.set(key, aggregate);
  }

  const referencePopulation = Array.from(groups.values())
    .filter((aggregate) => aggregate.observationCount > 0)
    .map((aggregate) => aggregate.total)
    .sort((left, right) => left - right);

  return { groups, invalidObservationCount, referencePopulation };
}

function upperBound(sortedValues: readonly number[], value: number): number {
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedValues[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function normalize(value: number, loggedPopulation: readonly number[]): number {
  if (value === 0 || loggedPopulation.length === 0) return 0;
  const logValue = Math.log1p(value);
  const rank = upperBound(loggedPopulation, logValue);
  return roundToTwo((rank / loggedPopulation.length) * 100);
}

function sourceStatus(
  source: DemandSource,
  aggregate: Aggregate | undefined,
): DemandIndexComponent['status'] {
  if (source === 'ncs_vacancies') return 'source_unavailable';
  if (!aggregate) return 'no_observation';
  return aggregate.observationCount > 0 ? 'available' : 'invalid_observation';
}

function filteredByLocation(
  district: DistrictRecord | undefined,
  trade: TradeRecord | undefined,
  filters: DemandIndexFilters,
): boolean {
  if (filters.state && district?.state_id !== filters.state) return false;
  if (filters.district && district?.id !== filters.district) return false;
  if (filters.sector && trade?.sector_id !== filters.sector) return false;
  if (filters.trade && trade?.id !== filters.trade) return false;
  return true;
}

export function calculateDemandIndex(
  dataset: DemandIndexDataset,
  districts: readonly DistrictRecord[],
  trades: readonly TradeRecord[],
  filters: DemandIndexFilters = {},
): DemandIndexResponse {
  const aggregated: Record<MeasuredSource, AggregatedSource> = {
    job_postings: aggregateSource(dataset.job_postings),
    industry_hiring: aggregateSource(dataset.industry_hiring),
  };
  const districtById = new Map(districts.map((district) => [district.id, district]));
  const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
  const keys = new Set<string>();

  for (const source of Object.values(aggregated)) {
    for (const key of source.groups.keys()) keys.add(key);
  }

  const populationSizes = {
    job_postings: aggregated.job_postings.referencePopulation.length,
    industry_hiring: aggregated.industry_hiring.referencePopulation.length,
  };
  const referenceDistributions = {
    job_postings: aggregated.job_postings.referencePopulation,
    industry_hiring: aggregated.industry_hiring.referencePopulation,
  };
  const loggedReferenceDistributions = {
    job_postings: referenceDistributions.job_postings.map((value) => Math.log1p(value)),
    industry_hiring: referenceDistributions.industry_hiring.map((value) => Math.log1p(value)),
  };
  const normalizationReferenceId = createHash('sha256')
    .update(JSON.stringify(referenceDistributions))
    .digest('hex')
    .slice(0, 16);

  const records: DemandIndexRecord[] = [];
  for (const key of keys) {
    const [districtId, tradeId, period] = key.split('\u0000');
    if (filters.period && period !== filters.period) continue;
    if (filters.from && period < filters.from) continue;
    if (filters.to && period > filters.to) continue;

    const district = districtById.get(districtId);
    const trade = tradeById.get(tradeId);
    if (!filteredByLocation(district, trade, filters)) continue;

    const aggregateBySource: Record<MeasuredSource, Aggregate | undefined> = {
      job_postings: aggregated.job_postings.groups.get(key),
      industry_hiring: aggregated.industry_hiring.groups.get(key),
    };
    const sourceValues: Record<DemandSource, number | null> = {
      job_postings: null,
      industry_hiring: null,
      ncs_vacancies: null,
    };
    const effectiveWeights: Record<DemandSource, number | null> = {
      job_postings: null,
      industry_hiring: null,
      ncs_vacancies: null,
    };
    const contributions: Record<DemandSource, number | null> = {
      job_postings: null,
      industry_hiring: null,
      ncs_vacancies: null,
    };
    const components = {} as Record<DemandSource, DemandIndexComponent>;
    const availableSources: DemandSource[] = [];
    const missingSources: DemandIndexRecord['missing_sources'] = [];
    let availableWeight = 0;

    for (const source of SOURCES) {
      const aggregate = source === 'ncs_vacancies' ? undefined : aggregateBySource[source];
      const status = sourceStatus(source, aggregate);
      const rawValue =
        aggregate && aggregate.observationCount > 0 ? aggregate.total : null;
      const normalizedValue =
        rawValue === null
          ? null
        : normalize(rawValue, loggedReferenceDistributions[source as MeasuredSource]);

      if (status === 'available') {
        availableSources.push(source);
        availableWeight += DEMAND_INDEX_WEIGHTS[source];
      } else {
        missingSources.push({ source, reason: status });
      }

      sourceValues[source] = normalizedValue;
      components[source] = {
        raw_value: rawValue,
        normalized_value: normalizedValue,
        configured_weight: DEMAND_INDEX_WEIGHTS[source],
        effective_weight: null,
        weighted_contribution: null,
        observation_count: aggregate?.observationCount ?? 0,
        invalid_observation_count: aggregate?.invalidObservationCount ?? 0,
        status,
      };
    }

    let demandIndex: number | null = null;
    if (availableWeight > 0) {
      let score = 0;
      for (const source of availableSources) {
        const effectiveWeight = DEMAND_INDEX_WEIGHTS[source] / availableWeight;
        const normalizedValue = sourceValues[source];
        if (normalizedValue === null) {
          throw new Error(`Available demand source ${source} has no normalized value`);
        }
        const contribution = normalizedValue * effectiveWeight;
        effectiveWeights[source] = roundToSix(effectiveWeight);
        contributions[source] = roundToTwo(contribution);
        components[source].effective_weight = roundToSix(effectiveWeight);
        components[source].weighted_contribution = roundToTwo(contribution);
        score += contribution;
      }
      demandIndex = roundToTwo(Math.min(100, Math.max(0, score)));
    }

    records.push({
      district_id: districtId,
      district_name: district?.name ?? null,
      state_id: district?.state_id ?? null,
      trade_id: tradeId,
      trade_name: trade?.name ?? null,
      sector_id: trade?.sector_id ?? null,
      period,
      demand_index: demandIndex,
      computation_status: demandIndex === null ? 'insufficient_data' : 'computed',
      normalized_signals: sourceValues,
      source_weights: effectiveWeights,
      weighted_contributions: contributions,
      components,
      available_sources: availableSources,
      missing_sources: missingSources,
      source_coverage_percent: roundToTwo(
        (availableWeight / Object.values(DEMAND_INDEX_WEIGHTS).reduce((sum, weight) => sum + weight, 0)) *
          100,
      ),
      methodology_version: DEMAND_INDEX_VERSION,
    });
  }

  records.sort(
    (left, right) =>
      left.district_id.localeCompare(right.district_id) ||
      left.trade_id.localeCompare(right.trade_id) ||
      left.period.localeCompare(right.period),
  );

  return {
    data: records,
    methodology: METHODOLOGY,
    meta: {
      returned_records: records.length,
      applied_filters: filters,
      normalization_reference_id: normalizationReferenceId,
      reference_population_size: populationSizes,
      invalid_observation_counts: {
        job_postings: aggregated.job_postings.invalidObservationCount,
        industry_hiring: aggregated.industry_hiring.invalidObservationCount,
      },
      data_provenance: {
        classification: 'synthetic_demo',
        description:
          'The repository seed script generates the job-posting and industry-hiring inputs; results from this seeded dataset are synthetic demonstration outputs.',
        observed_source_integrations: [],
      },
    },
  };
}

export async function getDemandIndex(
  db: Database<sqlite3.Database, sqlite3.Statement>,
  filters: DemandIndexFilters = {},
): Promise<DemandIndexResponse> {
  const [jobPostings, industryHiring, districts, trades] = await Promise.all([
    db.all(
      'SELECT district_id, trade_id, month AS period, postings_count AS value FROM job_posting_signals',
    ),
    db.all(
      'SELECT district_id, trade_id, month AS period, hires AS value FROM industry_hiring_signals',
    ),
    db.all('SELECT id, state_id, name FROM districts'),
    db.all('SELECT id, sector_id, name FROM trades'),
  ]);

  return calculateDemandIndex(
    {
      job_postings: jobPostings as SignalObservation[],
      industry_hiring: industryHiring as SignalObservation[],
    },
    districts as DistrictRecord[],
    trades as TradeRecord[],
    filters,
  );
}

export const demandIndexMethodology = METHODOLOGY;
