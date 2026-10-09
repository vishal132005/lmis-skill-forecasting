import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import { MapPin, Search } from 'lucide-react';
import { apiClient } from '../lib/apiClient';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

interface StateRecord {
  id: string;
  name: string;
}

interface DistrictSummary {
  district_id: string;
  district_name: string;
  state_id: string;
  lat: number | null;
  lng: number | null;
  pairs: number;
  avg_demand: number;
  avg_supply: number;
  avg_severity: number;
  shortage_count: number;
  oversupply_count: number;
  active_alerts: number;
}

interface DistrictIndex {
  trade_id: string;
  trade_name: string | null;
  period: string;
  demand_index: number | null;
  computation_status: 'computed' | 'insufficient_data';
  components: Record<string, { normalized_value: number | null; status: string }>;
}

export const Analytics = () => {
  const [state, setState] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const statesQuery = useQuery({
    queryKey: ['geo-states'],
    queryFn: async () => {
      const response = await apiClient.get('/geo/states');
      if (!Array.isArray(response.data)) {
        throw new Error('The states endpoint returned an unexpected response.');
      }
      return response.data as StateRecord[];
    },
  });
  const districtsQuery = useQuery({
    queryKey: ['district-summary', state],
    queryFn: async () => {
      const params = state ? `?state=${encodeURIComponent(state)}` : '';
      const response = await apiClient.get(`/districts/summary${params}`);
      if (!Array.isArray(response.data)) {
        throw new Error('The district-summary endpoint returned an unexpected response.');
      }
      return response.data as DistrictSummary[];
    },
  });
  const districts = districtsQuery.data ?? [];
  const selected = districts.find((district) => district.district_id === selectedId) ?? districts[0] ?? null;
  const indexQuery = useQuery({
    queryKey: ['district-demand-index', selected?.district_id],
    queryFn: async () => {
      const response = await apiClient.get(`/demand-index?district=${encodeURIComponent(selected!.district_id)}`);
      if (!Array.isArray(response.data)) {
        throw new Error('The demand-index endpoint returned an unexpected response.');
      }
      return response.data as DistrictIndex[];
    },
    enabled: Boolean(selected),
  });
  const mappableDistricts = districts.filter(
    (district) => Number.isFinite(district.lat) && Number.isFinite(district.lng),
  );
  const mapCenter: [number, number] | null = mappableDistricts.length
    ? [
      mappableDistricts.reduce((sum, district) => sum + district.lat!, 0) / mappableDistricts.length,
      mappableDistricts.reduce((sum, district) => sum + district.lng!, 0) / mappableDistricts.length,
    ]
    : null;
  const sortedIndex = [...(indexQuery.data ?? [])].sort((a, b) => b.period.localeCompare(a.period));
  const indexPeriod = sortedIndex[0]?.period;
  const currentIndex = sortedIndex.filter((record) => record.period === indexPeriod);
  const computedIndex = currentIndex.filter((record) => record.computation_status === 'computed' && record.demand_index !== null);
  const retry = () => { void statesQuery.refetch(); void districtsQuery.refetch(); };

  if (statesQuery.isPending || districtsQuery.isPending) {
    return <div className="page-container"><div className="surface loading-state">Loading district intelligence…</div></div>;
  }
  if (statesQuery.isError || districtsQuery.isError) {
    return <ErrorState message="District intelligence could not be loaded." onRetry={retry} />;
  }
  if (!districts.length) return <EmptyState message="No district summaries are available for this selection." />;

  return (
    <div className="page-container animate-fade-in">
      <section className="page-intro">
        <div>
          <p className="eyebrow">GEOGRAPHIC EXPLORATION</p>
          <h2>Explore districts</h2>
          <p className="text-secondary">Browse seeded gap summaries and direct-demand index signals.</p>
        </div>
        <label className="select-wrap">
          <span className="sr-only">Filter by state</span>
          <MapPin size={17} />
          <select value={state} onChange={(event) => { setState(event.target.value); setSelectedId(null); }} aria-label="Filter by state">
            <option value="">All states</option>
            {(statesQuery.data ?? []).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </label>
      </section>

      {selected && (
        <section className="surface selected-district">
          <div className="selected-heading">
            <div>
              <p className="eyebrow">SELECTED DISTRICT</p>
              <h2>{selected.district_name}</h2>
              <span className="text-secondary">{selected.state_id} · {selected.pairs} trade pairs in seeded gap data</span>
            </div>
            <span className="district-pin"><MapPin size={18} /></span>
          </div>
          <div className="district-metrics">
            <div><strong>{selected.shortage_count}</strong><span>Shortage pairs</span></div>
            <div><strong>{selected.oversupply_count}</strong><span>Oversupply pairs</span></div>
            <div><strong>{selected.active_alerts}</strong><span>Active alerts</span></div>
          </div>
          <div className="district-index">
            <div className="district-index-head">
              <div><span className="eyebrow">LABOUR DEMAND INDEX · LDI-v1</span><small>{indexPeriod ? `Latest available period · ${indexPeriod}` : 'Synthetic demonstration signals'}</small></div>
              <strong>{indexQuery.isPending ? '…' : computedIndex.length ? (computedIndex.reduce((sum, record) => sum + record.demand_index!, 0) / computedIndex.length).toFixed(1) : 'N/A'}</strong>
            </div>
            {indexQuery.isError ? (
              <button className="text-button" onClick={() => void indexQuery.refetch()}>Index unavailable · Retry</button>
            ) : indexQuery.isPending ? (
              <small className="text-secondary">Loading source signal breakdown…</small>
            ) : computedIndex.length ? (
              <div className="trade-signal-list">
                {computedIndex.slice(0, 4).map((record) => (
                  <div className="trade-signal-row" key={record.trade_id}>
                    <span>{record.trade_name ?? record.trade_id}</span>
                    <strong>{record.demand_index?.toFixed(1)}</strong>
                    <small>
                      {Object.entries(record.components)
                        .filter(([, component]) => component.status === 'available')
                        .map(([source, component]) => `${source.replace('_', ' ')} ${component.normalized_value}`)
                        .join(' · ')}
                    </small>
                  </div>
                ))}
              </div>
            ) : <small className="text-secondary">No valid direct-demand signals are available for this district.</small>}
            <small className="provenance-note">Job postings and industry hiring only · synthetic demo records, not observed employment statistics.</small>
          </div>
        </section>
      )}

      {mapCenter && mappableDistricts.length > 0 && (
        <section className="surface map-card">
          <div className="section-heading">
            <div><p className="eyebrow">DISTRICT MAP</p><h2>Gap summary</h2></div>
            <span className="map-count">{mappableDistricts.length} locations</span>
          </div>
          <div className="map-frame">
            <MapContainer key={state || 'all'} center={mapCenter} zoom={state ? 7 : 5} scrollWheelZoom={false}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution="&copy; OpenStreetMap &copy; CARTO"
              />
              {mappableDistricts.map((district) => {
                const color = district.shortage_count > district.oversupply_count
                  ? '#fb7185'
                  : district.oversupply_count > district.shortage_count
                    ? '#60a5fa'
                    : '#34d399';
                return (
                  <CircleMarker
                    key={district.district_id}
                    center={[district.lat!, district.lng!]}
                    radius={selected?.district_id === district.district_id ? 11 : 8}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.72, weight: selected?.district_id === district.district_id ? 3 : 1 }}
                    eventHandlers={{ click: () => setSelectedId(district.district_id) }}
                  >
                    <Tooltip direction="top">
                      <strong>{district.district_name}</strong><br />
                      Shortage pairs: {district.shortage_count}<br />
                      Oversupply pairs: {district.oversupply_count}<br />
                      Active alerts: {district.active_alerts}
                    </Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
          <div className="map-legend">
            <span><i className="legend-dot legend-shortage" /> More shortage pairs</span>
            <span><i className="legend-dot legend-balanced" /> Balanced counts</span>
            <span><i className="legend-dot legend-oversupply" /> More oversupply pairs</span>
          </div>
        </section>
      )}

      <section className="district-directory">
        <div className="section-heading"><div><p className="eyebrow">DISTRICT DIRECTORY</p><h2>Available summaries</h2></div><span className="map-count">{districts.length} districts</span></div>
        <div className="district-list">
          {districts.map((district) => (
            <button
              className={`surface district-list-item${selected?.district_id === district.district_id ? ' selected' : ''}`}
              onClick={() => setSelectedId(district.district_id)}
              key={district.district_id}
            >
              <span><strong>{district.district_name}</strong><small>{district.state_id} · {district.pairs} trade pairs</small></span>
              <span className="district-counts"><b className="text-shortage">{district.shortage_count}</b><b className="text-oversupply">{district.oversupply_count}</b></span>
            </button>
          ))}
        </div>
      </section>
      <p className="data-disclosure"><Search size={14} /> Map locations and market summaries are seeded demonstration data. Demand index scores use the documented relative LDI-v1 methodology.</p>
    </div>
  );
};
