import { AddressInfo } from 'net';
import { createServer, IncomingMessage, Server, request } from 'http';
import axios, { AxiosResponse } from 'axios';
import { getDb } from '../database';
import { forecastRouter } from './forecast';

jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    isAxiosError: jest.fn((error: { isAxiosError?: boolean }) => error?.isAxiosError === true),
  },
}));

const mockedGetDb = jest.mocked(getDb);
const mockedAxiosPost = jest.mocked(axios.post);
const fakeDb = {
  get: jest.fn(),
  all: jest.fn(),
};

let server: Server;
let serverAddress: AddressInfo;

function successfulResponse(horizon: number, hasHistory = true) {
  const periods = [
    '2025-01',
    '2025-02',
    '2025-03',
    '2025-04',
    '2025-05',
    '2025-06',
    '2025-07',
    '2025-08',
    '2025-09',
  ];
  const forecast = Array.from({ length: horizon }, (_, index) => ({
    period: `2025-${String(index + 10).padStart(2, '0')}`,
    value: 10 + index,
  }));
  const evaluatedSource = (source: 'job_postings' | 'industry_hiring') => ({
    source,
    status: hasHistory ? 'forecasted' : 'unavailable_source',
    reason: hasHistory ? null : 'no_source_observations',
    method: hasHistory ? 'last_observation' : null,
    history: hasHistory ? periods.map((period, index) => ({ period, value: 5 + index })) : [],
    history_observation_count: hasHistory ? periods.length : 0,
    forecast: hasHistory ? forecast : [],
    evaluation: hasHistory ? {
      selected_method: 'last_observation',
      mae: 1,
      rmse: 1,
      evaluation_windows: 3,
      evaluation_observations: horizon * 3,
      training_observations_min: 6,
      training_observations_max: 8,
      forecast_horizon_months: horizon,
      minimum_history: 6,
      minimum_history_met: true,
      candidate_methods: [
        {
          method: 'last_observation',
          mae: 1,
          rmse: 1,
          evaluation_windows: 3,
          evaluation_observations: horizon * 3,
          training_observations_min: 6,
          training_observations_max: 8,
          minimum_history: 6,
          origins: [
            {
              cutoff_period: '2025-06',
              target_periods: ['2025-07'],
              training_observations: 6,
              mae: 1,
              rmse: 1,
            },
            {
              cutoff_period: '2025-07',
              target_periods: ['2025-08'],
              training_observations: 7,
              mae: 1,
              rmse: 1,
            },
            {
              cutoff_period: '2025-08',
              target_periods: ['2025-09'],
              training_observations: 8,
              mae: 1,
              rmse: 1,
            },
          ],
        },
      ],
    } : null,
    missing_periods: [] as string[],
    invalid_observation_count: 0,
  });
  return {
    district_id: 'D1',
    trade_id: 'T1',
    horizon_months: horizon,
    methodology_version: 'TSF-v1',
    methodology: {
      name: 'Rolling-origin statistical baselines',
      version: 'TSF-v1',
      selection_metric: 'MAE',
      minimum_history_months: 6,
      minimum_evaluation_windows: 3,
      seasonal_naive_minimum_history_months: 24,
      methods: ['last_observation', 'seasonal_naive', 'damped_linear_trend'],
      method_details: {
        last_observation: 'Repeat latest value.',
        seasonal_naive: 'Repeat seasonal value.',
        damped_linear_trend: 'Damped OLS trend.',
      },
      missing_history_policy: 'Do not fill missing periods.',
      invalid_data_policy: 'Invalid observations disable forecasting.',
      uncertainty: 'Unavailable.',
    },
    sources: {
      job_postings: evaluatedSource('job_postings'),
      industry_hiring: evaluatedSource('industry_hiring'),
    },
    limitations: ['Synthetic demonstration data.'],
  };
}

