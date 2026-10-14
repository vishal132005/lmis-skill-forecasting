import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { runSupplyForecast, batchSupplyForecast, SUPPLY_FORECAST_VERSION } from './supplyForecastService';

describe('supplyForecastService', () => {
  function makeMockDb(options: {
    district?: { id: string; name: string } | null;
    trade?: { id: string; name: string } | null;
    history?: unknown[];
  } = {}) {
    const district = options.district !== undefined ? options.district : { id: 'D1', name: 'Pune' };
    const trade = options.trade !== undefined ? options.trade : { id: 'T1', name: 'EV Mechanic' };
    const history = options.history ?? [
      { year: 2023, sanctioned_seats: 100, enrolled: 95, certified: 90, placed: 75, placement_rate: 0.83, centres_count: 2 },
      { year: 2024, sanctioned_seats: 120, enrolled: 115, certified: 110, placed: 95, placement_rate: 0.86, centres_count: 3 },
      { year: 2025, sanctioned_seats: 140, enrolled: 135, certified: 130, placed: 115, placement_rate: 0.88, centres_count: 3 },
    ];

    return {
      get: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('districts')) return district;
        if (sql.includes('trades')) return trade;
        return undefined;
      }),
      all: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('CROSS JOIN')) return [{ district_id: 'D1', trade_id: 'T1' }];
        if (sql.includes('DISTINCT tc.district_id')) return [{ district_id: 'D1', trade_id: 'T1' }];
        if (sql.includes('training_capacity')) return history;
        return [];
      }),
    };
  }

  test('runs supply forecast successfully with valid historical data', async () => {
    const dbMock = makeMockDb();
    const result = await runSupplyForecast(
      dbMock as unknown as Database<sqlite3.Database, sqlite3.Statement>,
      'D1',
      'T1',
      4,
    );

    expect(result.methodology_version).toBe(SUPPLY_FORECAST_VERSION);
    expect(result.district_name).toBe('Pune');
    expect(result.trade_name).toBe('EV Mechanic');
    expect(result.pipeline_rates).toBeDefined();
    expect(result.pipeline_rates.enrolment_rate).toBeGreaterThan(0.9);
    expect(result.projections).toHaveLength(4);
    expect(result.trend.seats_trend_direction).toBe('growing');
    expect(result.projections[0].effective_quarterly_supply).toBeGreaterThan(0);
  });

  test('throws error if district or trade not found', async () => {
    const dbMock = makeMockDb({ district: null });
    await expect(
      runSupplyForecast(
        dbMock as unknown as Database<sqlite3.Database, sqlite3.Statement>,
        'INVALID',
        'T1',
      ),
    ).rejects.toThrow('District not found.');
  });

  test('handles zero history gracefully with low confidence fallback', async () => {
    const dbMock = makeMockDb({ history: [] });
    const result = await runSupplyForecast(
      dbMock as unknown as Database<sqlite3.Database, sqlite3.Statement>,
      'D1',
      'T1',
      4,
    );

    expect(result.projections).toHaveLength(4);
    expect(result.projections[0].projected_seats).toBe(0);
    expect(result.projections[0].projected_placed).toBe(0);
    expect(result.projections[0].effective_quarterly_supply).toBe(0);
    expect(result.projections[0].confidence).toBe('low');
    expect(result.history).toHaveLength(0);
  });

  test('batchSupplyForecast processes scopes and aggregates results with preserved IDs', async () => {
    const dbMock = makeMockDb();
    const results = await batchSupplyForecast(
      dbMock as unknown as Database<sqlite3.Database, sqlite3.Statement>,
      { state: 'MH', district_id: 'D1', trade_id: 'T1', sector: 'SEC-AUTO' },
      4,
    );

    expect(results).toHaveLength(1);
    expect(results[0].district_id).toBe('D1');
    expect(results[0].district_name).toBe('Pune');
    expect(results[0].trade_id).toBe('T1');
    expect(results[0].trade_name).toBe('EV Mechanic');
  });
});
