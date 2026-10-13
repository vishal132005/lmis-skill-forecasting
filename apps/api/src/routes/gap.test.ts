import { AddressInfo } from 'net';
import { createServer, IncomingMessage, Server, request } from 'http';
import { getDb } from '../database';
import { gapRouter } from './gap';

jest.mock('../database', () => ({ getDb: jest.fn() }));

const mockedGetDb = jest.mocked(getDb);
const fakeDb = { all: jest.fn(), run: jest.fn() };
let server: Server;
let serverAddress: AddressInfo;

function sendRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: serverAddress.port,
        path,
        method,
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
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

beforeAll(async () => {
  const express = await import('express');
  const app = express.default();
  app.use(express.default.json());
  app.use('/api/v1/gap', gapRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverAddress = server.address() as AddressInfo;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetDb.mockResolvedValue(
    fakeDb as unknown as Awaited<ReturnType<typeof getDb>>,
  );
  fakeDb.all.mockResolvedValue([]);
});

describe('/api/v1/gap routes', () => {
  test('validates and applies quarterly result filters', async () => {
    const response = await sendRequest('GET', '/api/v1/gap?state=MH&period=2026-Q4');
    expect(response.status).toBe(200);
    expect(fakeDb.all).toHaveBeenCalledWith(
      expect.stringContaining('d.state_id = ?'),
      ['MH', '2026-Q4'],
    );
  });

  test('rejects malformed quarter filters', async () => {
    const response = await sendRequest('GET', '/api/v1/gap?period=2026-04');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'INVALID_GAP_FILTERS' },
    });
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  test('rejects unsupported recompute body fields', async () => {
    const response = await sendRequest('POST', '/api/v1/gap/recompute', {
      district_id: 'D1',
      period: '2026-Q4',
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'INVALID_GAP_FILTERS' },
    });
    expect(mockedGetDb).not.toHaveBeenCalled();
  });
});
