import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { Activity, Users, AlertCircle, Briefcase, ChevronRight } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';

export const Dashboard = () => {
  const { data: overview, isLoading: isOverviewLoading, isError: isOverviewError, refetch: refetchOverview } = useQuery({
    queryKey: ['overview'],
    queryFn: () => apiClient.get('/overview'),
  });

  const { data: demandData, isLoading: isDemandLoading, isError: isDemandError, refetch: refetchDemand } = useQuery({
    queryKey: ['demand-supply'],
    queryFn: async () => {
      const res = await apiClient.get('/demand-supply');
      const data = Array.isArray(res.data) ? res.data : [];
      // Aggregate monthly data
      const aggregated = data.reduce((acc: any, curr: any) => {
        const month = curr.month;
        if (!acc[month]) {
          acc[month] = { month, demand: 0, supply: 0 };
        }
        acc[month].demand += (curr.avg_postings || 0) + (curr.avg_hires || 0);
        acc[month].supply += (curr.avg_workers || 0);
        return acc;
      }, {});
      return Object.values(aggregated).slice(-12) as any[];
    },
  });

  if (isOverviewLoading || isDemandLoading) {
    return (
      <div className="page-container animate-fade-in">
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>Loading intelligence...</div>
      </div>
    );
  }

  if (isOverviewError || isDemandError) {
    return <ErrorState message="Failed to load dashboard data." onRetry={() => { refetchOverview(); refetchDemand(); }} />;
  }

  const data = overview?.data;

  if (!data || !data.summary) {
    return <EmptyState message="No dashboard overview data available." />;
  }

  return (
    <div className="page-container animate-fade-in">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="title-xl text-gradient" style={{ marginBottom: '0.5rem' }}>National Overview</h1>
          <p className="text-secondary">Labour Market Intelligence System real-time insights</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <select className="glass-panel" style={{ padding: '0.5rem 1rem', color: 'white', background: 'var(--bg-card)', border: '1px solid var(--border-color)', outline: 'none' }}>
            <option>All Sectors</option>
            <option>Healthcare</option>
            <option>IT-ITeS</option>
            <option>Electronics</option>
            <option>Construction</option>
          </select>
          <button className="btn btn-primary">Run Forecast</button>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="grid-cards">
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span className="text-secondary font-medium">Critical Shortages</span>
            <div style={{ padding: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-md)', color: 'var(--status-shortage)' }}><Activity size={20} /></div>
          </div>
          <div className="title-xl">{data.summary.shortage_count || 0} <span className="text-sm text-muted">trades</span></div>
          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--status-shortage)' }}>
            <span style={{ fontWeight: 600 }}>+12%</span> <span className="text-muted">vs last quarter</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span className="text-secondary font-medium">Active Alerts</span>
            <div style={{ padding: '0.5rem', background: 'rgba(249, 115, 22, 0.1)', borderRadius: 'var(--radius-md)', color: 'var(--status-critical)' }}><AlertCircle size={20} /></div>
          </div>
          <div className="title-xl">{data.alerts?.active || 0} <span className="text-sm text-muted">anomalies</span></div>
          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
            <span className="text-muted">Requires immediate attention</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span className="text-secondary font-medium">Oversupplied Markets</span>
            <div style={{ padding: '0.5rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: 'var(--radius-md)', color: 'var(--status-oversupply)' }}><Users size={20} /></div>
          </div>
          <div className="title-xl">{data.summary.oversupply_count || 0} <span className="text-sm text-muted">districts</span></div>
          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--status-balanced)' }}>
            <span style={{ fontWeight: 600 }}>-5%</span> <span className="text-muted">vs last quarter</span>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* Chart */}
        <div className="glass-panel" style={{ padding: '1.5rem', gridColumn: 'span 1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 className="title-md">Demand vs Supply Trend</h3>
            <button className="btn btn-outline" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}>View Detail</button>
          </div>
          <div style={{ height: '300px' }}>
            {demandData && demandData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={demandData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorDemand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorSupply" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-tertiary)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent-tertiary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val/1000}k`} />
                  <Tooltip contentStyle={{ background: 'rgba(15,17,26,0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="demand" stroke="var(--accent-primary)" strokeWidth={3} fillOpacity={1} fill="url(#colorDemand)" name="Demand Signals" />
                  <Area type="monotone" dataKey="supply" stroke="var(--accent-tertiary)" strokeWidth={3} fillOpacity={1} fill="url(#colorSupply)" name="Workforce Supply" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No trend data available." />
            )}
          </div>
        </div>

        {/* Top Shortages List */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="title-md">Critical Shortages</h3>
            <span className="badge badge-shortage">High Priority</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
            {Array.isArray(data.topShortages) && data.topShortages.map((item: any, idx: number) => (
              <div key={idx} style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'var(--transition)' }} className="hover:bg-card-hover cursor-pointer">
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-sm)', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--status-shortage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Briefcase size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.trade_name}</div>
                    <div className="text-muted text-xs">{item.district_name}, {item.state_id}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontWeight: 700, color: 'var(--status-shortage)' }}>Gap: {item.demand_total - item.supply_total}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--accent-primary)', fontSize: '0.75rem', marginTop: '0.25rem', cursor: 'pointer' }}>
                    Intervene <ChevronRight size={14} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
