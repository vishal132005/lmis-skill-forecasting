import { Inbox } from 'lucide-react';

export const EmptyState = ({ message = 'No data available.' }: { message?: string }) => (
  <div className="state-container animate-fade-in">
    <div className="state-panel">
      <div className="state-icon-wrap state-icon-wrap--empty">
        <Inbox size={28} />
      </div>
      <h2 className="state-heading">No data</h2>
      <p className="state-message">{message}</p>
    </div>
  </div>
);
