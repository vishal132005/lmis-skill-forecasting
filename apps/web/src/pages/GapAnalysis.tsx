import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import { Activity, Filter, MapPin } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../lib/apiClient';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

interface StateRecord { id: string; name: string; }
interface SectorRecord { id: string; name: string; }

interface GapRow {
  district_id: string;
  district_name: string;
  state_id: string;
  trade_id: string;
  trade_name: string;
  sector_id: string;
  sector_name: string;
  period: string;
  forecast_demand: number | null;
  effective_supply: number | null;
  gap: number | null;
  gap_ratio: number | null;
  status: string;
  best_case_gap: number | null;
  worst_case_gap: number | null;
}

interface GapSummaryResponse {
  period: string | null;
  national: Record<string, number>;
  states?: Record<string, Record<string, number>>;
}

interface DistrictGeo {
  id: string;
  name: string;
  state_id: string;
  lat: number | null;
  lng: number | null;
}

const STATUS_COLORS: Record<string, string> = {
  ACUTE_SHORTAGE: '#ef4444',
  EMERGING_SHORTAGE: '#f59e0b',
  BALANCED: '#22c55e',
  APPROACHING_SATURATION: '#3b82f6',
  OVERSUPPLY: '#8b5cf6',
  INSUFFICIENT_DATA: '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  ACUTE_SHORTAGE: 'Acute Shortage',
  EMERGING_SHORTAGE: 'Emerging Shortage',
  BALANCED: 'Balanced',
  APPROACHING_SATURATION: 'Approaching Saturation',
  OVERSUPPLY: 'Oversupply',
  INSUFFICIENT_DATA: 'Insufficient Data',
};

function statusRadius(status: string): number {
  switch (status) {
    case 'ACUTE_SHORTAGE': return 14;
    case 'EMERGING_SHORTAGE': return 11;
    case 'OVERSUPPLY': return 11;
    case 'APPROACHING_SATURATION': return 9;
    case 'BALANCED': return 7;
    default: return 5;
  }
}

