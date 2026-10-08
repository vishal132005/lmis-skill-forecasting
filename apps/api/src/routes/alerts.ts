/**
 * Alerts routes – list, acknowledge, resolve.
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../database';

export const alertsRouter = Router();

alertsRouter.get('/', async (req: Request, res: Response) => {
  const db = await getDb();
  const { state, district, sector, type, status, limit: lim, offset } = req.query;
  const limitVal = Math.min(parseInt(lim as string) || 50, 200);
  const offsetVal = parseInt(offset as string) || 0;

  let whereClause = 'WHERE 1=1';
  const params: string[] = [];

  if (district) { whereClause += ' AND a.district_id = ?'; params.push(district as string); }
  else if (state) { whereClause += " AND a.district_id LIKE ? || '-%'"; params.push(state as string); }
  if (sector) { whereClause += " AND a.trade_id LIKE ? || '-%'"; params.push(sector as string); }
  if (type) { whereClause += ' AND a.type = ?'; params.push(type as string); }
  if (status) { whereClause += ' AND a.status = ?'; params.push(status as string); }

  const data = await db.all(`
    SELECT a.*, t.name as trade_name, t.sector_id, s.name as sector_name,
           d.name as district_name, d.state_id
    FROM alerts a
    JOIN trades t ON a.trade_id = t.id
    JOIN sectors s ON t.sector_id = s.id
    JOIN districts d ON a.district_id = d.id
    ${whereClause}
    ORDER BY
      CASE a.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
      a.created_at DESC
    LIMIT ${limitVal} OFFSET ${offsetVal}
  `, params);

  const total = await db.get(`SELECT COUNT(*) as c FROM alerts a ${whereClause}`, params) as { c: number };

  res.json({ data, total: total.c, limit: limitVal, offset: offsetVal });
});

alertsRouter.patch('/:id', async (req: Request, res: Response) => {
  const db = await getDb();
  const { status } = req.body;
  if (!['ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
    res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'Status must be ACKNOWLEDGED or RESOLVED' } });
    return;
  }
  const result = await db.run('UPDATE alerts SET status = ? WHERE id = ?', [status, req.params.id]);
  if (result.changes === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Alert not found' } });
    return;
  }
  const alert = await db.get('SELECT * FROM alerts WHERE id = ?', [req.params.id]);
  res.json({ data: alert });
});
