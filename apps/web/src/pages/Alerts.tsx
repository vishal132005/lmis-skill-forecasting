import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, ChevronDown, Clock3,
  Info, RefreshCw, Timer,
} from 'lucide-react';
import { apiClient } from '../lib/apiClient';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

// ─── Types ───────────────────────────────────────────────────────────────────

type AlertType =
  | 'ACUTE_SHORTAGE'
  | 'EMERGING_SHORTAGE'
  | 'APPROACHING_SATURATION'
  | 'OVERSUPPLY'
  | 'DEMAND_SPIKE';

type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'AUTO_RESOLVED';
type AlertSeverity = 'CRITICAL' | 'SEVERE' | 'HIGH' | 'MEDIUM' | 'LOW';

interface AlertRecord {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  explanation: string | null;
  reason: string | null;
  drivers: Record<string, unknown> | null;
  quarters_to_breach: number | null;
  breach_period: string | null;
  gap_ratio: number | null;
  district_id: string;
  district_name: string;
  state_id: string;
  trade_id: string;
  trade_name: string;
  sector_name: string;
  created_at: string;
  updated_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<AlertType, string> = {
  ACUTE_SHORTAGE: 'Acute Shortage',
  EMERGING_SHORTAGE: 'Emerging Shortage',
  APPROACHING_SATURATION: 'Approaching Saturation',
  OVERSUPPLY: 'Oversupply',
  DEMAND_SPIKE: 'Demand Spike',
};

const TYPE_COLORS: Record<AlertType, string> = {
  ACUTE_SHORTAGE: 'var(--shortage)',
  EMERGING_SHORTAGE: 'var(--risk-amber)',
  APPROACHING_SATURATION: 'var(--oversupply)',
  OVERSUPPLY: 'var(--oversupply)',
  DEMAND_SPIKE: '#7C3AED',
};

function borderColor(alert: AlertRecord): string {
  if (['CRITICAL', 'SEVERE'].includes(alert.severity)) return 'var(--shortage)';
  if (alert.type === 'DEMAND_SPIKE') return '#7C3AED';
  if (alert.type === 'OVERSUPPLY' || alert.type === 'APPROACHING_SATURATION') return 'var(--oversupply)';
  if (['HIGH', 'MEDIUM'].includes(alert.severity)) return 'var(--risk-amber)';
  return 'var(--border)';
}

function formatDriverKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDriverValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 60);
  if (typeof value === 'number') {
    if (key.includes('ratio') || key === 'z_score') return (value as number).toFixed(3);
    if (key.includes('demand') || key.includes('supply') || key.includes('gap')) {
      return Math.round(value as number).toLocaleString();
    }
    return (value as number).toFixed(2);
  }
  return String(value);
}

// ─── Drivers Popover ─────────────────────────────────────────────────────────

