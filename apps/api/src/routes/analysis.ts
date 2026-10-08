/**
 * Analysis routes – gap heatmap data, aggregations for charts.
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../database';

export const analysisRouter = Router();

// Gap heatmap: districts x trades matrix
analysisRouter.get('/gaps/heatmap', async (req: Request, res: Response) => {
  const db = await getDb();
  const { state, sector } = req.query;

  let whereClause = 'WHERE 1=1';
  const params: string[] = [];
  if (state) { whereClause += " AND d.state_id = ?"; params.push(state as string); }
  if (sector) { whereClause += " AND t.sector_id = ?"; params.push(sector as string); }

  const data = await db.all(`
    SELECT g.district_id, g.trade_id, g.severity_score, g.category,
           g.demand_total, g.supply_total,
           d.name as district_name, d.state_id,
           t.name as trade_name, t.sector_id
    FROM gap_scores g
    JOIN districts d ON g.district_id = d.id
    JOIN trades t ON g.trade_id = t.id
    ${whereClause}
    ORDER BY d.name, t.name
  `, params);

  // Get unique districts and trades for axis labels
  const districtSet = new Map<string, string>();
  const tradeSet = new Map<string, string>();
  for (const row of data as Array<Record<string, string>>) {
    districtSet.set(row.district_id, row.district_name);
    tradeSet.set(row.trade_id, row.trade_name);
  }

  res.json({
    data,
    axes: {
      districts: Array.from(districtSet, ([id, name]) => ({ id, name })),
      trades: Array.from(tradeSet, ([id, name]) => ({ id, name })),
    },
  });
});

// Sector-level aggregation
analysisRouter.get('/sectors/summary', async (req: Request, res: Response) => {
  const db = await getDb();
  const { state } = req.query;

  let whereClause = '';
  const params: string[] = [];
  if (state) { whereClause = "WHERE d.state_id = ?"; params.push(state as string); }

  const data = await db.all(`
    SELECT
      s.id as sector_id, s.name as sector_name, s.color,
      COUNT(*) as pairs,
      ROUND(AVG(g.demand_total), 0) as avg_demand,
      ROUND(AVG(g.supply_total), 0) as avg_supply,
      ROUND(AVG(g.severity_score), 1) as avg_severity,
      SUM(CASE WHEN g.category = 'SHORTAGE' THEN 1 ELSE 0 END) as shortage_count,
      SUM(CASE WHEN g.category = 'OVERSUPPLY' THEN 1 ELSE 0 END) as oversupply_count,
      SUM(CASE WHEN g.category = 'BALANCED' THEN 1 ELSE 0 END) as balanced_count
    FROM gap_scores g
    JOIN trades t ON g.trade_id = t.id
    JOIN sectors s ON t.sector_id = s.id
    JOIN districts d ON g.district_id = d.id
    ${whereClause}
    GROUP BY s.id
    ORDER BY avg_severity DESC
  `, params);

  res.json({ data });
});

// State-level aggregation
analysisRouter.get('/states/summary', async (_req: Request, res: Response) => {
  const db = await getDb();
  const data = await db.all(`
    SELECT
      st.id as state_id, st.name as state_name, st.lat, st.lng,
      COUNT(*) as pairs,
      ROUND(AVG(g.demand_total), 0) as avg_demand,
      ROUND(AVG(g.supply_total), 0) as avg_supply,
      ROUND(AVG(g.severity_score), 1) as avg_severity,
      SUM(CASE WHEN g.category = 'SHORTAGE' THEN 1 ELSE 0 END) as shortage_count,
      SUM(CASE WHEN g.category = 'OVERSUPPLY' THEN 1 ELSE 0 END) as oversupply_count,
      (SELECT COUNT(*) FROM alerts a JOIN districts d2 ON a.district_id = d2.id
       WHERE d2.state_id = st.id AND a.status = 'ACTIVE') as active_alerts
    FROM gap_scores g
    JOIN districts d ON g.district_id = d.id
    JOIN states st ON d.state_id = st.id
    GROUP BY st.id
  `);

  res.json({ data });
});

// District-level aggregation
analysisRouter.get('/districts/summary', async (req: Request, res: Response) => {
  const db = await getDb();
  const { state } = req.query;

  let whereClause = '';
  const params: string[] = [];
  if (state) { whereClause = 'WHERE d.state_id = ?'; params.push(state as string); }

  const data = await db.all(`
    SELECT
      d.id as district_id, d.name as district_name, d.state_id, d.lat, d.lng,
      COUNT(*) as pairs,
      ROUND(AVG(g.demand_total), 0) as avg_demand,
      ROUND(AVG(g.supply_total), 0) as avg_supply,
      ROUND(AVG(g.severity_score), 1) as avg_severity,
      SUM(CASE WHEN g.category = 'SHORTAGE' THEN 1 ELSE 0 END) as shortage_count,
      SUM(CASE WHEN g.category = 'OVERSUPPLY' THEN 1 ELSE 0 END) as oversupply_count,
      (SELECT COUNT(*) FROM alerts a WHERE a.district_id = d.id AND a.status = 'ACTIVE') as active_alerts
    FROM gap_scores g
    JOIN districts d ON g.district_id = d.id
    ${whereClause}
    GROUP BY d.id
    ORDER BY avg_severity DESC
  `, params);

  res.json({ data });
});
