import {
  Activity,
  Bell,
  BookOpenText,
  ChartNoAxesCombined,
  Compass,
  House,
  Map,
  SlidersHorizontal,
  Sparkles,
  Target,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type { RefObject } from 'react';
import { NavLink } from 'react-router-dom';

interface SidebarProps {
  isOpen: boolean;
  onNavigate: () => void;
  sidebarRef: RefObject<HTMLElement | null>;
}

type Destination = { label: string; path: string; icon: LucideIcon; unavailable?: boolean };

const groups: { heading: string | null; links: Destination[] }[] = [
  {
    heading: null,
    links: [{ label: 'Overview', path: '/', icon: House }],
  },
  {
    heading: 'Labour Market',
    links: [
      { label: 'Explore', path: '/analytics', icon: Compass },
      { label: 'Gap Heatmap', path: '/gap-analysis', icon: Map },
      { label: 'Forecasts', path: '/forecasts', icon: ChartNoAxesCombined },
      { label: 'Data Ingestion', path: '/upload', icon: Upload },
    ],
  },
  {
    heading: 'Early Warning',
    links: [{ label: 'Alerts', path: '/alerts', icon: Bell }],
  },
  {
    heading: 'Planning & Policy',
    links: [
      { label: 'AI Recommendations', path: '/recommendations', icon: Sparkles },
      { label: 'Target Setting', path: '/targets', icon: Target },
      { label: 'What-if Simulation', path: '/simulate', icon: SlidersHorizontal },
    ],
  },
  {
    heading: 'Secondary',
    links: [
      { label: 'More', path: '/more', icon: BookOpenText },
      { label: 'Settings', path: '/settings', icon: Activity, unavailable: true },
    ],
  },
];

export const Sidebar = ({ isOpen, onNavigate, sidebarRef }: SidebarProps) => (
  <aside
    className={`primary-sidebar${isOpen ? ' primary-sidebar-open' : ''}`}
    id="primary-navigation"
    ref={sidebarRef}
    aria-label="Main navigation"
    aria-modal={isOpen || undefined}
    role={isOpen ? 'dialog' : undefined}
  >
    <div className="sidebar-brand">
      <span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span>
      <span><strong>KaushalPulse</strong><small>LABOUR MARKET INTELLIGENCE</small></span>
    </div>
    <nav className="sidebar-nav" aria-label="Primary navigation">
      {groups.map(({ heading, links }) => (
        <section className="nav-group" key={heading ?? 'overview'}>
          {heading && <h2 className="nav-group-heading">{heading}</h2>}
          {links.map(({ label, path, icon: Icon, unavailable }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onClick={onNavigate}
              title={label}
              aria-label={unavailable ? `${label}, unavailable` : label}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}${unavailable ? ' sidebar-link-unavailable' : ''}`}
            >
              <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              <span className="sidebar-link-label">{label}</span>
              {unavailable && <span className="nav-placeholder">PLANNED</span>}
            </NavLink>
          ))}
        </section>
      ))}
    </nav>
  </aside>
);
