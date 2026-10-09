import { Activity } from 'lucide-react';

type ApiStatus = 'checking' | 'connected' | 'unavailable';

interface TopbarProps {
  title: string;
  apiStatus: ApiStatus;
}

export const Topbar = ({ title, apiStatus }: TopbarProps) => (
  <header className="topbar">
    <div className="topbar-brand" aria-label="KaushalPulse">
      <span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span>
      <span className="brand-name">KaushalPulse</span>
    </div>
    <div className="topbar-context">
      <span className="topbar-kicker">LABOUR MARKET INTELLIGENCE</span>
      <h1 className="topbar-title">{title}</h1>
    </div>
    <div className="topbar-status">
      <span className={`status-dot status-dot-${apiStatus}`} />
      <span className="status-label">{apiStatus === 'connected' ? 'API connected' : apiStatus === 'checking' ? 'Connecting' : 'API unavailable'}</span>
      <span className="demo-pill">DEMO DATA</span>
    </div>
  </header>
);