function DriversPopover({ drivers }: { drivers: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const entries = Object.entries(drivers).filter(
    ([, v]) => v !== null && typeof v !== 'object',
  );

  return (
    <div className="drivers-wrap" ref={ref}>
      <button
        className="drivers-trigger"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-label="View key drivers"
      >
        <Info size={11} />
        Key drivers
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div className="drivers-popover" role="tooltip">
          <h4>Key Drivers</h4>
          <table className="drivers-table">
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k}>
                  <td>{formatDriverKey(k)}</td>
                  <td>{formatDriverValue(k, v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const Alerts = () => {
  const queryClient = useQueryClient();

  // Filter state
  const [typeFilter, setTypeFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');

  const alertsQuery = useQuery({
    queryKey: ['alerts', typeFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '200' });
      if (typeFilter)   params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const response = await apiClient.get(`/alerts?${params.toString()}`);
      return (response.data?.data ?? []) as AlertRecord[];
    },
  });

  const updateAlert = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACKNOWLEDGED' | 'RESOLVED' }) =>
      apiClient.patch(`/alerts/${encodeURIComponent(id)}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  if (alertsQuery.isPending) {
    return (
      <div className="page-container">
        <div className="surface loading-state">Loading alerts…</div>
      </div>
    );
  }
  if (alertsQuery.isError) {
    return <ErrorState message="Alerts could not be loaded." onRetry={() => void alertsQuery.refetch()} />;
  }

  const alerts = alertsQuery.data ?? [];
  const activeCount = alerts.filter((a) => a.status === 'ACTIVE').length;

  return (
    <div className="page-container animate-fade-in">
      {/* Header */}
      <section className="page-intro">
        <div>
          <p className="eyebrow">MARKET SIGNALS</p>
          <h2>Alerts</h2>
          <p className="text-secondary">
            Rule-based early warnings derived from quarterly gap projections.
          </p>
        </div>
        <span className="period-chip">{activeCount} active</span>
      </section>

      {/* Provenance banner */}
      <div className="disclosure-banner">
        <AlertTriangle size={17} />
        <span>
          Synthetic demonstration alerts — derived from gap engine (AE-v1) running
          on seeded data. Not verified employment events or live warnings.
        </span>
      </div>

      {/* Filter toolbar */}
      <div className="alert-filter-bar">
        <label htmlFor="alert-type-filter" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          Type
        </label>
        <select
          id="alert-type-filter"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          <option value="ACUTE_SHORTAGE">Acute Shortage</option>
          <option value="EMERGING_SHORTAGE">Emerging Shortage</option>
          <option value="APPROACHING_SATURATION">Approaching Saturation</option>
          <option value="OVERSUPPLY">Oversupply</option>
          <option value="DEMAND_SPIKE">Demand Spike</option>
        </select>

        <label htmlFor="alert-status-filter" style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          Status
        </label>
        <select
          id="alert-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
          <option value="AUTO_RESOLVED">Auto resolved</option>
        </select>
      </div>

      {/* Alert list */}
      {!alerts.length ? (
        <EmptyState message="No alerts match the selected filters." />
      ) : (
        <div className="alert-list">
          {alerts.map((alert) => {
            const displayText = alert.explanation ?? alert.reason ?? '';
            const canAct = alert.status === 'ACTIVE' || alert.status === 'ACKNOWLEDGED';
            return (
              <article
                className="surface alert-card"
                key={alert.id}
                style={{ borderLeftWidth: '3px', borderLeftColor: borderColor(alert) }}
              >
                {/* Badge row */}
                <div className="alert-badge-row">
                  <span className={`severity-pill severity-${alert.severity.toLowerCase()}`}>
                    {alert.severity}
                  </span>
                  <span
                    className="alert-type-badge"
                    style={{ color: TYPE_COLORS[alert.type] ?? 'var(--text-secondary)', borderColor: 'transparent', background: 'transparent' }}
                  >
                    {TYPE_LABELS[alert.type] ?? alert.type.replace(/_/g, ' ')}
                  </span>
                  {alert.quarters_to_breach !== null && (
                    <span className="qtb-chip" title={`Breach projected in quarter ${alert.quarters_to_breach}`}>
                      <Timer size={10} />
                      Q{alert.quarters_to_breach}
                      {alert.breach_period ? ` · ${alert.breach_period}` : ''}
                    </span>
                  )}
                  <span className={`alert-status status-${alert.status.toLowerCase()}`}>
                    {alert.status.replace('_', ' ')}
                  </span>
                </div>

                {/* Explanation */}
                {displayText && (
                  <p className="alert-explanation">{displayText}</p>
                )}

                {/* Location / trade */}
                <div className="alert-context">
                  {alert.trade_name} <span>·</span> {alert.district_name}, {alert.state_id}
                  {alert.sector_name && <><span>·</span> {alert.sector_name}</>}
                  {alert.gap_ratio !== null && (
                    <><span>·</span> gap {(alert.gap_ratio * 100).toFixed(1)} %</>
                  )}
                </div>

                {/* Footer */}
                <div className="alert-card-footer">
                  <span>
                    <Clock3 size={14} />
                    {new Date(alert.created_at).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </span>

                  <div className="alert-actions">
                    {/* Drivers popover */}
                    {alert.drivers && Object.keys(alert.drivers).length > 0 && (
                      <DriversPopover drivers={alert.drivers} />
                    )}

                    {/* Acknowledge / Resolve */}
                    {canAct && alert.status === 'ACTIVE' && (
                      <>
                        <button
                          className="small-action"
                          id={`ack-${alert.id}`}
                          disabled={updateAlert.isPending}
                          onClick={() => updateAlert.mutate({ id: alert.id, status: 'ACKNOWLEDGED' })}
                        >
                          <Check size={14} /> Acknowledge
                        </button>
                        <button
                          className="small-action resolve-action"
                          id={`res-${alert.id}`}
                          disabled={updateAlert.isPending}
                          onClick={() => updateAlert.mutate({ id: alert.id, status: 'RESOLVED' })}
                        >
                          Resolve
                        </button>
                      </>
                    )}
                    {canAct && alert.status === 'ACKNOWLEDGED' && (
                      <button
                        className="small-action resolve-action"
                        id={`res-${alert.id}`}
                        disabled={updateAlert.isPending}
                        onClick={() => updateAlert.mutate({ id: alert.id, status: 'RESOLVED' })}
                      >
                        Resolve
                      </button>
                    )}
                    {!canAct && <span className="text-muted">Closed</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Mutation error toast */}
      {updateAlert.isError && (
        <div className="inline-error">
          <RefreshCw size={15} />
          Update failed: {(updateAlert.error as { message?: string }).message ?? 'Please retry.'}
          <button onClick={() => updateAlert.reset()}>Dismiss</button>
        </div>
      )}
    </div>
  );
};
