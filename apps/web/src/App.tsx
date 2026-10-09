import React, { Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ErrorState } from './components/ErrorState';
import { apiClient } from './lib/apiClient';

const Dashboard = React.lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Analytics = React.lazy(() => import('./pages/Analytics').then((module) => ({ default: module.Analytics })));
const Forecasts = React.lazy(() => import('./pages/Forecasts').then((module) => ({ default: module.Forecasts })));
const Alerts = React.lazy(() => import('./pages/Alerts').then((module) => ({ default: module.Alerts })));
const More = React.lazy(() => import('./pages/More').then((module) => ({ default: module.More })));
const StatusPage = React.lazy(() => import('./pages/More').then((module) => ({ default: module.StatusPage })));

const pageTitles: Record<string, string> = {
  '/': 'Overview',
  '/analytics': 'Explore',
  '/forecasts': 'Forecasts',
  '/alerts': 'Alerts',
  '/more': 'More',
  '/targets': 'Target setting',
  '/simulate': 'What-if simulation',
  '/settings': 'Settings',
};

const FallbackComponent = ({ error, resetErrorBoundary }: { error: unknown; resetErrorBoundary: () => void }) => (
  <ErrorState message={error instanceof Error ? error.message : 'A rendering error occurred.'} onRetry={resetErrorBoundary} />
);

function AppShell() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'unavailable'>('checking');
  const { pathname } = useLocation();
  const title = pageTitles[pathname] ?? 'KaushalPulse';

  useEffect(() => {
    let active = true;
    apiClient.get('/health')
      .then(() => { if (active) setApiStatus('connected'); })
      .catch(() => { if (active) setApiStatus('unavailable'); });
    return () => { active = false; };
  }, []);

  return (
    <div className="app-layout">
      <div className="app-canvas">
        <Topbar title={title} apiStatus={apiStatus} />
        <main className="main-content">
          <ErrorBoundary FallbackComponent={FallbackComponent}>
            <Suspense fallback={<div className="page-container"><div className="surface loading-state">Loading screen…</div></div>}>
              <div className="page-scroll" key={pathname}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/forecasts" element={<Forecasts />} />
                  <Route path="/alerts" element={<Alerts />} />
                  <Route path="/more" element={<More />} />
                  <Route path="/targets" element={<StatusPage title="Target setting" />} />
                  <Route path="/simulate" element={<StatusPage title="What-if simulation" />} />
                  <Route path="/settings" element={<StatusPage title="Settings" />} />
                </Routes>
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
        <Sidebar />
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
