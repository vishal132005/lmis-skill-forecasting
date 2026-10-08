import { useEffect, useState } from 'react';
import { fetchApi } from '../services/api';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export const Analytics = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetchApi('/districts/summary');
        setData(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <div className="page-container">Loading analytics...</div>;

  const getMarkerColor = (severity: number, shortage: number, oversupply: number) => {
    if (shortage > oversupply) return 'var(--status-shortage)';
    if (oversupply > shortage) return 'var(--status-oversupply)';
    return 'var(--status-balanced)';
  };

  return (
    <div className="page-container animate-fade-in" style={{ height: 'calc(100vh - 72px)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 className="title-lg text-gradient">Geospatial Gap Analytics</h1>
        <p className="text-secondary">District-level heatmaps of demand-supply misalignments</p>
      </header>

      <div className="glass-panel" style={{ flex: 1, position: 'relative', overflow: 'hidden', border: '1px solid var(--border-glow)' }}>
        <MapContainer 
          center={[20.5937, 78.9629]} 
          zoom={5} 
          style={{ height: '100%', width: '100%', background: 'var(--bg-app)' }}
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; OpenStreetMap &copy; CARTO'
          />
          {data.map((district: any) => (
            <CircleMarker
              key={district.district_id}
              center={[district.lat, district.lng]}
              radius={Math.max(8, district.avg_severity / 3)}
              pathOptions={{
                color: getMarkerColor(district.avg_severity, district.shortage_count, district.oversupply_count),
                fillColor: getMarkerColor(district.avg_severity, district.shortage_count, district.oversupply_count),
                fillOpacity: 0.6,
                weight: 2
              }}
            >
              <Tooltip className="custom-chart-tooltip" direction="top">
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.25rem' }}>{district.district_name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <span className="text-muted">Shortage Trades:</span>
                    <span style={{ color: 'var(--status-shortage)' }}>{district.shortage_count}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <span className="text-muted">Oversupply Trades:</span>
                    <span style={{ color: 'var(--status-oversupply)' }}>{district.oversupply_count}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <span className="text-muted">Active Alerts:</span>
                    <span style={{ color: 'var(--status-critical)' }}>{district.active_alerts}</span>
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
        
        {/* Legend Overlay */}
        <div style={{ position: 'absolute', bottom: '2rem', right: '2rem', zIndex: 1000, background: 'rgba(15,17,26,0.85)', backdropFilter: 'blur(10px)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)' }}>
          <h4 style={{ fontSize: '0.875rem', marginBottom: '0.5rem', fontWeight: 600 }}>Market Condition</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--status-shortage)' }}></div> Demand &gt; Supply
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--status-balanced)' }}></div> Balanced Market
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--status-oversupply)' }}></div> Supply &gt; Demand
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
