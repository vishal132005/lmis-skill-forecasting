import { Activity, Bell, Compass, Ellipsis, House, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const destinations: { label: string; path: string; icon: LucideIcon }[] = [
  { label: 'Overview', path: '/', icon: House },
  { label: 'Explore', path: '/analytics', icon: Compass },
  { label: 'Forecasts', path: '/forecasts', icon: Activity },
  { label: 'Alerts', path: '/alerts', icon: Bell },
  { label: 'More', path: '/more', icon: Ellipsis },
];

export const Sidebar = () => (
  <nav className="bottom-nav" aria-label="Primary navigation">
    {destinations.map(({ label, path, icon: Icon }) => (
      <NavLink
        key={path}
        to={path}
        end={path === '/'}
        className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
        aria-label={label}
      >
        <span className="bottom-nav-icon"><Icon size={20} strokeWidth={2} /></span>
        <span className="bottom-nav-label">{label}</span>
      </NavLink>
    ))}
  </nav>
);
