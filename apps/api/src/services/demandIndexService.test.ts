import {
  calculateDemandIndex,
  DEMAND_INDEX_WEIGHTS,
  DemandIndexDataset,
  SignalObservation,
} from './demandIndexService';

const districts = [
  { id: 'D1', state_id: 'S1', name: 'District One' },
  { id: 'D2', state_id: 'S1', name: 'District Two' },
  { id: 'D3', state_id: 'S2', name: 'District Three' },
];
const trades = [
  { id: 'T1', sector_id: 'SEC1', name: 'Trade One' },
  { id: 'T2', sector_id: 'SEC2', name: 'Trade Two' },
];

function observation(
  district_id: string,
  trade_id: string,
  period: string,
  value: unknown,
): SignalObservation {
  return { district_id, trade_id, period, value };
}

function calculate(
  jobPostings: SignalObservation[],
  industryHiring: SignalObservation[] = [],
  filters: Parameters<typeof calculateDemandIndex>[3] = {},
) {
  const dataset: DemandIndexDataset = {
    job_postings: jobPostings,
    industry_hiring: industryHiring,
  };
  return calculateDemandIndex(dataset, districts, trades, filters);
}

function recordAt(
  result: ReturnType<typeof calculate>,
  districtId: string,
  tradeId: string,
  period: string,
) {
  const record = result.data.find(
    (item) =>
      item.district_id === districtId &&
      item.trade_id === tradeId &&
      item.period === period,
  );
  if (!record) throw new Error('Expected demand-index record was not returned');
  return record;
}

