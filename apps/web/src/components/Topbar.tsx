import { Bell, Search } from 'lucide-react';
import { motion } from 'framer-motion';

export const Topbar = ({ apiStatus = 'healthy' }: { apiStatus?: 'healthy' | 'degraded' | 'down' }) => {
  const getStatusColor = () => {
    if (apiStatus === 'healthy') return 'var(--status-balanced)';
    if (apiStatus === 'degraded') return 'var(--status-critical)';
    return 'var(--status-shortage)';
  };

  return (
    <motion.header 
      initial={{ y: -72 }} 
      animate={{ y: 0 }} 
      className="topbar"
    >
      <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)', padding: '0.5rem 1rem', width: '300px', border: '1px solid var(--border-color)' }}>
        <Search size={18} className="text-muted" style={{ marginRight: '0.75rem' }} />
        <input 
          type="text" 
          placeholder="Search districts, trades..." 
          style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', width: '100%', fontSize: '0.875rem' }} 
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '1rem', fontSize: '0.75rem' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(), boxShadow: `0 0 8px ${getStatusColor()}` }}></div>
          <span className="text-muted" style={{ textTransform: 'capitalize' }}>API: {apiStatus}</span>
        </div>
        <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', position: 'relative' }}>
          <Bell size={20} />
          <span className="pulse-indicator" style={{ position: 'absolute', top: 0, right: 0 }}></span>
        </button>
        <div style={{ height: '24px', width: '1px', background: 'var(--border-color)' }}></div>
        <button className="btn btn-outline" style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}>
          Export Report
        </button>
      </div>
    </motion.header>
  );
};
