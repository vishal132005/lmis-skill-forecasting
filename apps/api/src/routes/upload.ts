/**
 * Data Upload Routes – accepts CSV data for signal tables.
 *
 * Supports:
 *   - job_posting_signals
 *   - industry_hiring_signals
 *   - eshram_signals
 *   - training_capacity
 */
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getDb } from '../database';

export const uploadRouter = Router();

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const jobPostingRowSchema = z.object({
  district_id: z.string().min(1),
  trade_id: z.string().min(1),
  month: z.string().regex(MONTH_PATTERN),
  postings_count: z.number().int().nonnegative(),
  source: z.string().optional(),
});

const industryHiringRowSchema = z.object({
  district_id: z.string().min(1),
  trade_id: z.string().min(1),
  month: z.string().regex(MONTH_PATTERN),
  hires: z.number().int().nonnegative(),
});

const eshramRowSchema = z.object({
  district_id: z.string().min(1),
  trade_id: z.string().min(1),
  month: z.string().regex(MONTH_PATTERN),
  registered_workers: z.number().int().nonnegative(),
});

const trainingCapacityRowSchema = z.object({
  district_id: z.string().min(1),
  trade_id: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  sanctioned_seats: z.number().int().nonnegative().optional(),
  enrolled: z.number().int().nonnegative().optional(),
  certified: z.number().int().nonnegative().optional(),
  placed: z.number().int().nonnegative().optional(),
  placement_rate: z.number().min(0).max(1).optional(),
  centres_count: z.number().int().nonnegative().optional(),
});

type TableName = 'job_posting_signals' | 'industry_hiring_signals' | 'eshram_signals' | 'training_capacity';

const TABLE_SCHEMAS: Record<TableName, z.ZodSchema> = {
  job_posting_signals: jobPostingRowSchema,
  industry_hiring_signals: industryHiringRowSchema,
  eshram_signals: eshramRowSchema,
  training_capacity: trainingCapacityRowSchema,
};

function parseCsv(csvText: string): Record<string, string | number>[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"/, '').replace(/"$/, ''));
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"/, '').replace(/"$/, ''));
    const row: Record<string, string | number> = {};
    for (let i = 0; i < headers.length; i++) {
      const val = values[i] ?? '';
      const num = Number(val);
      row[headers[i]] = val !== '' && !isNaN(num) ? num : val;
    }
    return row;
  });
}

/**
 * @openapi
 * /data/upload:
 *   post:
 *     summary: Upload data as JSON or CSV to a signal table
 *     tags: [Data Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [table, rows]
 *             properties:
 *               table: { type: string, enum: [job_posting_signals, industry_hiring_signals, eshram_signals, training_capacity] }
 *               rows: { type: array, items: { type: object } }
 *               mode: { type: string, enum: [append, replace], default: append }
 *     responses:
 *       200: { description: Upload result with inserted/rejected counts }
 *       400: { description: Invalid request }
 */
uploadRouter.post('/upload', async (req: Request, res: Response) => {
  const { table, rows, csv, mode } = req.body ?? {};

  if (!table || !TABLE_SCHEMAS[table as TableName]) {
    res.status(400).json({
      error: {
        code: 'INVALID_TABLE',
        message: `table must be one of: ${Object.keys(TABLE_SCHEMAS).join(', ')}`,
      },
    });
    return;
  }

  const schema = TABLE_SCHEMAS[table as TableName];
  let inputRows: Record<string, unknown>[];

  if (csv && typeof csv === 'string') {
    inputRows = parseCsv(csv);
  } else if (Array.isArray(rows)) {
    inputRows = rows;
  } else {
    res.status(400).json({
      error: { code: 'MISSING_DATA', message: 'Provide either "rows" (array) or "csv" (string).' },
    });
    return;
  }

  if (inputRows.length === 0) {
    res.status(400).json({ error: { code: 'EMPTY_DATA', message: 'No data rows provided.' } });
    return;
  }
  if (inputRows.length > 10000) {
    res.status(400).json({ error: { code: 'TOO_MANY_ROWS', message: 'Maximum 10,000 rows per upload.' } });
    return;
  }

  const db = await getDb();
  let inserted = 0;
  const rejected: { index: number; reason: string }[] = [];

  // Optional: clear existing data for replace mode
  if (mode === 'replace') {
    await db.run(`DELETE FROM ${table}`);
  }

  for (let i = 0; i < inputRows.length; i++) {
    const parsed = schema.safeParse(inputRows[i]);
    if (!parsed.success) {
      rejected.push({ index: i, reason: parsed.error.issues[0]?.message ?? 'Validation failed' });
      continue;
    }

    const data = parsed.data as Record<string, unknown>;
    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((col) => data[col]);

    try {
      await db.run(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
      );
      inserted++;
    } catch (err) {
      rejected.push({ index: i, reason: err instanceof Error ? err.message : 'Insert failed' });
    }
  }

  res.json({
    data: {
      table,
      mode: mode ?? 'append',
      total_rows: inputRows.length,
      inserted,
      rejected_count: rejected.length,
      rejected: rejected.slice(0, 50), // Limit error details
    },
  });
});

/**
 * @openapi
 * /data/tables:
 *   get:
 *     summary: List available upload tables and their schemas
 *     tags: [Data Upload]
 *     responses:
 *       200: { description: Available tables with column info }
 */
uploadRouter.get('/tables', async (_req: Request, res: Response) => {
  const db = await getDb();
  const tables: Record<string, unknown[]> = {};
  for (const tableName of Object.keys(TABLE_SCHEMAS)) {
    const columns = await db.all(`PRAGMA table_info(${tableName})`) as Array<{ name: string; type: string; notnull: number }>;
    tables[tableName] = columns.map((col) => ({
      name: col.name,
      type: col.type,
      required: col.notnull === 1,
    }));
  }
  res.json({ data: tables });
});
