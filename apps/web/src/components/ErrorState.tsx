import { AlertCircle } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export const ErrorState = ({ message = 'An error occurred while loading data.', onRetry }: ErrorStateProps) => (
  <div className="state-container animate-fade-in">
    <div className="state-panel">
      <div className="state-icon-wrap state-icon-wrap--error">
        <AlertCircle size={28} />
      </div>
      <h2 className="state-heading">Data unavailable</h2>
      <p className="state-message">{message}</p>
      {onRetry && (
        <button className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  </div>
);
