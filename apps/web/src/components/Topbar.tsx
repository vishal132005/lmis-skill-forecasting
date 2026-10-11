import { Activity, Menu, X } from 'lucide-react';

type ApiStatus = 'checking' | 'connected' | 'unavailable';

interface TopbarProps {
  title: string;
  apiStatus: ApiStatus;
  isNavigationOpen: boolean;
  onToggleNavigation: () => void;
}

export const Topbar = ({ title, apiStatus, isNavigationOpen, onToggleNavigation }: TopbarProps) => (
  <header className="topbar">
    <button
      className="navigation-toggle"
      id="navigation-toggle"
      type="button"
      aria-label={isNavigationOpen ? 'Close main navigation' : 'Open main navigation'}
      aria-expanded={isNavigationOpen}
      aria-controls="primary-navigation"
      onClick={onToggleNavigation}
    >
      {isNavigationOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
    </button>
    <div className="topbar-brand" aria-label="KaushalPulse">
      <span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span>
      <span className="brand-name">KaushalPulse</span>
    </div>
    <div className="topbar-context">
      <span className="topbar-kicker">LABOUR MARKET INTELLIGENCE · KAUSHALPULSE</span>
      <h1 className="topbar-title">{title}</h1>
    </div>
    <div className="topbar-status">
      <span className={`status-dot status-dot-${apiStatus}`} />
      <span className="status-label">{apiStatus === 'connected' ? 'API connected' : apiStatus === 'checking' ? 'Connecting' : 'API unavailable'}</span>
      <span className="demo-pill">DEMO DATA</span>
    </div>
  </header>
);
