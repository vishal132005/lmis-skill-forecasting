import { AlertCircle } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export const ErrorState = ({ message = 'An error occurred while loading data.', onRetry }: ErrorStateProps) => (
  <div className="page-container animate-fade-in" style={{ justifyContent: 'center', alignItems: 'center', height: '100%' }}>
    <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center', maxWidth: '400px' }}>
      <div style={{ display: 'inline-flex', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--status-shortage)', borderRadius: '50%', marginBottom: '1.5rem' }}>
        <AlertCircle size={32} />
      </div>
      <h2 className="title-md" style={{ marginBottom: '0.75rem' }}>Data Unavailable</h2>
      <p className="text-muted" style={{ marginBottom: '1.5rem', fontSize: '0.9rem' }}>{message}</p>
      {onRetry && (
        <button className="btn btn-primary" onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  </div>
);
