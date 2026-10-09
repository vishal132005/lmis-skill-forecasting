import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Clock3, RefreshCw } from 'lucide-react';
import { apiClient } from '../lib/apiClient';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

interface AlertRecord {
  id: string;
  type: string;
  severity: string;
  status: string;
  message: string;
  district_name: string;
  state_id: string;
  trade_name: string;
  sector_name: string;
  created_at: string;
}

export const Alerts = () => {
  const queryClient = useQueryClient();
  const alertsQuery = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const response = await apiClient.get('/alerts?limit=100');
      return (response.data?.data ?? []) as AlertRecord[];
    },
  });
  const updateAlert = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACKNOWLEDGED' | 'RESOLVED' }) =>
      apiClient.patch(`/alerts/${encodeURIComponent(id)}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
  if (alertsQuery.isPending) return <div className="page-container"><div className="surface loading-state">Loading alerts…</div></div>;
  if (alertsQuery.isError) return <ErrorState message="Alerts could not be loaded." onRetry={() => void alertsQuery.refetch()} />;

  const alerts = alertsQuery.data ?? [];
  const activeCount = alerts.filter((alert) => alert.status === 'ACTIVE').length;
  return (
    <div className="page-container animate-fade-in">
      <section className="page-intro">
        <div><p className="eyebrow">MARKET SIGNALS</p><h2>Alerts</h2><p className="text-secondary">Review seeded shortage and oversupply signals.</p></div>
        <span className="period-chip">{activeCount} active</span>
      </section>
      <div className="disclosure-banner"><AlertTriangle size={17} /><span>These are synthetic demonstration alerts. They are not live warnings or verified employment events.</span></div>
      {!alerts.length ? <EmptyState message="No alerts were returned by the API." /> : (
        <div className="alert-list">
          {alerts.map((alert) => (
            <article className="surface alert-card" key={alert.id}>
              <div className="alert-card-head">
                <span className={`severity-pill severity-${alert.severity.toLowerCase()}`}>{alert.severity}</span>
                <span className={`alert-status status-${alert.status.toLowerCase()}`}>{alert.status.replace('_', ' ')}</span>
              </div>
              <h3>{alert.type.replaceAll('_', ' ')}</h3>
              <p>{alert.message}</p>
              <div className="alert-context">{alert.trade_name} <span>·</span> {alert.district_name}, {alert.state_id}</div>
              <div className="alert-card-footer">
                <span><Clock3 size={14} /> {new Date(alert.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                {alert.status === 'ACTIVE' ? (
                  <div className="alert-actions">
                    <button className="small-action" disabled={updateAlert.isPending} onClick={() => updateAlert.mutate({ id: alert.id, status: 'ACKNOWLEDGED' })}><Check size={14} /> Acknowledge</button>
                    <button className="small-action resolve-action" disabled={updateAlert.isPending} onClick={() => updateAlert.mutate({ id: alert.id, status: 'RESOLVED' })}>Resolve</button>
                  </div>
                ) : <span className="text-muted">Status updated</span>}
              </div>
            </article>
          ))}
        </div>
      )}
      {updateAlert.isError && <div className="inline-error"><RefreshCw size={15} /> Update failed: {(updateAlert.error as { message?: string }).message ?? 'Please retry.'}<button onClick={() => updateAlert.reset()}>Dismiss</button></div>}
    </div>
  );
};
