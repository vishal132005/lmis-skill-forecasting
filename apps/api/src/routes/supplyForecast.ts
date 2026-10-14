/**
 * Supply forecast routes – SFS-v1
 */
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getDb } from '../database';
import { runSupplyForecast, batchSupplyForecast } from '../services/supplyForecastService';

export const supplyForecastRouter = Router();

const singleSchema = z.object({
  district_id: z.string().trim().min(1),
  trade_id: z.string().trim().min(1),
  quarters: z.number().int().min(1).max(8).optional().default(4),
});

const batchSchema = z.object({
  state: z.string().trim().min(1).optional(),
  district_id: z.string().trim().min(1).optional(),
  sector: z.string().trim().min(1).optional(),
  trade_id: z.string().trim().min(1).optional(),
  quarters: z.number().int().min(1).max(8).optional().default(4),
});

/**
 * @openapi
 * /supply-forecast/run:
 *   post:
 *     summary: Run a supply forecast for a district-trade pair
 *     tags: [Supply Forecast]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [district_id, trade_id]
 *             properties:
 *               district_id: { type: string }
 *               trade_id: { type: string }
 *               quarters: { type: integer, minimum: 1, maximum: 8, default: 4 }
 *     responses:
 *       200: { description: Supply forecast result }
 *       400: { description: Invalid request }
 *       404: { description: District or trade not found }
 */
supplyForecastRouter.post('/run', async (req: Request, res: Response) => {
  const parsed = singleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_SUPPLY_FORECAST_REQUEST', message: parsed.error.message },
    });
    return;
  }
  try {
    const db = await getDb();
    const result = await runSupplyForecast(db, parsed.data.district_id, parsed.data.trade_id, parsed.data.quarters);
    res.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Supply forecast failed.';
    res.status(message.includes('not found') ? 404 : 500).json({
      error: { code: 'SUPPLY_FORECAST_ERROR', message },
    });
  }
});

/**
 * @openapi
 * /supply-forecast/batch:
 *   post:
 *     summary: Batch supply forecast for all pairs in scope
 *     tags: [Supply Forecast]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               state: { type: string }
 *               district_id: { type: string }
 *               sector: { type: string }
 *               trade_id: { type: string }
 *               quarters: { type: integer, minimum: 1, maximum: 8, default: 4 }
 *     responses:
 *       200: { description: Batch supply forecast results }
 */
supplyForecastRouter.post('/batch', async (req: Request, res: Response) => {
  const parsed = batchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_BATCH_REQUEST', message: parsed.error.message },
    });
    return;
  }
  const { quarters, ...filters } = parsed.data;
  const db = await getDb();
  const results = await batchSupplyForecast(db, filters, quarters);
  res.json({ data: results, total: results.length });
});