export const GapAnalysis = () => {
  const [stateFilter, setStateFilter] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  const statesQuery = useQuery({
    queryKey: ['gap-states'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: StateRecord[] }>('/geo/states');
      return response.data?.data ?? [];
    },
  });

  const sectorsQuery = useQuery({
    queryKey: ['gap-sectors'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: SectorRecord[] }>('/sectors');
      return response.data?.data ?? [];
    },
  });

  const gapQuery = useQuery({
    queryKey: ['gap-results', stateFilter, sectorFilter, periodFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (stateFilter) params.set('state', stateFilter);
      if (sectorFilter) params.set('sector', sectorFilter);
      if (periodFilter) params.set('period', periodFilter);
      const response = await apiClient.get<{ data: GapRow[] }>(`/gap?${params.toString()}`);
      return response.data?.data ?? [];
    },
  });

  const districtGeoQuery = useQuery({
    queryKey: ['gap-district-geo'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: DistrictGeo[] }>('/geo/districts');
      return response.data?.data ?? [];
    },
  });

  const summaryQuery = useQuery({
    queryKey: ['gap-summary', periodFilter],
    queryFn: async () => {
      const params = periodFilter ? `?period=${encodeURIComponent(periodFilter)}` : '';
      const response = await apiClient.get<GapSummaryResponse>(`/gap/summary${params}`);
      return response.data ?? { period: null, national: {} };
    },
  });

  if (gapQuery.isPending || statesQuery.isPending) {
    return <div className="page-container"><div className="surface loading-state">Loading gap analysis…</div></div>;
  }
  if (gapQuery.isError) {
    return <ErrorState message="Gap data could not be loaded." onRetry={() => void gapQuery.refetch()} />;
  }

  const gapRows = gapQuery.data ?? [];
  const districts = districtGeoQuery.data ?? [];
  const national = summaryQuery.data?.national ?? {};

  // Extract unique periods
  const periods = [...new Set(gapRows.map((r) => r.period))].sort();

  // Aggregate gaps by district for heatmap
  const districtAgg = new Map<string, { worst_status: string; gap_count: number; total_gap: number; lat: number | null; lng: number | null; name: string; state_id: string }>();
  for (const row of gapRows) {
    const existing = districtAgg.get(row.district_id);
    const geo = districts.find((d) => d.id === row.district_id);
    const statusPriority: Record<string, number> = { ACUTE_SHORTAGE: 5, EMERGING_SHORTAGE: 4, OVERSUPPLY: 3, APPROACHING_SATURATION: 2, BALANCED: 1, INSUFFICIENT_DATA: 0 };
    if (!existing) {
      districtAgg.set(row.district_id, {
        worst_status: row.status,
        gap_count: 1,
        total_gap: row.gap ?? 0,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        name: row.district_name,
        state_id: row.state_id,
      });
    } else {
      existing.gap_count++;
      existing.total_gap += row.gap ?? 0;
      if ((statusPriority[row.status] ?? 0) > (statusPriority[existing.worst_status] ?? 0)) {
        existing.worst_status = row.status;
      }
    }
  }

  // Trades in selected district
  const districtTrades = selectedDistrict
    ? gapRows.filter((r) => r.district_id === selectedDistrict)
    : [];

  // Bar chart data for demand vs supply
  const chartData = districtTrades.reduce((acc, row) => {
    const existing = acc.find((a) => a.trade === row.trade_name);
    if (existing) {
      existing.demand += row.forecast_demand ?? 0;
      existing.supply += row.effective_supply ?? 0;
    } else {
      acc.push({
        trade: row.trade_name,
        demand: row.forecast_demand ?? 0,
        supply: row.effective_supply ?? 0,
        status: row.status,
      });
    }
    return acc;
  }, [] as Array<{ trade: string; demand: number; supply: number; status: string }>);

  // Summary chips
  const summaryChips = Object.entries(national)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => {
      const order = ['ACUTE_SHORTAGE', 'EMERGING_SHORTAGE', 'BALANCED', 'APPROACHING_SATURATION', 'OVERSUPPLY', 'INSUFFICIENT_DATA'];
      return order.indexOf(a) - order.indexOf(b);
    });

  return (
    <div className="page-container animate-fade-in">
      <section className="page-intro">
        <div>
          <p className="eyebrow">SKILL GAP INTELLIGENCE</p>
          <h2>Gap Analysis</h2>
          <p className="text-secondary">District-level demand vs. supply gap drilldown with geographic heatmap.</p>
        </div>
        <span className="period-chip">{gapRows.length} gap records</span>
      </section>

      <div className="disclosure-banner">
        <Activity size={17} />
        <span>Gap analysis computed from synthetic forecast data. Classifications are algorithmic projections, not verified employment outcomes.</span>
      </div>

      {/* National summary chips */}
      {summaryChips.length > 0 && (
        <section className="gap-summary-chips">
          {summaryChips.map(([status, count]) => (
            <div key={status} className="gap-chip" style={{ borderColor: STATUS_COLORS[status] ?? 'var(--border)' }}>
              <span className="gap-chip-dot" style={{ background: STATUS_COLORS[status] }} />
              <span className="gap-chip-label">{STATUS_LABELS[status] ?? status}</span>
              <strong>{count as number}</strong>
            </div>
          ))}
        </section>
      )}

      {/* Filter toolbar */}
      <div className="gap-filter-bar">
        <Filter size={15} />
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
          <option value="">All states</option>
          {(statesQuery.data ?? []).map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}
        </select>
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}>
          <option value="">All sectors</option>
          {(sectorsQuery.data ?? []).map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}
        </select>
        <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
          <option value="">All periods</option>
          {periods.map((p) => <option value={p} key={p}>{p}</option>)}
        </select>
      </div>

      <div className="gap-layout">
        {/* Map */}
        <section className="surface gap-map-card">
          <div className="section-heading">
            <div><p className="eyebrow">GEOGRAPHIC VIEW</p><h2>District heatmap</h2></div>
            <MapPin size={18} />
          </div>
          <div className="gap-map-container">
            <MapContainer
              center={[22.5, 79]}
              zoom={5}
              scrollWheelZoom={true}
              className="gap-leaflet-map"
              attributionControl={false}
            >
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              {[...districtAgg.entries()].map(([id, info]) =>
                info.lat && info.lng ? (
                  <CircleMarker
                    key={id}
                    center={[info.lat, info.lng]}
                    radius={statusRadius(info.worst_status)}
                    pathOptions={{
                      color: STATUS_COLORS[info.worst_status] ?? '#6b7280',
                      fillColor: STATUS_COLORS[info.worst_status] ?? '#6b7280',
                      fillOpacity: selectedDistrict === id ? 0.95 : 0.6,
                      weight: selectedDistrict === id ? 3 : 1.5,
                    }}
                    eventHandlers={{ click: () => setSelectedDistrict(id === selectedDistrict ? null : id) }}
                  >
                    <Tooltip>
                      <strong>{info.name}</strong> · {info.state_id}<br />
                      {STATUS_LABELS[info.worst_status] ?? info.worst_status}<br />
                      {info.gap_count} trade pairs · Gap sum: {Math.round(info.total_gap)}
                    </Tooltip>
                  </CircleMarker>
                ) : null
              )}
            </MapContainer>
          </div>
          <div className="gap-map-legend">
            {Object.entries(STATUS_LABELS).filter(([k]) => k !== 'INSUFFICIENT_DATA').map(([key, label]) => (
              <span key={key}><i className="legend-dot" style={{ background: STATUS_COLORS[key] }} /> {label}</span>
            ))}
          </div>
        </section>

        {/* District detail panel */}
        <section className="surface gap-detail-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">DISTRICT DRILLDOWN</p>
              <h2>{selectedDistrict ? districtAgg.get(selectedDistrict)?.name ?? selectedDistrict : 'Select a district'}</h2>
            </div>
            {selectedDistrict && (
              <button className="quiet-link" onClick={() => setSelectedDistrict(null)}>Clear</button>
            )}
          </div>

          {!selectedDistrict ? (
            <div className="chart-empty">Click a district on the map to see trade-level gap details.</div>
          ) : chartData.length === 0 ? (
            <EmptyState message="No gap data for this district with current filters." />
          ) : (
            <>
              <div className="gap-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="var(--border)" />
                    <XAxis type="number" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="trade" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} tickLine={false} axisLine={false} width={120} />
                    <RechartsTooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                    <Bar dataKey="demand" name="Forecast Demand" fill="var(--shortage)" radius={[0, 4, 4, 0]} barSize={14} />
                    <Bar dataKey="supply" name="Effective Supply" fill="var(--oversupply)" radius={[0, 4, 4, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-legend">
                <span><i className="legend-dot" style={{ background: 'var(--shortage)' }} /> Demand</span>
                <span><i className="legend-dot" style={{ background: 'var(--oversupply)' }} /> Supply</span>
              </div>

              {/* Trade-level table */}
              <div className="gap-trade-table-wrap">
                <table className="gap-trade-table">
                  <thead>
                    <tr>
                      <th>Trade</th>
                      <th>Sector</th>
                      <th>Period</th>
                      <th>Demand</th>
                      <th>Supply</th>
                      <th>Gap</th>
                      <th>Ratio</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {districtTrades.map((row, i) => (
                      <tr key={`${row.trade_id}-${row.period}-${i}`}>
                        <td>{row.trade_name}</td>
                        <td>{row.sector_name}</td>
                        <td>{row.period}</td>
                        <td>{row.forecast_demand?.toFixed(0) ?? '—'}</td>
                        <td>{row.effective_supply?.toFixed(0) ?? '—'}</td>
                        <td style={{ color: (row.gap ?? 0) > 0 ? 'var(--shortage)' : (row.gap ?? 0) < 0 ? 'var(--oversupply)' : 'inherit' }}>
                          {row.gap?.toFixed(0) ?? '—'}
                        </td>
                        <td>{row.gap_ratio !== null ? `${(row.gap_ratio * 100).toFixed(1)}%` : '—'}</td>
                        <td>
                          <span className="gap-status-pill" style={{ background: STATUS_COLORS[row.status] ?? '#6b7280' }}>
                            {STATUS_LABELS[row.status] ?? row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      <p className="data-disclosure">
        <Activity size={14} />
        Gap computations use the formula: forecast_demand − effective_supply. Effective supply = sanctioned_seats / 4 × placement_rate.
      </p>
    </div>
  );
};
