/**
 * Data routes – sectors, trades, demand-supply, training capacity, forecasts, overview.
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../database';

export const dataRouter = Router();

// ─── Sectors & Trades ─────────────────────────────────────────

dataRouter.get('/sectors', async (_req: Request, res: Response) => {
  const db = await getDb();
  res.json({ data: await db.all('SELECT * FROM sectors ORDER BY name') });
});

dataRouter.get('/trades', async (req: Request, res: Response) => {
  const db = await getDb();
  const { sector } = req.query;
  if (sector) {
    res.json({ data: await db.all('SELECT t.*, s.name as sector_name FROM trades t JOIN sectors s ON t.sector_id = s.id WHERE t.sector_id = ? ORDER BY t.name', [sector]) });
  } else {
    res.json({ data: await db.all('SELECT t.*, s.name as sector_name FROM trades t JOIN sectors s ON t.sector_id = s.id ORDER BY s.name, t.name') });
  }
});

// ─── Overview KPIs ────────────────────────────────────────────

dataRouter.get('/overview', async (req: Request, res: Response) => {
  const db = await getDb();
  const { level, id, state, sector } = req.query;

  let whereClause = '';
  const params: string[] = [];

  if (level === 'state' && id) {
    whereClause = "WHERE g.district_id LIKE ? || '%'";
    params.push(id as string);
  } else if (level === 'district' && id) {
    whereClause = 'WHERE g.district_id = ?';
    params.push(id as string);
  } else if (state) {
    whereClause = "WHERE g.district_id LIKE ? || '-%'";
    params.push(state as string);
  }

  if (sector) {
    const sectorPrefix = sector as string;
    whereClause += (whereClause ? ' AND ' : 'WHERE ') + "g.trade_id LIKE ? || '-%'";
    params.push(sectorPrefix);
  }

  const gapSummary = await db.get(`
    SELECT
      COUNT(*) as total_pairs,
      SUM(CASE WHEN category = 'SHORTAGE' THEN 1 ELSE 0 END) as shortage_count,
      SUM(CASE WHEN category = 'OVERSUPPLY' THEN 1 ELSE 0 END) as oversupply_count,
      SUM(CASE WHEN category = 'BALANCED' THEN 1 ELSE 0 END) as balanced_count,
      ROUND(AVG(demand_total), 0) as avg_demand,
      ROUND(AVG(supply_total), 0) as avg_supply,
      ROUND(AVG(severity_score), 1) as avg_severity
    FROM gap_scores g ${whereClause}
  `, params) as Record<string, number>;

  const alertCount = await db.get(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) as critical
    FROM alerts a ${whereClause.replace(/g\./g, 'a.')}
  `, params) as Record<string, number>;

  const queryParams = [...params];
  const topShortages = await db.all(`
    SELECT g.*, t.name as trade_name, t.sector_id, d.name as district_name, d.state_id
    FROM gap_scores g
    JOIN trades t ON g.trade_id = t.id
    JOIN districts d ON g.district_id = d.id
    ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} g.category = 'SHORTAGE'
    ORDER BY g.severity_score DESC LIMIT 5
  `, queryParams);

  const topOversupply = await db.all(`
    SELECT g.*, t.name as trade_name, t.sector_id, d.name as district_name, d.state_id
    FROM gap_scores g
    JOIN trades t ON g.trade_id = t.id
    JOIN districts d ON g.district_id = d.id
    ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} g.category = 'OVERSUPPLY'
    ORDER BY g.severity_score DESC LIMIT 5
  `, queryParams);

  res.json({
    data: {
      summary: gapSummary,
      alerts: alertCount,
      topShortages,
      topOversupply,
      statesCount: 3,
      districtsCount: 24,
      tradesCount: 20,
      sectorsCount: 4,
    },
  });
});

// ─── Demand-Supply Time Series ────────────────────────────────

dataRouter.get('/demand-supply', async (req: Request, res: Response) => {
  const db = await getDb();
  const { state, district, sector, trade, from, to } = req.query;

  let whereClause = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (district) {
    whereClause += ' AND di.district_id = ?';
    params.push(district as string);
  } else if (state) {
    whereClause += " AND di.district_id LIKE ? || '-%'";
    params.push(state as string);
  }
  if (trade) {
    whereClause += ' AND di.trade_id = ?';
    params.push(trade as string);
  } else if (sector) {
    whereClause += " AND di.trade_id LIKE ? || '-%'";
    params.push(sector as string);
  }
  if (from) { whereClause += ' AND di.month >= ?'; params.push(from as string); }
  if (to) { whereClause += ' AND di.month <= ?'; params.push(to as string); }

  const data = await db.all(`
    SELECT
      di.month,
      ROUND(AVG(di.index_value), 1) as demand_index,
      ROUND(AVG(jp.postings_count), 0) as avg_postings,
      ROUND(AVG(ih.hires), 0) as avg_hires,
      ROUND(AVG(es.registered_workers), 0) as avg_workers,
      di.district_id,
      di.trade_id
    FROM demand_indices di
    LEFT JOIN job_posting_signals jp ON di.district_id = jp.district_id AND di.trade_id = jp.trade_id AND di.month = jp.month
    LEFT JOIN industry_hiring_signals ih ON di.district_id = ih.district_id AND di.trade_id = ih.trade_id AND di.month = ih.month
    LEFT JOIN eshram_signals es ON di.district_id = es.district_id AND di.trade_id = es.trade_id AND di.month = es.month
    ${whereClause}
    GROUP BY di.month, di.district_id, di.trade_id
    ORDER BY di.month
  `, params);

  res.json({ data, total: data.length });
});

// ─── Forecasts ────────────────────────────────────────────────

dataRouter.get('/forecasts', async (req: Request, res: Response) => {
  const db = await getDb();
  const { state, district, sector, trade } = req.query;

  let whereClause = 'WHERE 1=1';
  const params: string[] = [];

  if (district) { whereClause += ' AND f.district_id = ?'; params.push(district as string); }
  else if (state) { whereClause += " AND f.district_id LIKE ? || '-%'"; params.push(state as string); }
  if (trade) { whereClause += ' AND f.trade_id = ?'; params.push(trade as string); }
  else if (sector) { whereClause += " AND f.trade_id LIKE ? || '-%'"; params.push(sector as string); }

  const data = await db.all(`
    SELECT f.*, t.name as trade_name, d.name as district_name
    FROM forecasts f
    JOIN trades t ON f.trade_id = t.id
    JOIN districts d ON f.district_id = d.id
    ${whereClause}
    ORDER BY f.horizon_month
    LIMIT 500
  `, params);

  res.json({ data, total: data.length });
});

// ─── Gap Rankings ─────────────────────────────────────────────

dataRouter.get('/gaps/rankings', async (req: Request, res: Response) => {
  const db = await getDb();
  const { sector, type, limit: lim, state, district } = req.query;
  const limitVal = Math.min(parseInt(lim as string) || 50, 200);

  let whereClause = 'WHERE 1=1';
  const params: string[] = [];

  if (type === 'shortage') { whereClause += " AND g.category = 'SHORTAGE'"; }
  else if (type === 'oversupply') { whereClause += " AND g.category = 'OVERSUPPLY'"; }
  if (sector) { whereClause += " AND t.sector_id = ?"; params.push(sector as string); }
  if (state) { whereClause += " AND d.state_id = ?"; params.push(state as string); }
  if (district) { whereClause += " AND g.district_id = ?"; params.push(district as string); }

  const data = await db.all(`
    SELECT g.*, t.name as trade_name, t.sector_id, s.name as sector_name,
           d.name as district_name, d.state_id, st.name as state_name
    FROM gap_scores g
    JOIN trades t ON g.trade_id = t.id
    JOIN sectors s ON t.sector_id = s.id
    JOIN districts d ON g.district_id = d.id
    JOIN states st ON d.state_id = st.id
    ${whereClause}
    ORDER BY g.severity_score DESC
    LIMIT ${limitVal}
  `, params);

  res.json({ data, total: data.length });
});

// ─── Training Capacity ───────────────────────────────────────

dataRouter.get('/training', async (req: Request, res: Response) => {
  const db = await getDb();
  const { state, district, trade, sector, year } = req.query;

  let whereClause = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (district) { whereClause += ' AND tc.district_id = ?'; params.push(district as string); }
  else if (state) { whereClause += " AND tc.district_id LIKE ? || '-%'"; params.push(state as string); }
  if (trade) { whereClause += ' AND tc.trade_id = ?'; params.push(trade as string); }
  else if (sector) { whereClause += " AND tc.trade_id LIKE ? || '-%'"; params.push(sector as string); }
  if (year) { whereClause += ' AND tc.year = ?'; params.push(parseInt(year as string)); }

  const data = await db.all(`
    SELECT tc.*, t.name as trade_name, t.sector_id, d.name as district_name, d.state_id
    FROM training_capacity tc
    JOIN trades t ON tc.trade_id = t.id
    JOIN districts d ON tc.district_id = d.id
    ${whereClause}
    ORDER BY tc.year DESC, d.name, t.name
    LIMIT 500
  `, params);

  res.json({ data, total: data.length });
});

// ─── Simulate (What-If) ──────────────────────────────────────

dataRouter.post('/simulate', async (req: Request, res: Response) => {
  const { district_id, trade_id, new_seats } = req.body;
  const db = await getDb();

  const gap = await db.get('SELECT * FROM gap_scores WHERE district_id = ? AND trade_id = ?', [district_id, trade_id]) as Record<string, number> | undefined;

  if (!gap) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Gap data not found for this pair' } });
    return;
  }

  const currentSupply = gap.supply_total;
  const currentDemand = gap.demand_total;
  const newSupply = Math.round(new_seats * 0.7); // Assume 70% completion
  const newGap = currentDemand - newSupply;
  const newRatio = currentDemand / Math.max(newSupply, 1);
  let newCategory: string;
  let newSeverity: number;

  if (newRatio > 1.3) { newCategory = 'SHORTAGE'; newSeverity = Math.min(100, Math.round((newRatio - 1) * 70)); }
  else if (newRatio < 0.7) { newCategory = 'OVERSUPPLY'; newSeverity = Math.min(100, Math.round((1 / newRatio - 1) * 70)); }
  else { newCategory = 'BALANCED'; newSeverity = Math.round(Math.abs(newRatio - 1) * 50); }

  res.json({
    data: {
      district_id, trade_id,
      current: { demand: currentDemand, supply: currentSupply, gap: currentDemand - currentSupply, category: gap.category, severity: gap.severity_score },
      simulated: { new_seats, effective_supply: newSupply, gap: newGap, category: newCategory, severity: newSeverity },
      change: { supply_delta: newSupply - currentSupply, gap_delta: newGap - (currentDemand - currentSupply), severity_delta: newSeverity - gap.severity_score },
    },
  });
});
