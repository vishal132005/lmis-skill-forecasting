import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Sparkles, Filter, Download, ArrowUpRight, ArrowDownRight, 
  PlusCircle, RefreshCw, Layers
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

interface StateRecord { id: string; name: string; }
interface DistrictRecord { id: string; name: string; state_id: string; }
interface SectorRecord { id: string; name: string; }

type RecommendationType =
  | 'INCREASE_SEATS'
  | 'REDUCE_SEATS'
  | 'NEW_COURSE'
  | 'PRIORITIZE_CENTRE'
  | 'REVISE_CURRICULUM'
  | 'MONITOR';

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface Recommendation {
  id: string;
  district_id: string;
  district_name: string;
  state_id: string;
  trade_id: string;
  trade_name: string;
  sector_id: string;
  sector_name: string;
  type: RecommendationType;
  priority: Priority;
  title: string;
  description: string;
  rationale: string;
  expected_impact: string;
  metrics: {
    current_seats: number | null;
    recommended_seats: number | null;
    seat_change: number | null;
    seat_change_pct: number | null;
    forecast_demand: number | null;
    effective_supply: number | null;
    gap: number | null;
    gap_ratio: number | null;
    gap_status: string | null;
    active_alerts: number;
  };
}

interface RecommendationResponse {
  data: Recommendation[];
  methodology: {
    version: string;
    rules: string[];
    limitations: string[];
  };
  meta: {
    total: number;
    by_priority: Record<Priority, number>;
    by_type: Record<RecommendationType, number>;
  };
}

const PRIORITY_BADGE_CLASS: Record<Priority, string> = {
  CRITICAL: 'badge-critical',
  HIGH: 'badge-high',
  MEDIUM: 'badge-medium',
  LOW: 'badge-low',
};

const TYPE_ICONS: Record<RecommendationType, React.ReactNode> = {
  INCREASE_SEATS: <ArrowUpRight size={16} className="text-emerald" />,
  REDUCE_SEATS: <ArrowDownRight size={16} className="text-purple" />,
  NEW_COURSE: <PlusCircle size={16} className="text-blue" />,
  PRIORITIZE_CENTRE: <Layers size={16} className="text-amber" />,
  REVISE_CURRICULUM: <Sparkles size={16} className="text-cyan" />,
  MONITOR: <RefreshCw size={16} className="text-muted" />,
};

const TYPE_LABELS: Record<RecommendationType, string> = {
  INCREASE_SEATS: 'Increase Sanctioned Seats',
  REDUCE_SEATS: 'Rationalize / Reduce Seats',
  NEW_COURSE: 'Introduce New Course',
  PRIORITIZE_CENTRE: 'Upgrade Centre Infrastructure',
  REVISE_CURRICULUM: 'Update Curriculum & Equipment',
  MONITOR: 'Monitor Demand Pipeline',
};

