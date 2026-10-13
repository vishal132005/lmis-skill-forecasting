/**
 * Alerts routes – list, acknowledge, resolve.
 *
 * Filters supported: type, status, state, district_id, trade_id, sector
 * New fields returned: explanation, drivers, quarters_to_breach, breach_period,
 *                      gap_ratio, dedupe_key, updated_at
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../database';
import { ALERT_TYPES } from '../config/alertConfig';

export const alertsRouter = Router();

const ALERT_STATUSES = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'AUTO_RESOLVED'] as const;

const listQuerySchema = z
  .object({
    type:        z.enum(ALERT_TYPES).optional(),
    status:      z.enum(ALERT_STATUSES).optional(),
    state:       z.string().trim().min(1).max(10).optional(),
    district_id: z.string().trim().min(1).max(50).optional(),
    trade_id:    z.string().trim().min(1).max(50).optional(),
    sector:      z.string().trim().min(1).max(20).optional(),
    limit:       z.coerce.number().int().min(1).max(200).default(50),
    offset:      z.coerce.number().int().min(0).default(0),
  })
  .strict();

/**
 * @openapi
 * /alerts:
 *   get:
 *     summary: List alerts with optional filters
 *     parameters:
 *       - { in: query, name: type,        schema: { type: string, enum: [ACUTE_SHORTAGE,EMERGING_SHORTAGE,APPROACHING_SATURATION,OVERSUPPLY,DEMAND_SPIKE] } }
 *       - { in: query, name: status,      schema: { type: string, enum: [ACTIVE,ACKNOWLEDGED,RESOLVED,AUTO_RESOLVED] } }
 *       - { in: query, name: state,       schema: { type: string } }
 *       - { in: query, name: district_id, schema: { type: string } }
 *       - { in: query, name: trade_id,    schema: { type: string } }
 *       - { in: query, name: sector,      schema: { type: string } }
 *       - { in: query, name: limit,       schema: { type: integer, default: 50 } }
 *       - { in: query, name: offset,      schema: { type: integer, default: 0 } }
 *     responses:
 *       200:
 *         description: List of alerts with metadata.
 *       400:
 *         description: Invalid filter parameters.
 */
alertsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_ALERT_FILTERS',
        message: 'Invalid filter parameters. Check type, status, or string lengths.',
        details: parsed.error.flatten().fieldErrors,
      },
    });
    return;
  }

  const { type, status, state, district_id, trade_id, sector, limit: limitVal, offset: offsetVal } = parsed.data;
  const db = await getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (district_id) { conditions.push('a.district_id = ?'); params.push(district_id); }
  else if (state)  { conditions.push("d.state_id = ?");   params.push(state); }

  if (trade_id) { conditions.push('a.trade_id = ?');   params.push(trade_id); }
  else if (sector) { conditions.push('t.sector_id = ?'); params.push(sector); }

  if (type)   { conditions.push('a.type = ?');   params.push(type); }
  if (status) { conditions.push('a.status = ?'); params.push(status); }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const data = await db.all(
    `SELECT
       a.id, a.type, a.severity, a.status,
       a.explanation, a.drivers, a.reason,
       a.quarters_to_breach, a.breach_period, a.gap_ratio,
       a.dedupe_key, a.created_at, a.updated_at,
       a.district_id, d.name AS district_name, d.state_id,
       a.trade_id, t.name AS trade_name, t.sector_id, s.name AS sector_name
     FROM alerts a
     JOIN trades t ON a.trade_id = t.id
     JOIN sectors s ON t.sector_id = s.id
     JOIN districts d ON a.district_id = d.id
     ${whereClause}
     ORDER BY
       CASE a.severity
         WHEN 'CRITICAL' THEN 1 WHEN 'SEVERE' THEN 2
         WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 4 ELSE 5
       END,
       a.created_at DESC
     LIMIT ${limitVal} OFFSET ${offsetVal}`,
    params,
  );

  // Parse drivers JSON field for each row
  const enriched = (data as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    drivers: row.drivers ? (() => { try { return JSON.parse(row.drivers as string); } catch { return null; } })() : null,
  }));

  const total = (await db.get(
    `SELECT COUNT(*) AS c FROM alerts a
     JOIN districts d ON a.district_id = d.id
     JOIN trades t ON a.trade_id = t.id
     ${whereClause}`,
    params,
  )) as { c: number };

  res.json({ data: enriched, total: total.c, limit: limitVal, offset: offsetVal });
});

/**
 * @openapi
 * /alerts/{id}:
 *   patch:
 *     summary: Acknowledge or resolve an alert
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ACKNOWLEDGED, RESOLVED] }
 *     responses:
 *       200: { description: Updated alert. }
 *       400: { description: Invalid status value. }
 *       404: { description: Alert not found. }
 */
alertsRouter.patch('/:id', async (req: Request, res: Response) => {
  const { status } = req.body as { status?: string };
  if (!status || !['ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
    res.status(400).json({
      error: { code: 'INVALID_STATUS', message: 'Status must be ACKNOWLEDGED or RESOLVED.' },
    });
    return;
  }
  const db = await getDb();
  const result = await db.run(
    'UPDATE alerts SET status = ?, updated_at = ? WHERE id = ?',
    [status, new Date().toISOString(), req.params.id],
  );
  if (result.changes === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Alert not found.' } });
    return;
  }
  const alert = await db.get('SELECT * FROM alerts WHERE id = ?', [req.params.id]);
  res.json({ data: alert });
});
