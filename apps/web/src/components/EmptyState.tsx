import { Inbox } from 'lucide-react';

export const EmptyState = ({ message = 'No data available.' }: { message?: string }) => (
  <div className="page-container animate-fade-in" style={{ justifyContent: 'center', alignItems: 'center', height: '100%' }}>
    <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center', maxWidth: '400px' }}>
      <div style={{ display: 'inline-flex', padding: '1rem', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', borderRadius: '50%', marginBottom: '1.5rem' }}>
        <Inbox size={32} />
      </div>
      <h2 className="title-md" style={{ marginBottom: '0.75rem' }}>Empty</h2>
      <p className="text-muted" style={{ fontSize: '0.9rem' }}>{message}</p>
    </div>
  </div>
);
