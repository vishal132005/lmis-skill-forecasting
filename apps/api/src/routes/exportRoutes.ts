/**
 * Export routes – CSV, JSON, and printable report export of planning targets, gaps, and alerts.
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
        const val = (row as Record<string, unknown>)[h];
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

/**
 * Export gap analysis results as CSV
 */
exportRouter.get('/export/gaps', async (req: Request, res: Response) => {
  const db = await getDb();
  const { state, period } = req.query;

  const conditions: string[] = ["g.status != 'INSUFFICIENT_DATA'"];
  const params: string[] = [];

  if (state && typeof state === 'string') {
    conditions.push('d.state_id = ?');
    params.push(state);
  }
  if (period && typeof period === 'string') {
    conditions.push('g.period = ?');
    params.push(period);
  }

  const rows = await db.all(`
    SELECT g.district_id, d.name AS district_name, d.state_id,
           g.trade_id, t.name AS trade_name, s.name AS sector_name,
           g.period, g.forecast_demand, g.effective_supply, g.gap, g.gap_ratio,
           g.status, g.best_case_gap, g.worst_case_gap
    FROM gap_results g
    JOIN districts d ON d.id = g.district_id
    JOIN trades t ON t.id = g.trade_id
    JOIN sectors s ON s.id = t.sector_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY g.period DESC, g.gap_ratio DESC
  `, params) as Array<Record<string, unknown>>;

  const headers = ['district_id', 'district_name', 'state_id', 'trade_id', 'trade_name', 'sector_name', 'period', 'forecast_demand', 'effective_supply', 'gap', 'gap_ratio', 'status', 'best_case_gap', 'worst_case_gap'];
  const csvRows = [headers.join(',')];
  for (const row of rows) {
    csvRows.push(headers.map(h => {
      const val = row[h];
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : String(val ?? '');
    }).join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=lmis-gap-analysis.csv');
  res.send(csvRows.join('\n'));
});

/**
 * Export early-warning alerts as CSV
 */
exportRouter.get('/export/alerts', async (_req: Request, res: Response) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT a.id, a.type, a.severity, a.status,
           a.district_id, d.name AS district_name,
           a.trade_id, t.name AS trade_name, s.name AS sector_name,
           a.gap_ratio, a.quarters_to_breach, a.breach_period, a.explanation, a.created_at
    FROM alerts a
    JOIN districts d ON d.id = a.district_id
    JOIN trades t ON t.id = a.trade_id
    JOIN sectors s ON s.id = t.sector_id
    ORDER BY a.severity ASC, a.created_at DESC
  `) as Array<Record<string, unknown>>;

  const headers = ['id', 'type', 'severity', 'status', 'district_id', 'district_name', 'trade_id', 'trade_name', 'sector_name', 'gap_ratio', 'quarters_to_breach', 'breach_period', 'created_at'];
  const csvRows = [headers.join(',')];
  for (const row of rows) {
    csvRows.push(headers.map(h => {
      const val = row[h];
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : String(val ?? '');
    }).join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=lmis-alerts.csv');
  res.send(csvRows.join('\n'));
});

/**
 * Export a printable executive HTML report (suitable for Ctrl+P / Save as PDF)
 */
exportRouter.get('/export/report', async (req: Request, res: Response) => {
  const db = await getDb();
  const stateId = (req.query.state as string) || '';

  const whereState = stateId ? 'WHERE d.state_id = ?' : '';
  const params = stateId ? [stateId] : [];

  const [topShortages, topOversupply, alertStats] = await Promise.all([
    db.all(`
      SELECT g.district_id, d.name AS district_name,
             g.trade_id, t.name AS trade_name, s.name AS sector_name,
             g.forecast_demand, g.effective_supply, g.gap, g.gap_ratio, g.status
      FROM gap_results g
      JOIN districts d ON d.id = g.district_id
      JOIN trades t ON t.id = g.trade_id
      JOIN sectors s ON s.id = t.sector_id
      ${whereState ? whereState + ' AND' : 'WHERE'} g.status IN ('ACUTE_SHORTAGE', 'EMERGING_SHORTAGE')
      ORDER BY g.gap_ratio DESC
      LIMIT 15
    `, params) as Promise<Array<Record<string, unknown>>>,
    db.all(`
      SELECT g.district_id, d.name AS district_name,
             g.trade_id, t.name AS trade_name, s.name AS sector_name,
             g.forecast_demand, g.effective_supply, g.gap, g.gap_ratio, g.status
      FROM gap_results g
      JOIN districts d ON d.id = g.district_id
      JOIN trades t ON t.id = g.trade_id
      JOIN sectors s ON s.id = t.sector_id
      ${whereState ? whereState + ' AND' : 'WHERE'} g.status = 'OVERSUPPLY'
      ORDER BY g.gap_ratio ASC
      LIMIT 10
    `, params) as Promise<Array<Record<string, unknown>>>,
    db.all(`
      SELECT a.severity, COUNT(*) as count
      FROM alerts a
      JOIN districts d ON d.id = a.district_id
      ${whereState}
      GROUP BY a.severity
    `, params) as Promise<Array<{ severity: string; count: number }>>,
  ]);

  const timestamp = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Labour Market Intelligence System — Executive Briefing</title>
  <style>
    @media print {
      body { font-size: 11pt; }
      .no-print { display: none; }
      .page-break { page-break-before: always; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      color: #111827;
      margin: 0;
      padding: 2.5rem;
      background: #fff;
    }
    .header {
      border-bottom: 3px solid #2563eb;
      padding-bottom: 1.25rem;
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .header h1 { margin: 0; font-size: 1.75rem; color: #1e3a8a; }
    .header p { margin: 0.25rem 0 0 0; color: #4b5563; font-size: 0.95rem; }
    .print-btn {
      background: #2563eb; color: #fff; border: none; padding: 0.6rem 1.2rem;
      font-weight: 600; border-radius: 6px; cursor: pointer;
    }
    .kpi-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem;
    }
    .kpi-box {
      border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; background: #f9fafb;
    }
    .kpi-box .val { font-size: 1.75rem; font-weight: 700; color: #1f2937; margin-top: 0.25rem; }
    .kpi-box .lbl { font-size: 0.8rem; text-transform: uppercase; color: #6b7280; font-weight: 600; }
    h2 { font-size: 1.25rem; color: #111827; margin-top: 1.75rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.9rem; }
    th, td { border: 1px solid #e5e7eb; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; color: #374151; }
    .badge-shortage { background: #fee2e2; color: #991b1b; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 600; font-size: 0.8rem; }
    .badge-oversupply { background: #ede9fe; color: #5b21b6; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 600; font-size: 0.8rem; }
    .footer { margin-top: 3rem; border-top: 1px solid #e5e7eb; padding-top: 1rem; font-size: 0.8rem; color: #6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>KaushalPulse — Labour Market Intelligence</h1>
      <p>District Skill-Gap & Early-Warning Executive Report ${stateId ? `• State: ${stateId}` : '• National Coverage'}</p>
    </div>
    <div class="no-print">
      <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi-box">
      <div class="lbl">Report Date</div>
      <div class="val" style="font-size: 1.1rem; padding-top: 0.35rem;">${timestamp}</div>
    </div>
    <div class="kpi-box">
      <div class="lbl">Critical / High Alerts</div>
      <div class="val" style="color: #dc2626;">${alertStats.reduce((acc, s) => acc + (['CRITICAL', 'SEVERE', 'HIGH'].includes(s.severity) ? s.count : 0), 0)}</div>
    </div>
    <div class="kpi-box">
      <div class="lbl">Priority Shortage Pairs</div>
      <div class="val" style="color: #ea580c;">${topShortages.length}</div>
    </div>
    <div class="kpi-box">
      <div class="lbl">Identified Saturation Pairs</div>
      <div class="val" style="color: #7c3aed;">${topOversupply.length}</div>
    </div>
  </div>

  <h2>Priority Skill Shortages Requiring Capacity Expansion</h2>
  <table>
    <thead>
      <tr>
        <th>District</th>
        <th>Trade / Occupation</th>
        <th>Sector</th>
        <th>Forecast Demand</th>
        <th>Effective Supply</th>
        <th>Shortage (Gap)</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${topShortages.map(r => `
        <tr>
          <td><strong>${r.district_name}</strong></td>
          <td>${r.trade_name}</td>
          <td>${r.sector_name}</td>
          <td>${r.forecast_demand}</td>
          <td>${r.effective_supply}</td>
          <td style="color: #dc2626; font-weight: 600;">+${r.gap} (${Math.round((Number(r.gap_ratio) || 0) * 100)}%)</td>
          <td><span class="badge-shortage">${String(r.status).replace('_', ' ')}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Identified Oversupply / Saturation Occupations</h2>
  <table>
    <thead>
      <tr>
        <th>District</th>
        <th>Trade / Occupation</th>
        <th>Sector</th>
        <th>Forecast Demand</th>
        <th>Effective Supply</th>
        <th>Excess Capacity</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${topOversupply.map(r => `
        <tr>
          <td><strong>${r.district_name}</strong></td>
          <td>${r.trade_name}</td>
          <td>${r.sector_name}</td>
          <td>${r.forecast_demand}</td>
          <td>${r.effective_supply}</td>
          <td style="color: #7c3aed; font-weight: 600;">${r.gap} (${Math.round((Number(r.gap_ratio) || 0) * 100)}%)</td>
          <td><span class="badge-oversupply">OVERSUPPLY</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p><strong>Methodology Note:</strong> Skill gap = forecast demand − effective supply. Effective supply is modeled from sanctioned training seats adjusted by historical placement rates. Demand projections use statistical and time-series extrapolation across multi-source labour market signals.</p>
    <p>Generated automatically by KaushalPulse LMIS Server. Confidential — for policy planning and training seat allocation use only.</p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});
