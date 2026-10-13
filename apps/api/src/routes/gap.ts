import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getDb } from '../database';
import { getGapResults, getGapSummary, recomputeGaps } from '../services/gapService';
import { runAlertEngine } from '../services/alertEngine';

export const gapRouter = Router();

const districtFiltersSchema = z.object({
  state: z.string().trim().min(1).optional(),
  district_id: z.string().trim().min(1).optional(),
  trade_id: z.string().trim().min(1).optional(),
  sector: z.string().trim().min(1).optional(),
}).strict();

const resultsQuerySchema = districtFiltersSchema.extend({
  period: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
}).strict();

const summaryQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
}).strict();

/**
 * @openapi
 * /gap:
 *   get:
 *     summary: Retrieve stored district-trade quarterly demand-supply gaps
 *     description: Returns computed records only; recompute them with POST /api/v1/gap/recompute.
 *     parameters:
 *       - { in: query, name: state, schema: { type: string } }
 *       - { in: query, name: district_id, schema: { type: string } }
 *       - { in: query, name: trade_id, schema: { type: string } }
 *       - { in: query, name: sector, schema: { type: string } }
 *       - { in: query, name: period, schema: { type: string, pattern: '^\\d{4}-Q[1-4]$' } }
 *     responses:
 *       200:
 *         description: Stored gap rows and formula metadata.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data, methodology]
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       district_id: { type: string }
 *                       trade_id: { type: string }
 *                       period: { type: string, example: 2026-Q4 }
 *                       forecast_demand: { type: number, nullable: true }
 *                       demand_lower: { type: number, nullable: true }
 *                       demand_upper: { type: number, nullable: true }
 *                       sanctioned_seats: { type: number, nullable: true }
 *                       placement_rate: { type: number, nullable: true }
 *                       effective_supply: { type: number, nullable: true }
 *                       gap: { type: number, nullable: true }
 *                       gap_ratio: { type: number, nullable: true }
 *                       best_case_gap: { type: number, nullable: true }
 *                       worst_case_gap: { type: number, nullable: true }
 *                       status: { type: string, enum: [ACUTE_SHORTAGE, EMERGING_SHORTAGE, BALANCED, APPROACHING_SATURATION, OVERSUPPLY, INSUFFICIENT_DATA] }
 *                       reason: { type: string, nullable: true }
 *                 methodology: { type: object }
 *       400: { description: Invalid filters. }
 */
gapRouter.get('/', async (req: Request, res: Response) => {
  const parsed = resultsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_GAP_FILTERS',
        message: 'Filters must be non-empty strings and period must use YYYY-Q1 through YYYY-Q4.',
      },
    });
    return;
  }
  res.json(await getGapResults(await getDb(), parsed.data));
});

/**
 * @openapi
 * /gap/summary:
 *   get:
 *     summary: Summarize stored gap classifications nationally and by state
 *     parameters:
 *       - { in: query, name: period, schema: { type: string, pattern: '^\\d{4}-Q[1-4]$' } }
 *     responses:
 *       200:
 *         description: Status counts for all records or the selected quarter.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 period: { type: string, nullable: true }
 *                 national: { type: object, additionalProperties: { type: integer } }
 *                 states: { type: object, additionalProperties: { type: object, additionalProperties: { type: integer } } }
 *       400: { description: Invalid period. }
 */
gapRouter.get('/summary', async (req: Request, res: Response) => {
  const parsed = summaryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_GAP_FILTERS', message: 'period must use YYYY-Q1 through YYYY-Q4.' },
    });
    return;
  }
  res.json(await getGapSummary(await getDb(), parsed.data.period));
});

/**
 * @openapi
 * /gap/recompute:
 *   post:
 *     summary: Recompute quarterly gaps for all or a selected area
 *     description: Forecast failures and missing capacity or calibration data are persisted as INSUFFICIENT_DATA with a reason.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               state: { type: string }
 *               district_id: { type: string }
 *               trade_id: { type: string }
 *               sector: { type: string }
 *     responses:
 *       200:
 *         description: Number of computed and insufficient quarter records.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     computed: { type: integer }
 *                     insufficient: { type: integer }
 *       400: { description: Invalid filters. }
 */
gapRouter.post('/recompute', async (req: Request, res: Response) => {
  const parsed = districtFiltersSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_GAP_FILTERS',
        message: 'Optional filters must be non-empty strings.',
      },
    });
    return;
  }
  const db = await getDb();
  const gapResult = await recomputeGaps(db, parsed.data);
  // Run alert engine on the same scope immediately after gap recompute.
  // Non-fatal: if alertEngine throws, gap results are still returned.
  let alertResult: { created: number; updated: number; resolved: number } | null = null;
  try {
    alertResult = await runAlertEngine(db, parsed.data);
  } catch (alertErr) {
    console.error('Alert engine error (non-fatal):', alertErr);
  }
  res.json({ data: { ...gapResult, alerts: alertResult } });
});