describe('LDI-v1 calculation', () => {
  test('normalizes and scores valid observations on a 0-100 scale', () => {
    const result = calculate(
      [observation('D1', 'T1', '2025-01', 10), observation('D2', 'T1', '2025-01', 20)],
      [observation('D1', 'T1', '2025-01', 5), observation('D2', 'T1', '2025-01', 10)],
    );

    const low = recordAt(result, 'D1', 'T1', '2025-01');
    const high = recordAt(result, 'D2', 'T1', '2025-01');
    expect(low.demand_index).toBeGreaterThanOrEqual(0);
    expect(high.demand_index).toBeLessThanOrEqual(100);
    expect(high.demand_index).toBeGreaterThan(low.demand_index as number);
    expect(low.computation_status).toBe('computed');
  });

  test('preserves valid all-zero inputs and scores them as zero', () => {
    const result = calculate(
      [observation('D1', 'T1', '2025-01', 0), observation('D2', 'T1', '2025-01', 0)],
      [observation('D1', 'T1', '2025-01', 0), observation('D2', 'T1', '2025-01', 0)],
    );
    const zero = recordAt(result, 'D1', 'T1', '2025-01');

    expect(zero.demand_index).toBe(0);
    expect(zero.normalized_signals.job_postings).toBe(0);
    expect(zero.available_sources).toEqual(['job_postings', 'industry_hiring']);
    expect(zero.source_coverage_percent).toBe(80);
  });

  test('renormalizes weights over available direct sources and reports full-weight coverage', () => {
    const result = calculate([observation('D1', 'T1', '2025-01', 12)]);
    const record = recordAt(result, 'D1', 'T1', '2025-01');

    expect(record.source_weights.job_postings).toBe(1);
    expect(record.source_weights.industry_hiring).toBeNull();
    expect(record.demand_index).toBe(100);
    expect(record.source_coverage_percent).toBe(50);
    expect(record.missing_sources).toContainEqual({
      source: 'industry_hiring',
      reason: 'no_observation',
    });
    expect(record.missing_sources).toContainEqual({
      source: 'ncs_vacancies',
      reason: 'source_unavailable',
    });
    expect(DEMAND_INDEX_WEIGHTS.ncs_vacancies).toBe(0.2);
  });

  test('reported effective weights retain the normalized total', () => {
    const result = calculate(
      [observation('D1', 'T1', '2025-01', 10)],
      [observation('D1', 'T1', '2025-01', 5)],
    );
    const record = recordAt(result, 'D1', 'T1', '2025-01');

    expect(record.source_weights.job_postings).toBe(0.625);
    expect(record.source_weights.industry_hiring).toBe(0.375);
    expect(record.source_coverage_percent).toBe(80);
  });

  test('returns null and insufficient_data when observations exist but all counts are invalid', () => {
    const result = calculate([
      observation('D1', 'T1', '2025-01', -1),
      observation('D1', 'T1', '2025-01', Number.NaN),
      observation('D1', 'T1', '2025-01', '4'),
    ]);
    const record = recordAt(result, 'D1', 'T1', '2025-01');

    expect(record.demand_index).toBeNull();
    expect(record.computation_status).toBe('insufficient_data');
    expect(record.components.job_postings.status).toBe('invalid_observation');
    expect(result.meta.invalid_observation_counts.job_postings).toBe(3);
  });

  test('sums duplicate source records before normalization instead of multiplying joins', () => {
    const result = calculate([
      observation('D1', 'T1', '2025-01', 4),
      observation('D1', 'T1', '2025-01', 6),
      observation('D2', 'T1', '2025-01', 20),
    ]);
    const duplicateGroup = recordAt(result, 'D1', 'T1', '2025-01');

    expect(duplicateGroup.components.job_postings.raw_value).toBe(10);
    expect(duplicateGroup.components.job_postings.observation_count).toBe(2);
    expect(duplicateGroup.demand_index).toBe(50);
  });

  test('uses rank normalization so an outlier cannot push scores outside the scale', () => {
    const result = calculate([
      observation('D1', 'T1', '2025-01', 1),
      observation('D2', 'T1', '2025-01', 2),
      observation('D3', 'T1', '2025-01', 1_000_000_000),
    ]);

    expect(recordAt(result, 'D3', 'T1', '2025-01').normalized_signals.job_postings).toBe(100);
    for (const record of result.data) {
      expect(record.demand_index).toBeGreaterThanOrEqual(0);
      expect(record.demand_index).toBeLessThanOrEqual(100);
    }
  });

  test('produces deterministic scores for identical inputs', () => {
    const dataset = [observation('D1', 'T1', '2025-01', 7)];
    const first = calculate(dataset);
    const second = calculate(dataset);

    expect(first.data).toEqual(second.data);
    expect(first.meta.normalization_reference_id).toBe(
      second.meta.normalization_reference_id,
    );
  });

  test('aligns distinct districts, trades, and periods without cross-pairing', () => {
    const result = calculate(
      [
        observation('D1', 'T1', '2025-01', 10),
        observation('D2', 'T2', '2025-02', 30),
      ],
      [observation('D1', 'T1', '2025-02', 5)],
    );

    expect(result.data).toHaveLength(3);
    expect(recordAt(result, 'D1', 'T1', '2025-01').components.industry_hiring.status)
      .toBe('no_observation');
    expect(recordAt(result, 'D1', 'T1', '2025-02').components.job_postings.status)
      .toBe('no_observation');
    expect(recordAt(result, 'D2', 'T2', '2025-02').components.industry_hiring.status)
      .toBe('no_observation');
  });

  test('keeps normalization stable when output filters change', () => {
    const jobPostings = [
      observation('D1', 'T1', '2025-01', 5),
      observation('D2', 'T1', '2025-01', 10),
      observation('D3', 'T2', '2025-01', 100),
    ];
    const unfiltered = calculate(jobPostings);
    const filtered = calculate(jobPostings, [], { district: 'D1' });

    expect(recordAt(filtered, 'D1', 'T1', '2025-01').demand_index).toBe(
      recordAt(unfiltered, 'D1', 'T1', '2025-01').demand_index,
    );
    expect(filtered.meta.normalization_reference_id).toBe(
      unfiltered.meta.normalization_reference_id,
    );
    expect(filtered.meta.reference_population_size.job_postings).toBe(3);
  });

  test('excludes e-Shram and PLFS from demand inputs and reports synthetic provenance', () => {
    const result = calculate([observation('D1', 'T1', '2025-01', 2)]);

    expect(result.methodology.contextual_sources).toHaveLength(2);
    expect(result.methodology.data_classification).toBe('synthetic_demo');
    expect(result.meta.data_provenance.classification).toBe('synthetic_demo');
    expect(result.meta.data_provenance.observed_source_integrations).toEqual([]);
  });
});
