import { NavLink } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, AlertTriangle, Crosshair, Map, Settings, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

export const Sidebar = () => {
  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Gap Analytics', path: '/analytics', icon: Map },
    { name: 'Demand Forecasts', path: '/forecasts', icon: TrendingUp },
    { name: 'Alerts & Anomalies', path: '/alerts', icon: AlertTriangle },
    { name: 'Target Setting', path: '/targets', icon: Crosshair },
    { name: 'Simulate', path: '/simulate', icon: Zap },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <motion.aside 
      initial={{ x: -260 }} 
      animate={{ x: 0 }} 
      className="sidebar"
    >
      <div style={{ padding: '1.5rem 2rem', display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--grad-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.2rem' }}>
          L
        </div>
        <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '1px' }}>LMIS AI</span>
      </div>

      <nav style={{ padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              color: isActive ? 'white' : 'var(--text-secondary)',
              background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
              fontWeight: isActive ? 600 : 500,
              borderLeft: isActive ? '3px solid var(--accent-primary)' : '3px solid transparent'
            })}
          >
            <item.icon size={20} style={{ color: 'inherit' }} />
            {item.name}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            MS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>MSDE Admin</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>National View</span>
          </div>
        </div>
      </div>
    </motion.aside>
  );
};
