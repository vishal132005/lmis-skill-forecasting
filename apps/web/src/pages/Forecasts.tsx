import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Activity, Play, TrendingUp } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../lib/apiClient';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

interface District {
  id: string;
  name: string;
  state_name: string;
}
interface Trade {
  id: string;
  name: string;
  sector_name: string;
}
interface ForecastPoint {
  period: string;
  value: number;
}
interface SourceForecast {
  source: 'job_postings' | 'industry_hiring';
  status: 'forecasted' | 'insufficient_history' | 'unavailable_source';
  reason: string | null;
  method: string | null;
  history: ForecastPoint[];
  forecast: ForecastPoint[];
  evaluation: { mae: number; rmse: number; selected_method: string } | null;
  missing_periods: string[];
}
interface ForecastResult {
  horizon_months: number;
  methodology_version: string;
  methodology: { name: string; selection_metric: string; methods: string[] };
  sources: Record<'job_postings' | 'industry_hiring', SourceForecast>;
  data_provenance: { classification: string; description: string };
  limitations: string[];
}

export const Forecasts = () => {
  const [districtId, setDistrictId] = useState('');
  const [tradeId, setTradeId] = useState('');
  const [horizon, setHorizon] = useState(3);
  const districtsQuery = useQuery({
    queryKey: ['forecast-districts'],
    queryFn: async () => {
      const response = await apiClient.get('/geo/districts');
      return (response.data?.data ?? []) as District[];
    },
  });
  const tradesQuery = useQuery({
    queryKey: ['forecast-trades'],
    queryFn: async () => {
      const response = await apiClient.get('/trades');
      return (response.data?.data ?? []) as Trade[];
    },
  });
  const runForecast = useMutation({
    mutationFn: async (request: { district_id: string; trade_id: string; horizon_months: number }) => {
      const response = await apiClient.post('/forecasts/run', request);
      return response.data as ForecastResult;
    },
  });

  if (districtsQuery.isPending || tradesQuery.isPending) return <div className="page-container"><div className="surface loading-state">Loading forecast options…</div></div>;
  if (districtsQuery.isError || tradesQuery.isError) {
    return <ErrorState message="Forecast options could not be loaded." onRetry={() => { void districtsQuery.refetch(); void tradesQuery.refetch(); }} />;
  }

  return (
    <div className="page-container animate-fade-in">
      <section className="page-intro">
        <div><p className="eyebrow">STATISTICAL BASELINES</p><h2>Explore forecasts</h2><p className="text-secondary">Run an explainable forecast for a district and trade.</p></div>
        <span className="version-chip">TSF-v1</span>
      </section>
      <div className="disclosure-banner"><Activity size={17} /><span>Forecasts are generated from synthetic seed histories. They are not calibrated employment statistics or live predictions.</span></div>
      <section className="surface forecast-form">
        <div className="section-heading"><div><p className="eyebrow">FORECAST SETUP</p><h2>Choose a signal series</h2></div></div>
        <label className="field-label">District
          <select value={districtId} onChange={(event) => setDistrictId(event.target.value)}>
            <option value="">Select a district</option>
            {(districtsQuery.data ?? []).map((district) => <option value={district.id} key={district.id}>{district.name} · {district.state_name}</option>)}
          </select>
        </label>
        <label className="field-label">Trade
          <select value={tradeId} onChange={(event) => setTradeId(event.target.value)}>
            <option value="">Select a trade</option>
            {(tradesQuery.data ?? []).map((trade) => <option value={trade.id} key={trade.id}>{trade.name} · {trade.sector_name}</option>)}
          </select>
        </label>
        <label className="field-label">Forecast horizon
          <select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}>
            {[1, 3, 6, 12].map((months) => <option value={months} key={months}>{months} {months === 1 ? 'month' : 'months'}</option>)}
          </select>
        </label>
        <button
          className="btn btn-primary forecast-submit"
          disabled={!districtId || !tradeId || runForecast.isPending}
          onClick={() => runForecast.mutate({ district_id: districtId, trade_id: tradeId, horizon_months: horizon })}
        >
          <Play size={16} fill="currentColor" /> {runForecast.isPending ? 'Running statistical baselines…' : 'Run forecast'}
        </button>
      </section>

      {runForecast.isError && <ErrorState message={`Forecast could not be generated: ${(runForecast.error as { message?: string }).message ?? 'Please retry.'}`} onRetry={() => runForecast.mutate({ district_id: districtId, trade_id: tradeId, horizon_months: horizon })} />}
      {runForecast.isSuccess && (
        <>
          <div className="forecast-result-header"><div><p className="eyebrow">{runForecast.data.methodology_version} · {runForecast.data.methodology.name}</p><h2>Forecast results</h2></div><span className="period-chip">{runForecast.data.horizon_months} month horizon</span></div>
          {(['job_postings', 'industry_hiring'] as const).map((sourceKey) => {
            const source = runForecast.data.sources[sourceKey];
            if (source.status !== 'forecasted') {
              return <section className="surface source-card" key={sourceKey}><p className="eyebrow">{sourceKey.replace('_', ' ')}</p><h3>Insufficient history</h3><p className="text-secondary">{source.reason ?? 'This source could not be forecast for the selected series.'}</p>{source.missing_periods.length > 0 && <small>Missing periods: {source.missing_periods.join(', ')}</small>}</section>;
            }
            const chartData: { period: string; history: number | null; forecast: number | null }[] = source.history.map((point, index) => ({
              period: point.period,
              history: point.value,
              forecast: index === source.history.length - 1 ? point.value : null,
            }));
            chartData.push(...source.forecast.map((point) => ({ period: point.period, history: null, forecast: point.value })));
            return (
              <section className="surface source-card" key={sourceKey}>
                <div className="section-heading">
                  <div><p className="eyebrow">{sourceKey === 'job_postings' ? 'JOB POSTINGS' : 'INDUSTRY HIRING'}</p><h2>{source.method}</h2></div>
                  <span className="forecast-method"><TrendingUp size={15} /> {source.history.length} history points</span>
                </div>
                <div className="forecast-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="rgba(255,255,255,.07)" />
                      <XAxis dataKey="period" tick={{ fill: '#8f98b0', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={20} />
                      <YAxis tick={{ fill: '#8f98b0', fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
                      <Tooltip contentStyle={{ background: '#171a27', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12 }} />
                      <Legend />
                      <Line type="monotone" dataKey="history" name="Observed history" stroke="#9a85ff" strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#31cbb0" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {source.evaluation && <div className="evaluation-row"><span>Backtest MAE <strong>{source.evaluation.mae.toFixed(2)}</strong></span><span>RMSE <strong>{source.evaluation.rmse.toFixed(2)}</strong></span><span>Model selection <strong>{runForecast.data.methodology.selection_metric}</strong></span></div>}
              </section>
            );
          })}
          <section className="surface limitations-card">
            <p className="eyebrow">METHOD &amp; LIMITATIONS</p>
            <p>{runForecast.data.data_provenance.description}</p>
            <ul>{runForecast.data.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
          </section>
        </>
      )}
      {!runForecast.isSuccess && !runForecast.isError && !districtsQuery.data?.length && <EmptyState message="No districts are available to forecast." />}
    </div>
  );
};
