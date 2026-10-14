import React, { Suspense, useEffect, useRef, useState } from 'react';
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
const TargetSetting = React.lazy(() => import('./pages/PlanningTools').then((module) => ({ default: module.TargetSetting })));
const WhatIfSimulation = React.lazy(() => import('./pages/PlanningTools').then((module) => ({ default: module.WhatIfSimulation })));
const GapAnalysis = React.lazy(() => import('./pages/GapAnalysis').then((module) => ({ default: module.GapAnalysis })));
const Recommendations = React.lazy(() => import('./pages/Recommendations').then((module) => ({ default: module.Recommendations })));
const DataUpload = React.lazy(() => import('./pages/DataUpload').then((module) => ({ default: module.DataUpload })));

const pageTitles: Record<string, string> = {
  '/': 'Overview',
  '/analytics': 'Explore',
  '/gap-analysis': 'Gap Analysis & Heatmap',
  '/forecasts': 'Demand Forecasts',
  '/alerts': 'Early-Warning Alerts',
  '/recommendations': 'AI Training Recommendations',
  '/upload': 'Data Ingestion & Upload',
  '/more': 'More',
  '/targets': 'Target Setting',
  '/simulate': 'What-If Simulation',
  '/settings': 'Settings',
};

const FallbackComponent = ({ error, resetErrorBoundary }: { error: unknown; resetErrorBoundary: () => void }) => (
  <ErrorState message={error instanceof Error ? error.message : 'A rendering error occurred.'} onRetry={resetErrorBoundary} />
);

function AppShell() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'unavailable'>('checking');
  const sidebarRef = useRef<HTMLElement | null>(null);
  const wasNavigationOpen = useRef(false);
  const { pathname } = useLocation();
  const [openNavigationPath, setOpenNavigationPath] = useState<string | null>(null);
  const isNavigationOpen = openNavigationPath === pathname;
  const title = pageTitles[pathname] ?? 'KaushalPulse';

  useEffect(() => {
    let active = true;
    apiClient.get('/health')
      .then(() => { if (active) setApiStatus('connected'); })
      .catch(() => { if (active) setApiStatus('unavailable'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isNavigationOpen) {
      if (wasNavigationOpen.current) document.getElementById('navigation-toggle')?.focus();
      wasNavigationOpen.current = false;
      return;
    }

    wasNavigationOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenNavigationPath(null);
        return;
      }
      if (event.key !== 'Tab' || !sidebarRef.current) return;

      const focusable = sidebarRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNavigationOpen]);

  return (
    <div className="app-layout">
      {isNavigationOpen && (
        <button
          className="navigation-backdrop"
          type="button"
          aria-label="Close main navigation"
          onClick={() => setOpenNavigationPath(null)}
        />
      )}
      <Sidebar
        isOpen={isNavigationOpen}
        onNavigate={() => setOpenNavigationPath(null)}
        sidebarRef={sidebarRef}
      />
      <div className="workspace">
        <Topbar
          title={title}
          apiStatus={apiStatus}
          isNavigationOpen={isNavigationOpen}
          onToggleNavigation={() => setOpenNavigationPath(isNavigationOpen ? null : pathname)}
        />
        <main className="main-content">
          <ErrorBoundary FallbackComponent={FallbackComponent}>
            <Suspense fallback={<div className="page-container"><div className="surface loading-state">Loading screen…</div></div>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/gap-analysis" element={<GapAnalysis />} />
                <Route path="/forecasts" element={<Forecasts />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/recommendations" element={<Recommendations />} />
                <Route path="/upload" element={<DataUpload />} />
                <Route path="/more" element={<More />} />
                <Route path="/targets" element={<TargetSetting />} />
                <Route path="/simulate" element={<WhatIfSimulation />} />
                <Route path="/settings" element={<StatusPage title="Settings" />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
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
