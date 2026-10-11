import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowUpRight } from 'lucide-react';
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
          <h2 className="welcome-title">Labour market overview</h2>
          <p className="text-secondary">Synthetic labour signals and their source context.</p>
        </div>
        <span className="period-chip">{latestPeriod ? `Source period · ${latestPeriod}` : 'Period unavailable'}</span>
      </section>

      <section className="overview-metrics" aria-label="Summary indicators">
        <Link to="/analytics" className="overview-metric">
          <span className="eyebrow">LABOUR DEMAND INDEX · LDI-v1</span>
          <strong>{ldiQuery.isPending && latestPeriod ? '—' : averageLdi === null ? 'N/A' : averageLdi.toFixed(1)}<small> / 100</small></strong>
          <span className="overview-metric-detail">
            {ldiQuery.isError
              ? 'Index signals temporarily unavailable.'
              : ldiQuery.isPending && latestPeriod
                ? 'Calculating from available demand signals.'
                : !latestPeriod
                  ? 'No demand signal period is available.'
                  : averageLdi === null
                    ? 'No valid direct-demand observations.'
                    : `Mean of ${ldiRecords.length} district–trade scores · ${latestPeriod}.`}
          </span>
          <span className="overview-metric-link">Inspect index <ArrowUpRight size={14} /></span>
        </Link>
        <Link to="/analytics" className="overview-metric">
          <span className="eyebrow">SHORTAGE PAIRS</span>
          <strong>{overview.summary.shortage_count ?? '—'}</strong>
          <span className="overview-metric-detail">Trade–district pairs identified as shortages in the current summary.</span>
          <span className="overview-metric-link">Explore districts <ArrowUpRight size={14} /></span>
        </Link>
        <Link to="/alerts" className="overview-metric">
          <span className="eyebrow">ACTIVE ALERTS</span>
          <strong>{overview.alerts?.active ?? '—'}</strong>
          <span className="overview-metric-detail">Active demonstration alerts in the current summary.</span>
          <span className="overview-metric-link">Review alerts <ArrowUpRight size={14} /></span>
        </Link>
      </section>

      <div className="overview-content-grid">
        <section className="surface section-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">DIRECT DEMAND SIGNALS</p>
              <h2>Postings &amp; industry hiring</h2>
              <small className="chart-context">Monthly aggregated counts · synthetic demonstration records</small>
            </div>
            <Link to="/forecasts" className="quiet-link">Forecast <ArrowUpRight size={15} /></Link>
          </div>
          {signalsQuery.data?.length ? (
            <>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={signalsQuery.data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="month" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={22} />
                    <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
                    <Area type="monotone" dataKey="postings" name="Job postings" stroke="var(--accent)" strokeWidth={2} fill="var(--accent)" fillOpacity={0.1} />
                    <Area type="monotone" dataKey="hiring" name="Industry hires" stroke="var(--oversupply)" strokeWidth={2} fill="var(--oversupply)" fillOpacity={0.1} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-legend">
                <span><i className="legend-dot legend-postings" /> Job postings</span>
                <span><i className="legend-dot legend-hiring" /> Industry hiring</span>
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
      </div>

      <p className="data-disclosure"><Activity size={14} /> All figures shown here derive from synthetic demonstration records; they are not live labour-market statistics.</p>
    </div>
  );
};
