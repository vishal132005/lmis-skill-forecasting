import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { calculateGapMetrics, recomputeGaps } from './gapService';

describe('calculateGapMetrics', () => {
  test.each([
    [0.300001, 'ACUTE_SHORTAGE'],
    [0.3, 'EMERGING_SHORTAGE'],
    [0.100001, 'EMERGING_SHORTAGE'],
    [0.1, 'BALANCED'],
    [-0.1, 'BALANCED'],
    [-0.100001, 'APPROACHING_SATURATION'],
    [-0.3, 'APPROACHING_SATURATION'],
    [-0.300001, 'OVERSUPPLY'],
  ] as const)('classifies ratio %s as %s', (ratio, expected) => {
    const result = calculateGapMetrics(100, 100 * (1 - ratio));
    expect(result.gap_ratio).toBeCloseTo(ratio);
    expect(result.status).toBe(expected);
  });

  test('handles zero demand without dividing by zero', () => {
    expect(calculateGapMetrics(0, 0)).toMatchObject({
      gap: 0,
      gap_ratio: null,
      status: 'BALANCED',
    });
    expect(calculateGapMetrics(0, 12)).toMatchObject({
      gap: -12,
      gap_ratio: null,
      status: 'OVERSUPPLY',
    });
  });
});

describe('recomputeGaps', () => {
  const forecastMonths = [
    '2026-10', '2026-11', '2026-12',
    '2027-01', '2027-02', '2027-03',
    '2027-04', '2027-05', '2027-06',
    '2027-07', '2027-08', '2027-09',
  ];

  function makeForecastResponse(originCount: number) {
    const source = (name: 'job_postings' | 'industry_hiring') => ({
      source: name,
      status: 'forecasted',
      reason: null,
      method: 'last_observation',
      forecast: forecastMonths.map((period) => ({ period, value: 10 })),
      evaluation: {
        candidate_methods: [{
          method: 'last_observation',
          origins: Array.from({ length: originCount }, (_, index) => ({
            cutoff_period: `2024-${String(index + 1).padStart(2, '0')}`,
            target_periods: forecastMonths,
            errors_by_horizon: forecastMonths.map(() => 1),
          })),
        }],
      },
    });
    return {
      sources: {
        job_postings: source('job_postings'),
        industry_hiring: source('industry_hiring'),
      },
    };
  }

  function makeDbMock() {
    return {
      all: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('CROSS JOIN')) {
          return [{ district_id: 'D1', trade_id: 'T1' }];
        }
        if (sql.includes('MAX(period)')) return [{ latest_period: '2026-09' }];
        return [
          { year: 2026, sanctioned_seats: 400, placement_rate: 0.5 },
          { year: 2027, sanctioned_seats: 400, placement_rate: 0.5 },
        ];
      }),
      run: jest.fn().mockResolvedValue({}),
    };
  }

  test('persists explicit insufficient-data rows when forecasting fails', async () => {
    const dbMock = {
      all: jest
        .fn()
        .mockResolvedValueOnce([{ district_id: 'D1', trade_id: 'T1' }])
        .mockResolvedValueOnce([{ latest_period: '2026-09' }]),
      run: jest.fn().mockResolvedValue({}),
    };
    const forecastRunner = jest.fn().mockRejectedValue(new Error('service unavailable'));

    const result = await recomputeGaps(
      dbMock as unknown as Database<sqlite3.Database, sqlite3.Statement>,
      {},
      forecastRunner as unknown as typeof import('./forecastService').runForecast,
    );

    expect(result).toEqual({ computed: 0, insufficient: 4 });
    expect(forecastRunner).toHaveBeenCalledWith(
      dbMock,
      'D1',
      'T1',
      12,
    );
    expect(dbMock.run).toHaveBeenCalledTimes(4);
    expect(dbMock.run.mock.calls.map((call) => call[1][11])).toEqual([
      'INSUFFICIENT_DATA',
      'INSUFFICIENT_DATA',
      'INSUFFICIENT_DATA',
      'INSUFFICIENT_DATA',
    ]);
    expect(dbMock.run.mock.calls[0][1][12]).toContain('Forecast failed: service unavailable');
  });

  test('persists an insufficient-data reason when fewer than nine paired quarter errors exist', async () => {
    const dbMock = makeDbMock();
    const forecastRunner = jest.fn().mockResolvedValue(makeForecastResponse(8));

    const result = await recomputeGaps(
      dbMock as unknown as Database<sqlite3.Database, sqlite3.Statement>,
      {},
      forecastRunner as unknown as typeof import('./forecastService').runForecast,
    );

    expect(result).toEqual({ computed: 0, insufficient: 4 });
    expect(dbMock.run.mock.calls[0][1][12]).toContain(
      'Only 8 paired rolling-origin errors are available for 2026-Q4',
    );
  });

  test('calibrates the combined 90% quarter interval from paired source errors', async () => {
    const dbMock = makeDbMock();
    const forecastRunner = jest.fn().mockResolvedValue(makeForecastResponse(9));

    const result = await recomputeGaps(
      dbMock as unknown as Database<sqlite3.Database, sqlite3.Statement>,
      {},
      forecastRunner as unknown as typeof import('./forecastService').runForecast,
    );

    expect(result).toEqual({ computed: 4, insufficient: 0 });
    expect(dbMock.run).toHaveBeenCalledTimes(4);
    const firstRecord = dbMock.run.mock.calls[0][1];
    expect(firstRecord.slice(2, 12)).toEqual([
      '2026-Q4',
      30,
      27,
      33,
      400,
      0.5,
      50,
      -20,
      -2 / 3,
      'OVERSUPPLY',
    ]);
  });
});
