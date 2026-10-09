import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowUpRight, BriefcaseBusiness, ShieldAlert } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

interface SignalRow {
  month: string;
  avg_postings: number | null;
  avg_hires: number | null;
}

interface LdiRow {
  district_id: string;
  trade_id: string;
  period: string;
  demand_index: number | null;
  computation_status: 'computed' | 'insufficient_data';
}

export const Dashboard = () => {
  const overviewQuery = useQuery({
    queryKey: ['overview'],
    queryFn: () => apiClient.get('/overview'),
  });
  const signalsQuery = useQuery({
    queryKey: ['overview-signals'],
    queryFn: async () => {
      const response = await apiClient.get('/demand-supply');
      const rows: SignalRow[] = Array.isArray(response.data) ? response.data : [];
      const months = new Map<string, { month: string; postings: number; hiring: number }>();
      for (const row of rows) {
        const aggregate = months.get(row.month) ?? { month: row.month, postings: 0, hiring: 0 };
        aggregate.postings += row.avg_postings ?? 0;
        aggregate.hiring += row.avg_hires ?? 0;
        months.set(row.month, aggregate);
      }
      return Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
    },
  });
  const latestPeriod = signalsQuery.data?.at(-1)?.month;
  const ldiQuery = useQuery({
    queryKey: ['overview-ldi', latestPeriod],
    queryFn: async () => {
      const response = await apiClient.get(`/demand-index?period=${encodeURIComponent(latestPeriod!)}`);
      if (!Array.isArray(response.data)) {
        throw new Error('The demand-index endpoint returned an unexpected response.');
      }
      return response.data as LdiRow[];
    },
    enabled: Boolean(latestPeriod),
  });

  const overview = overviewQuery.data?.data;
  const retry = () => {
    void overviewQuery.refetch();
    void signalsQuery.refetch();
  };
  if (overviewQuery.isPending || signalsQuery.isPending) {
    return <div className="page-container"><div className="surface loading-state">Loading overview…</div></div>;
  }
  if (overviewQuery.isError || signalsQuery.isError) {
    return <ErrorState message="The overview could not be loaded." onRetry={retry} />;
  }
  if (!overview?.summary) return <EmptyState message="No overview data is available for this scope." />;

  const ldiRecords = ldiQuery.data?.filter((row) => row.computation_status === 'computed' && row.demand_index !== null) ?? [];
  const averageLdi = ldiRecords.length
    ? ldiRecords.reduce((total, row) => total + row.demand_index!, 0) / ldiRecords.length
    : null;
  const shortages = Array.isArray(overview.topShortages) ? overview.topShortages.slice(0, 3) : [];

  return (
    <div className="page-container animate-fade-in">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">NATIONAL OVERVIEW</p>
          <h2 className="welcome-title">Labour market, at a glance</h2>
          <p className="text-secondary">Explore synthetic labour signals and their source context.</p>
        </div>
        <span className="period-chip">{latestPeriod ? `Source period · ${latestPeriod}` : 'Period unavailable'}</span>
      </section>

      <Link to="/analytics" className="surface ldi-card">
        <div className="ldi-card-top">
          <div>
            <span className="eyebrow">LABOUR DEMAND INDEX</span>
            <span className="version-chip">LDI-v1 · PROVISIONAL</span>
          </div>
          <span className="round-action"><ArrowUpRight size={18} /></span>
        </div>
        <div className="ldi-main">
          <span className="ldi-score">{ldiQuery.isPending && latestPeriod ? '—' : averageLdi === null ? 'N/A' : averageLdi.toFixed(1)}</span>
          <span className="ldi-scale">/ 100</span>
        </div>
        <p className="ldi-caption">
          {ldiQuery.isError
            ? 'Index signals are temporarily unavailable. Open Explore to retry.'
            : ldiQuery.isPending && latestPeriod
              ? 'Calculating from available direct demand signals…'
              : !latestPeriod
                ? 'No demand signal periods are available to calculate an index.'
              : averageLdi === null
                ? 'No valid direct demand observations for this period.'
                : `Mean of ${ldiRecords.length} district–trade scores for ${latestPeriod}.`}
        </p>
        <div className="ldi-footer"><span>Job postings + industry hiring · synthetic inputs</span><span>Inspect signals <ArrowUpRight size={14} /></span></div>
      </Link>

      <section className="summary-grid" aria-label="Summary">
        <div className="surface summary-card">
          <span className="summary-icon icon-shortage"><BriefcaseBusiness size={18} /></span>
          <div className="summary-number">{overview.summary.shortage_count ?? '—'}</div>
          <div className="summary-label">Shortage trade–district pairs</div>
          <Link className="summary-link" to="/analytics">Explore districts <ArrowUpRight size={14} /></Link>
        </div>
        <div className="surface summary-card">
          <span className="summary-icon icon-alert"><ShieldAlert size={18} /></span>
          <div className="summary-number">{overview.alerts?.active ?? '—'}</div>
          <div className="summary-label">Active demonstration alerts</div>
          <Link className="summary-link" to="/alerts">Review alerts <ArrowUpRight size={14} /></Link>
        </div>
      </section>

      <section className="surface section-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DIRECT DEMAND SIGNALS</p>
            <h2>Postings &amp; industry hiring</h2>
          </div>
          <Link to="/forecasts" className="quiet-link">Forecast <ArrowUpRight size={15} /></Link>
        </div>
        {signalsQuery.data?.length ? (
          <>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={signalsQuery.data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="postingsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#9a85ff" stopOpacity={0.26} />
                      <stop offset="100%" stopColor="#9a85ff" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="hiringFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#31cbb0" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#31cbb0" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="rgba(255,255,255,.07)" />
                  <XAxis dataKey="month" tick={{ fill: '#8f98b0', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={22} />
                  <YAxis tick={{ fill: '#8f98b0', fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
                  <Tooltip contentStyle={{ background: '#171a27', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12 }} />
                  <Area type="monotone" dataKey="postings" name="Job postings" stroke="#9a85ff" strokeWidth={2} fill="url(#postingsFill)" />
                  <Area type="monotone" dataKey="hiring" name="Industry hires" stroke="#31cbb0" strokeWidth={2} fill="url(#hiringFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-legend">
              <span><i className="legend-dot legend-postings" /> Job postings</span>
              <span><i className="legend-dot legend-hiring" /> Industry hiring</span>
              <small>Aggregated counts · synthetic demo data</small>
            </div>
          </>
        ) : <div className="chart-empty">No demand signal records are available for a trend chart.</div>}
      </section>

      <section className="surface section-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PRIORITY SIGNALS</p>
            <h2>Highest-severity shortages</h2>
          </div>
          <Link to="/analytics" className="quiet-link">Explore <ArrowUpRight size={15} /></Link>
        </div>
        {shortages.length ? (
          <div className="priority-list">
            {shortages.map((item: Record<string, string | number>, index: number) => (
              <Link className="priority-item" to="/analytics" key={`${item.district_id}-${item.trade_id}-${index}`}>
                <span className="priority-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="priority-copy">
                  <strong>{item.trade_name}</strong>
                  <small>{item.district_name}, {item.state_id}</small>
                </span>
                <span className="priority-gap">Gap {Number(item.demand_total) - Number(item.supply_total)}<small>seeded estimate</small></span>
                <ArrowUpRight size={16} className="muted-icon" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="inline-empty"><AlertTriangle size={18} /> No shortage records were returned for this scope.</div>
        )}
      </section>

      <p className="data-disclosure"><Activity size={14} /> All figures shown here derive from synthetic demonstration records; they are not live labour-market statistics.</p>
    </div>
  );
};
