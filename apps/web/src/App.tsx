import React, { Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ErrorState } from './components/ErrorState';
import { apiClient } from './lib/apiClient';

// Lazy loaded pages for performance
const Dashboard = React.lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Analytics = React.lazy(() => import('./pages/Analytics').then(module => ({ default: module.Analytics })));

const FallbackComponent = ({ error, resetErrorBoundary }: any) => (
  <ErrorState message={error.message || 'A rendering error occurred.'} onRetry={resetErrorBoundary} />
);

function App() {
  const [apiStatus, setApiStatus] = useState<'healthy' | 'degraded' | 'down'>('healthy');

  useEffect(() => {
    apiClient.get('/health')
      .then((res: any) => {
        if (res.aiService === 'down') setApiStatus('degraded');
        else setApiStatus('healthy');
      })
      .catch(() => setApiStatus('down'));
  }, []);

  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Topbar apiStatus={apiStatus} />
          <ErrorBoundary FallbackComponent={FallbackComponent}>
            <Suspense fallback={<div className="page-container"><div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>Loading application module...</div></div>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/forecasts" element={<div className="page-container title-lg animate-fade-in">Demand Forecasts <span className="text-muted text-sm d-block mt-2">Time-series forecasting coming soon</span></div>} />
                <Route path="/alerts" element={<div className="page-container title-lg animate-fade-in">Alerts & Anomalies</div>} />
                <Route path="/targets" element={<div className="page-container title-lg animate-fade-in">Target Setting</div>} />
                <Route path="/simulate" element={<div className="page-container title-lg animate-fade-in">What-If Simulation</div>} />
                <Route path="/settings" element={<div className="page-container title-lg animate-fade-in">System Settings</div>} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
