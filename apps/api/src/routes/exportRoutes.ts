/**
 * Export routes – CSV/JSON export of targets and data.
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../database';

export const exportRouter = Router();

exportRouter.get('/export/targets', async (req: Request, res: Response) => {
  const db = await getDb();
  const { format } = req.query;
  const fmt = (format as string) || 'json';

  // Generate target recommendations
  const data = await db.all(`
    SELECT g.district_id, d.name as district_name, d.state_id, st.name as state_name,
           g.trade_id, t.name as trade_name, t.sector_id, s.name as sector_name,
           g.demand_total, g.supply_total, g.severity_score, g.category,
           tc.sanctioned_seats as current_seats, tc.enrolled, tc.certified, tc.placed
    FROM gap_scores g
    JOIN districts d ON g.district_id = d.id
    JOIN states st ON d.state_id = st.id
    JOIN trades t ON g.trade_id = t.id
    JOIN sectors s ON t.sector_id = s.id
    LEFT JOIN training_capacity tc ON g.district_id = tc.district_id AND g.trade_id = tc.trade_id AND tc.year = 2026
    ORDER BY g.severity_score DESC
  `) as Array<Record<string, number | string>>;

  // Add recommended seats column
  const withRecommendations = data.map((row) => {
    const current = (row.current_seats as number) || 0;
    const demand = row.demand_total as number;
    const supply = row.supply_total as number;
    const gap = demand - supply;
    let recommendedChange = 0;

    if (row.category === 'SHORTAGE') {
      recommendedChange = Math.min(Math.round(gap * 0.5), Math.round(current * 0.5)); // max +50%
    } else if (row.category === 'OVERSUPPLY') {
      recommendedChange = Math.max(Math.round(gap * 0.3), Math.round(-current * 0.3)); // max -30%
    }

    return {
      ...row,
      recommended_seats: Math.max(0, current + recommendedChange),
      recommended_change: recommendedChange,
      recommended_change_pct: current > 0 ? Math.round((recommendedChange / current) * 100) : 0,
    };
  });

  if (fmt === 'csv') {
    const headers = Object.keys(withRecommendations[0] || {});
    const csvRows = [headers.join(',')];
    for (const row of withRecommendations) {
      csvRows.push(headers.map(h => {
        const val = (row as any)[h];
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : String(val ?? '');
      }).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=lmis-targets.csv');
    res.send(csvRows.join('\n'));
  } else {
    res.json({ data: withRecommendations, total: withRecommendations.length, generated_at: new Date().toISOString() });
  }
});