function sendRequest(
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: serverAddress.port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
      (response: IncomingMessage) => {
        let payload = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          payload += chunk;
        });
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(payload) });
        });
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function mockAiResponse(response: unknown): Promise<void> {
  mockedAxiosPost.mockResolvedValue({
    data: response,
  } as AxiosResponse<unknown>);
}

beforeAll(async () => {
  const express = await import('express');
  const app = express.default();
  app.use(express.default.json());
  app.use('/api/v1/forecasts', forecastRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  serverAddress = server.address() as AddressInfo;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  fakeDb.get.mockImplementation(async (sql: string) =>
    sql.includes('districts') ? { id: 'D1' } : { id: 'T1' },
  );
  fakeDb.all.mockImplementation(async (sql: string) =>
    sql.includes('job_posting_signals')
      ? [{ period: '2025-01', value: 10 }]
      : [{ period: '2025-01', value: 8 }],
  );
  mockedGetDb.mockResolvedValue(fakeDb as unknown as Awaited<ReturnType<typeof getDb>>);
  mockedAxiosPost.mockImplementation(async (_url, body) => ({
    data: successfulResponse((body as { horizon_months: number }).horizon_months),
  } as AxiosResponse<unknown>));
});

describe('POST /api/v1/forecasts/run', () => {
  const requestBody = {
    district_id: 'D1',
    trade_id: 'T1',
    horizon_months: 1,
  };

  test('returns validated source forecasts for a valid request', async () => {
    const response = await sendRequest('/api/v1/forecasts/run', requestBody);
    expect(response.status).toBe(200);
    expect(response.body.sources.job_postings.forecast).toHaveLength(1);
    expect(response.body.data_provenance.classification).toBe('synthetic_demo');
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  test('returns 404 for an unknown district or trade', async () => {
    fakeDb.get.mockResolvedValueOnce(null);
    const districtResponse = await sendRequest('/api/v1/forecasts/run', requestBody);
    expect(districtResponse.status).toBe(404);
    expect(districtResponse.body.error.code).toBe('DISTRICT_NOT_FOUND');
    expect(mockedAxiosPost).not.toHaveBeenCalled();

    fakeDb.get.mockResolvedValueOnce({ id: 'D1' }).mockResolvedValueOnce(null);
    const tradeResponse = await sendRequest('/api/v1/forecasts/run', requestBody);
    expect(tradeResponse.status).toBe(404);
    expect(tradeResponse.body.error.code).toBe('TRADE_NOT_FOUND');
  });

  test('rejects a horizon outside 1 through 12', async () => {
    const response = await sendRequest('/api/v1/forecasts/run', {
      ...requestBody,
      horizon_months: 13,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_FORECAST_REQUEST');
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  test('keeps missing source history explicit instead of returning fabricated values', async () => {
    fakeDb.all.mockResolvedValue([]);
    await mockAiResponse(successfulResponse(1, false));
    const response = await sendRequest('/api/v1/forecasts/run', requestBody);
    expect(response.status).toBe(200);
    expect(response.body.sources.job_postings.status).toBe('unavailable_source');
    expect(response.body.sources.job_postings.forecast).toEqual([]);
  });

  test('returns 504 when the AI service times out', async () => {
    mockedAxiosPost.mockRejectedValue(
      Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }),
    );
    const response = await sendRequest('/api/v1/forecasts/run', requestBody);
    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe('FORECAST_SERVICE_TIMEOUT');
  });

  test('returns 503 when the AI service is unavailable', async () => {
    mockedAxiosPost.mockRejectedValue(
      Object.assign(new Error('offline'), { isAxiosError: true, code: 'ECONNREFUSED' }),
    );
    const response = await sendRequest('/api/v1/forecasts/run', requestBody);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('FORECAST_SERVICE_UNAVAILABLE');
  });

  test('rejects a malformed AI-service response', async () => {
    await mockAiResponse({ malformed: true });
    const response = await sendRequest('/api/v1/forecasts/run', requestBody);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('INVALID_FORECAST_RESPONSE');
  });
});