export function Recommendations() {
  const [selectedState, setSelectedState] = useState<string>('');
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');
  const [selectedSector, setSelectedSector] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const statesQuery = useQuery({
    queryKey: ['rec-states'],
    queryFn: async () => {
      const res = await apiClient.get('/geo/states');
      return (res.data?.data ?? []) as StateRecord[];
    },
  });

  const districtsQuery = useQuery({
    queryKey: ['rec-districts', selectedState],
    queryFn: async () => {
      const url = selectedState ? `/geo/districts?state_id=${encodeURIComponent(selectedState)}` : '/geo/districts';
      const res = await apiClient.get(url);
      return (res.data?.data ?? []) as DistrictRecord[];
    },
  });

  const sectorsQuery = useQuery({
    queryKey: ['rec-sectors'],
    queryFn: async () => {
      const res = await apiClient.get('/sectors');
      return (res.data?.data ?? []) as SectorRecord[];
    },
  });

  const recQuery = useQuery({
    queryKey: ['recommendations', selectedState, selectedDistrict, selectedSector],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedState) params.set('state', selectedState);
      if (selectedDistrict) params.set('district_id', selectedDistrict);
      if (selectedSector) params.set('sector', selectedSector);
      const res = await apiClient.get(`/recommendations?${params.toString()}`);
      return (res.data ?? { data: [], meta: { total: 0, by_priority: {}, by_type: {} } }) as RecommendationResponse;
    },
  });

  const filteredRecs = useMemo(() => {
    const list = recQuery.data?.data ?? [];
    return list.filter((item) => {
      if (priorityFilter !== 'ALL' && item.priority !== priorityFilter) return false;
      if (typeFilter !== 'ALL' && item.type !== typeFilter) return false;
      return true;
    });
  }, [recQuery.data, priorityFilter, typeFilter]);

  const stats = useMemo(() => {
    const all = recQuery.data?.data ?? [];
    const criticalCount = all.filter((r) => r.priority === 'CRITICAL' || r.priority === 'HIGH').length;
    let netSeats = 0;
    let newCourses = 0;
    for (const r of all) {
      if (r.metrics.seat_change) netSeats += r.metrics.seat_change;
      if (r.type === 'NEW_COURSE') newCourses += 1;
    }
    return {
      total: all.length,
      urgent: criticalCount,
      netSeats,
      newCourses,
    };
  }, [recQuery.data]);

  const handleExportCsv = () => {
    if (!filteredRecs.length) return;
    const headers = ['Priority', 'Action', 'District', 'Trade', 'Sector', 'Current Seats', 'Recommended Seats', 'Change', 'Rationale'];
    const rows = filteredRecs.map((r) => [
      r.priority,
      r.type,
      `"${r.district_name}"`,
      `"${r.trade_name}"`,
      `"${r.sector_name}"`,
      r.metrics.current_seats ?? 0,
      r.metrics.recommended_seats ?? 0,
      r.metrics.seat_change ?? 0,
      `"${(r.rationale || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `lmis_training_recommendations_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (recQuery.isPending || statesQuery.isPending) {
    return <div className="page-container"><div className="surface loading-state">Generating AI recommendations…</div></div>;
  }

  if (recQuery.isError) {
    return <ErrorState message="Could not load training recommendations." onRetry={() => void recQuery.refetch()} />;
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Sparkles size={24} className="text-blue" />
            AI Training Recommendations
          </h1>
          <p className="page-subtitle" style={{ margin: '0.25rem 0 0 0', color: 'var(--muted)' }}>
            Prescriptive training seat reallocations, course introductions, and capacity interventions powered by supply-demand forecasts.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={handleExportCsv}
          disabled={!filteredRecs.length}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Download size={16} />
          Export CSV Plan
        </button>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
        <div className="surface stat-card">
          <span className="stat-label">Total Interventions</span>
          <strong className="stat-value">{stats.total}</strong>
          <small className="stat-hint">Across active trade-district scopes</small>
        </div>
        <div className="surface stat-card" style={{ borderLeft: '4px solid var(--shortage)' }}>
          <span className="stat-label">Urgent Interventions</span>
          <strong className="stat-value text-red">{stats.urgent}</strong>
          <small className="stat-hint">Critical or High priority gaps</small>
        </div>
        <div className="surface stat-card" style={{ borderLeft: '4px solid #10b981' }}>
          <span className="stat-label">Net Recommended Expansion</span>
          <strong className="stat-value" style={{ color: stats.netSeats >= 0 ? '#10b981' : 'var(--oversupply)' }}>
            {stats.netSeats > 0 ? `+${stats.netSeats.toLocaleString()}` : stats.netSeats.toLocaleString()} seats
          </strong>
          <small className="stat-hint">Annual capacity adjustment</small>
        </div>
        <div className="surface stat-card" style={{ borderLeft: '4px solid #3b82f6' }}>
          <span className="stat-label">New Course Additions</span>
          <strong className="stat-value text-blue">{stats.newCourses}</strong>
          <small className="stat-hint">Trades with zero sanctioned seats</small>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="surface filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', padding: '1rem', marginTop: '1.5rem', borderRadius: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Filter size={16} className="text-muted" />
          <strong style={{ fontSize: '0.875rem' }}>Filters:</strong>
        </div>

        <select
          className="form-select"
          value={selectedState}
          onChange={(e) => { setSelectedState(e.target.value); setSelectedDistrict(''); }}
          style={{ minWidth: '150px' }}
        >
          <option value="">All States</option>
          {statesQuery.data?.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          className="form-select"
          value={selectedDistrict}
          onChange={(e) => setSelectedDistrict(e.target.value)}
          style={{ minWidth: '160px' }}
        >
          <option value="">All Districts</option>
          {districtsQuery.data?.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <select
          className="form-select"
          value={selectedSector}
          onChange={(e) => setSelectedSector(e.target.value)}
          style={{ minWidth: '160px' }}
        >
          <option value="">All Sectors</option>
          {sectorsQuery.data?.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>

        <select
          className="form-select"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          style={{ minWidth: '140px' }}
        >
          <option value="ALL">All Priorities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>

        <select
          className="form-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ minWidth: '180px' }}
        >
          <option value="ALL">All Action Types</option>
          <option value="INCREASE_SEATS">Increase Seats</option>
          <option value="REDUCE_SEATS">Reduce Seats</option>
          <option value="NEW_COURSE">New Course</option>
          <option value="PRIORITIZE_CENTRE">Prioritize Centre</option>
        </select>
      </div>

      {/* Recommendations Cards Grid */}
      <div style={{ marginTop: '1.5rem' }}>
        {filteredRecs.length === 0 ? (
          <EmptyState
            message="No actions match the selected filter criteria. Try adjusting state, district, or priority filters."
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            {filteredRecs.map((rec) => {
              const seatDiff = rec.metrics.seat_change ?? 0;
              const hasDiff = seatDiff !== 0;

              return (
                <div
                  key={rec.id}
                  className="surface recommendation-card"
                  style={{
                    padding: '1.25rem',
                    borderRadius: '8px',
                    borderLeft: `5px solid ${
                      rec.priority === 'CRITICAL' ? 'var(--shortage)' :
                      rec.priority === 'HIGH' ? '#f59e0b' :
                      rec.priority === 'MEDIUM' ? '#3b82f6' : '#6b7280'
                    }`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  {/* Top line: priority badge, type badge, location */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={`badge ${PRIORITY_BADGE_CLASS[rec.priority]}`} style={{ fontWeight: 600, fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                        {rec.priority} PRIORITY
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 500, color: 'var(--muted)' }}>
                        {TYPE_ICONS[rec.type]}
                        {TYPE_LABELS[rec.type] || rec.type}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {rec.district_name} • {rec.sector_name}
                    </span>
                  </div>

                  {/* Title & Trade */}
                  <div>
                    <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.05rem', fontWeight: 600 }}>
                      {rec.title}
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      Trade: <strong>{rec.trade_name}</strong>
                    </p>
                  </div>

                  {/* Metrics summary bar */}
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '1.5rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '0.75rem 1rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem'
                  }}>
                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.75rem' }}>Current Sanctioned Seats</span>
                      <strong>{rec.metrics.current_seats != null ? rec.metrics.current_seats.toLocaleString() : 'None'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.75rem' }}>Recommended Seats</span>
                      <strong>{rec.metrics.recommended_seats != null ? rec.metrics.recommended_seats.toLocaleString() : 'N/A'}</strong>
                    </div>
                    {hasDiff && (
                      <div>
                        <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.75rem' }}>Target Adjustment</span>
                        <strong style={{ color: seatDiff > 0 ? '#10b981' : 'var(--oversupply)' }}>
                          {seatDiff > 0 ? `+${seatDiff}` : seatDiff}
                          {rec.metrics.seat_change_pct != null ? ` (${rec.metrics.seat_change_pct > 0 ? '+' : ''}${rec.metrics.seat_change_pct}%)` : ''}
                        </strong>
                      </div>
                    )}
                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.75rem' }}>Gap Status</span>
                      <strong style={{ color: rec.metrics.gap_status?.includes('SHORTAGE') ? 'var(--shortage)' : 'inherit' }}>
                        {rec.metrics.gap_status || 'BALANCED'}
                      </strong>
                    </div>
                  </div>

                  {/* Rationale & Expected Impact */}
                  <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <p style={{ margin: 0 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Rationale: </strong>
                      <span style={{ color: 'var(--text-secondary)' }}>{rec.rationale}</span>
                    </p>
                    {rec.expected_impact && (
                      <p style={{ margin: 0 }}>
                        <strong style={{ color: 'var(--text-primary)' }}>Expected Impact: </strong>
                        <span style={{ color: 'var(--text-secondary)' }}>{rec.expected_impact}</span>
                      </p>
                    )}
                  </div>

                  {/* Actions footer */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.25rem' }}>
                    <Link
                      to={`/simulate?district_id=${rec.district_id}&trade_id=${rec.trade_id}`}
                      className="btn btn-outline"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                    >
                      Test in What-If Simulator →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
