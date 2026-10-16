import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { generateRecommendations, RECOMMENDATION_VERSION } from './recommendationService';

describe('recommendationService', () => {
  function makeMockDb(options: {
    gapRows?: unknown[];
    capacityRows?: unknown[];
    alertRows?: unknown[];
  } = {}) {
    const gapRows = options.gapRows ?? [
      {
        district_id: 'D1',
        district_name: 'Pune',
        state_id: 'MH',
        trade_id: 'T1',
        trade_name: 'EV Mechanic',
        sector_id: 'SEC-AUTO',
        sector_name: 'Automotive',
        period: '2026-Q1',
        forecast_demand: 250,
        effective_supply: 100,
        gap: 150,
        gap_ratio: 0.60,
        status: 'ACUTE_SHORTAGE',
      },
      {
        district_id: 'D1',
        district_name: 'Pune',
        state_id: 'MH',
        trade_id: 'T2',
        trade_name: 'Fitter',
        sector_id: 'SEC-CAP',
        sector_name: 'Capital Goods',
        period: '2026-Q1',
        forecast_demand: 50,
        effective_supply: 100,
        gap: -50,
        gap_ratio: -1.0,
        status: 'OVERSUPPLY',
      },
    ];

    const capacityRows = options.capacityRows ?? [
      {
        district_id: 'D1',
        trade_id: 'T1',
        year: 2025,
        sanctioned_seats: 120,
        enrolled: 110,
        certified: 100,
        placed: 80,
        placement_rate: 0.80,
        centres_count: 2,
      },
      {
        district_id: 'D1',
        trade_id: 'T2',
        year: 2025,
        sanctioned_seats: 150,
        enrolled: 140,
        certified: 130,
        placed: 60,
        placement_rate: 0.46,
        centres_count: 3,
      },
    ];

    const alertRows = options.alertRows ?? [
      { district_id: 'D1', trade_id: 'T1', type: 'ACUTE_SHORTAGE', severity: 'CRITICAL', count: 1 },
    ];

    return {
      all: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM gap_results')) return gapRows;
        if (sql.includes('FROM training_capacity')) return capacityRows;
        if (sql.includes('FROM alerts')) return alertRows;
        return [];
      }),
    };
  }

  test('generates recommendations with rules for shortage and oversupply', async () => {
    const dbMock = makeMockDb();
    const result = await generateRecommendations(
      dbMock as unknown as Database<sqlite3.Database, sqlite3.Statement>,
      { state: 'MH' },
    );

    expect(result.methodology.version).toBe(RECOMMENDATION_VERSION);
    expect(result.data.length).toBeGreaterThan(0);

    const shortageRec = result.data.find((r) => r.trade_id === 'T1' && r.type === 'INCREASE_SEATS');
    expect(shortageRec).toBeDefined();
    expect(shortageRec?.priority).toBe('CRITICAL');
    expect(shortageRec?.metrics.seat_change).toBeGreaterThan(0);

    const oversupplyRec = result.data.find((r) => r.trade_id === 'T2');
    expect(oversupplyRec).toBeDefined();

    expect(result.meta.total).toBe(result.data.length);
  });

  test('returns empty data structure when no gaps exist', async () => {
    const dbMock = makeMockDb({ gapRows: [] });
    const result = await generateRecommendations(
      dbMock as unknown as Database<sqlite3.Database, sqlite3.Statement>,
    );

    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });
});
