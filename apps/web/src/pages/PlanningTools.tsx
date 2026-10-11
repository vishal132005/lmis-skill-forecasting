import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, SlidersHorizontal, Target } from 'lucide-react';
import { apiClient } from '../lib/apiClient';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

interface CapacityOption {
  district_id: string;
  district_name: string;
  state_id: string;
  state_name: string;
  trade_id: string;
  trade_name: string;
  sector_id: string;
  sector_name: string;
  year: number;
  sanctioned_seats: number | null;
}

interface PlanningTarget {
  id: number;
  district_id: string;
  district_name: string;
  trade_id: string;
  trade_name: string;
  sector_name: string;
  year: number;
  target_seats: number;
  baseline_sanctioned_seats: number | null;
  difference_seats: number | null;
  difference_percent: number | null;
  created_at: string;
}

interface CapacityScenario {
  district_id: string;
  trade_id: string;
  year: number;
  unit: string;
  baseline_seats: number;
  scenario_seats: number;
  delta_seats: number;
  adjustment: { type: 'percent' | 'seats'; value: number; rounding: string };
  limitations: string[];
}

function useCapacityOptions() {
  return useQuery({
    queryKey: ['planning-capacity-options'],
    queryFn: async () => {
      const response = await apiClient.get('/planning/options');
      const rows = response.data?.data;
      if (!Array.isArray(rows)) throw new Error('Training-capacity options returned an unexpected response.');
      return rows as CapacityOption[];
    },
  });
}

function optionKey(option: CapacityOption): string {
  return `${option.district_id}|${option.trade_id}|${option.year}`;
}

function SelectCapacityOption({
  options,
  value,
  onChange,
}: {
  options: CapacityOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-label">
      District · trade · year
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option value={optionKey(option)} key={optionKey(option)}>
            {option.district_name}, {option.state_id} · {option.trade_name} · {option.year}
          </option>
        ))}
      </select>
    </label>
  );
}

function CapacityContext({ option }: { option: CapacityOption }) {
  return (
    <div className="planning-context">
      <span>{option.district_name}, {option.state_name}</span>
      <span>{option.sector_name} · {option.trade_name}</span>
      <span>Planning period: {option.year}</span>
    </div>
  );
}

function CapacityBaseline({ option }: { option: CapacityOption }) {
  return (
    <section className="surface planning-baseline">
      <p className="eyebrow">EXISTING ANNUAL TRAINING CAPACITY</p>
      {option.sanctioned_seats === null ? (
        <p className="text-secondary">Capacity is unavailable for this combination; the system will not substitute zero.</p>
      ) : (
        <p><strong>{option.sanctioned_seats.toLocaleString()}</strong> sanctioned seats in {option.year}</p>
      )}
      <small>Unit: sanctioned seats per year. This is capacity, not enrollment, certification, placement, or demand.</small>
    </section>
  );
}

export const TargetSetting = () => {
  const queryClient = useQueryClient();
  const optionsQuery = useCapacityOptions();
  const [selectedKey, setSelectedKey] = useState('');
  const [targetInput, setTargetInput] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const options = optionsQuery.data ?? [];
  const selected = options.find((option) => optionKey(option) === selectedKey) ?? options[0];
  const targetSeats = targetInput.trim() === '' ? null : Number(targetInput);
  const targetIsValid = targetSeats !== null && Number.isSafeInteger(targetSeats) && targetSeats >= 0 && targetSeats <= 10_000_000;
  const difference = selected && targetIsValid && selected.sanctioned_seats !== null
    ? targetSeats - selected.sanctioned_seats
    : null;
  const differencePercent = difference !== null && selected?.sanctioned_seats
    ? (difference / selected.sanctioned_seats) * 100
    : null;

  const targetsQuery = useQuery({
    queryKey: ['planning-targets', selected?.district_id, selected?.trade_id, selected?.year],
    enabled: Boolean(selected),
    queryFn: async () => {
      const response = await apiClient.get('/planning/targets', {
        params: {
          district_id: selected?.district_id,
          trade_id: selected?.trade_id,
          year: selected?.year,
        },
      });
      const rows = response.data?.data;
      if (!Array.isArray(rows)) throw new Error('Saved targets returned an unexpected response.');
      return rows as PlanningTarget[];
    },
  });

  const saveTarget = useMutation({
    mutationFn: async () => {
      if (!selected || !targetIsValid) throw new Error('Enter a whole-number target from 0 to 10,000,000 seats.');
      const response = await apiClient.post('/planning/targets', {
        district_id: selected.district_id,
        trade_id: selected.trade_id,
        year: selected.year,
        target_seats: targetSeats,
      });
      return response.data?.data as PlanningTarget;
    },
    onSuccess: async (target) => {
      setSavedNotice(`Target of ${target.target_seats.toLocaleString()} seats saved for ${target.year}.`);
      await queryClient.invalidateQueries({ queryKey: ['planning-targets'] });
    },
  });

  if (optionsQuery.isPending) return <div className="page-container"><div className="surface loading-state">Loading supported training-capacity options…</div></div>;
  if (optionsQuery.isError) return <ErrorState message="Supported planning options could not be loaded." onRetry={() => { void optionsQuery.refetch(); }} />;
  if (!selected) return <div className="page-container"><EmptyState message="No district–trade–year training-capacity records are available, so target setting is not supported yet." /></div>;

  return (
    <div className="page-container animate-fade-in planning-page">
      <section className="page-intro">
        <div><p className="eyebrow">CAPACITY PLANNING</p><h2>Set a training-seat target</h2><p className="text-secondary">Review a proposed annual target against the matching sanctioned-seat baseline.</p></div>
        <Target size={20} className="muted-icon" aria-hidden="true" />
      </section>
      <div className="disclosure-banner">Demonstration values are synthetic planning data, not government employment statistics or policy recommendations.</div>
      <section className="surface planning-form">
        <SelectCapacityOption options={options} value={optionKey(selected)} onChange={(value) => { setSelectedKey(value); setSavedNotice(''); saveTarget.reset(); }} />
        <CapacityContext option={selected} />
        <CapacityBaseline option={selected} />
        <label className="field-label" htmlFor="target-seats">Proposed target
          <input
            id="target-seats"
            type="number"
            inputMode="numeric"
            min="0"
            max="10000000"
            step="1"
            value={targetInput}
            onChange={(event) => { setTargetInput(event.target.value); setSavedNotice(''); saveTarget.reset(); }}
            aria-describedby="target-units target-validation"
          />
        </label>
        <small id="target-units" className="planning-hint">Whole sanctioned seats for {selected.year}; allowed range 0–10,000,000.</small>
        {targetInput !== '' && !targetIsValid && <p id="target-validation" className="planning-error" role="alert">Enter a whole-number target from 0 to 10,000,000.</p>}
        {targetIsValid && (
          <section className="planning-difference" aria-live="polite">
            <p className="eyebrow">PROPOSED VS CURRENT CAPACITY</p>
            <strong>{targetSeats.toLocaleString()} seats</strong>
            {selected.sanctioned_seats === null
              ? <p className="text-secondary">Difference unavailable because the baseline capacity is missing.</p>
              : (
                <p className="text-secondary">
                  {difference! > 0 ? '+' : ''}{difference!.toLocaleString()} seats
                  {differencePercent === null ? ' · percentage unavailable because baseline is zero' : ` · ${differencePercent > 0 ? '+' : ''}${differencePercent.toFixed(1)}%`}
                </p>
              )}
          </section>
        )}
        <button className="btn btn-primary planning-submit" disabled={!targetIsValid || saveTarget.isPending} onClick={() => saveTarget.mutate()}>
          <Save size={16} /> {saveTarget.isPending ? 'Saving target…' : 'Save proposed target'}
        </button>
        {savedNotice && <p className="planning-success" role="status">{savedNotice}</p>}
        {saveTarget.isError && <p className="planning-error" role="alert">{(saveTarget.error as Error).message}</p>}
      </section>

      <section className="surface planning-saved">
        <div className="section-heading"><div><p className="eyebrow">SAVED PROPOSALS</p><h2>Targets for this selection</h2></div></div>
        {targetsQuery.isPending ? <p className="text-secondary">Loading saved targets…</p>
          : targetsQuery.isError ? <ErrorState message="Saved targets could not be loaded." onRetry={() => { void targetsQuery.refetch(); }} />
            : targetsQuery.data?.length
              ? <div className="planning-record-list">{targetsQuery.data.map((target) => (
                <article className="planning-record" key={target.id}>
                  <div><strong>{target.target_seats.toLocaleString()} seats</strong><small>Saved {new Date(target.created_at).toLocaleString()}</small></div>
                  <div className="planning-record-delta">
                    {target.difference_seats === null ? 'Baseline unavailable'
                      : `${target.difference_seats > 0 ? '+' : ''}${target.difference_seats.toLocaleString()} seats`}
                    <small>{target.difference_percent === null ? 'percentage unavailable' : `${target.difference_percent > 0 ? '+' : ''}${target.difference_percent.toFixed(1)}%`}</small>
                  </div>
                </article>
              ))}</div>
              : <p className="text-secondary">No saved targets for this district, trade, and year.</p>}
      </section>
    </div>
  );
};

export const WhatIfSimulation = () => {
  const optionsQuery = useCapacityOptions();
  const [selectedKey, setSelectedKey] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'percent' | 'seats'>('percent');
  const [adjustmentInput, setAdjustmentInput] = useState('0');
  const options = optionsQuery.data ?? [];
  const selected = options.find((option) => optionKey(option) === selectedKey) ?? options[0];
  const adjustmentValue = adjustmentInput.trim() === '' ? null : Number(adjustmentInput);
  const adjustmentValid = adjustmentValue !== null && Number.isFinite(adjustmentValue) &&
    (adjustmentType === 'percent'
      ? adjustmentValue >= -100 && adjustmentValue <= 1000
      : Number.isSafeInteger(adjustmentValue) && Math.abs(adjustmentValue) <= 10_000_000);

  const runSimulation = useMutation({
    mutationFn: async () => {
      if (!selected || !adjustmentValid || selected.sanctioned_seats === null) {
        throw new Error('Select a supported option with available capacity and provide a valid adjustment.');
      }
      const response = await apiClient.post('/simulate', {
        district_id: selected.district_id,
        trade_id: selected.trade_id,
        year: selected.year,
        adjustment_type: adjustmentType,
        adjustment_value: adjustmentValue,
      });
      return response.data?.data as CapacityScenario;
    },
  });

  const resetScenario = () => {
    setSelectedKey(options[0] ? optionKey(options[0]) : '');
    setAdjustmentType('percent');
    setAdjustmentInput('0');
    runSimulation.reset();
  };

  if (optionsQuery.isPending) return <div className="page-container"><div className="surface loading-state">Loading supported training-capacity options…</div></div>;
  if (optionsQuery.isError) return <ErrorState message="Supported simulation options could not be loaded." onRetry={() => { void optionsQuery.refetch(); }} />;
  if (!selected) return <div className="page-container"><EmptyState message="No annual district–trade capacity records are available for scenario planning." /></div>;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSimulation.mutate();
  };

  return (
    <div className="page-container animate-fade-in planning-page">
      <section className="page-intro">
        <div><p className="eyebrow">SCENARIO PLANNING</p><h2>What-if capacity change</h2><p className="text-secondary">Compare a hypothetical annual sanctioned-seat capacity with its source baseline.</p></div>
        <SlidersHorizontal size={20} className="muted-icon" aria-hidden="true" />
      </section>
      <div className="disclosure-banner">Synthetic demonstration data. This arithmetic scenario is not a demand forecast, gap estimate, or prediction of policy outcomes.</div>
      <form className="surface planning-form" onSubmit={submit}>
        <SelectCapacityOption options={options} value={optionKey(selected)} onChange={(value) => { setSelectedKey(value); runSimulation.reset(); }} />
        <CapacityContext option={selected} />
        <CapacityBaseline option={selected} />
        <label className="field-label">Adjustment method
          <select value={adjustmentType} onChange={(event) => { setAdjustmentType(event.target.value as 'percent' | 'seats'); runSimulation.reset(); }}>
            <option value="percent">Percentage change</option>
            <option value="seats">Explicit seat change</option>
          </select>
        </label>
        <label className="field-label" htmlFor="scenario-adjustment">
          {adjustmentType === 'percent' ? 'Capacity change (%)' : 'Capacity change (seats)'}
          <input
            id="scenario-adjustment"
            type="number"
            inputMode="decimal"
            min={adjustmentType === 'percent' ? '-100' : '-10000000'}
            max={adjustmentType === 'percent' ? '1000' : '10000000'}
            step={adjustmentType === 'percent' ? '0.1' : '1'}
            value={adjustmentInput}
            onChange={(event) => { setAdjustmentInput(event.target.value); runSimulation.reset(); }}
          />
        </label>
        <small className="planning-hint">
          {adjustmentType === 'percent'
            ? 'Allowed: −100% to +1,000%. Result is rounded to the nearest whole seat.'
            : 'Enter a signed whole-seat change. A scenario cannot reduce capacity below zero.'}
        </small>
        {adjustmentInput !== '' && !adjustmentValid && <p className="planning-error" role="alert">Enter a valid {adjustmentType === 'percent' ? 'percentage from −100 to 1,000' : 'whole-seat change from −10,000,000 to 10,000,000'}.</p>}
        {selected.sanctioned_seats === null && <p className="planning-error" role="alert">Simulation is unavailable because this record has no sanctioned-seat value; missing capacity is not treated as zero.</p>}
        <div className="planning-actions">
          <button className="btn btn-primary" type="submit" disabled={!adjustmentValid || selected.sanctioned_seats === null || runSimulation.isPending}>
            <SlidersHorizontal size={16} /> {runSimulation.isPending ? 'Calculating…' : 'Run scenario'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={resetScenario}><RotateCcw size={16} /> Reset to baseline</button>
        </div>
        {runSimulation.isError && <p className="planning-error" role="alert">{(runSimulation.error as Error).message}</p>}
      </form>

      {runSimulation.data && (
        <section className="surface planning-result" aria-live="polite">
          <div className="section-heading"><div><p className="eyebrow">BASELINE VS SCENARIO</p><h2>{runSimulation.data.year} · sanctioned training seats</h2></div></div>
          <div className="scenario-values">
            <div><small>Baseline</small><strong>{runSimulation.data.baseline_seats.toLocaleString()}</strong><span>seats/year</span></div>
            <div><small>Scenario</small><strong>{runSimulation.data.scenario_seats.toLocaleString()}</strong><span>seats/year</span></div>
            <div><small>Change</small><strong>{runSimulation.data.delta_seats > 0 ? '+' : ''}{runSimulation.data.delta_seats.toLocaleString()}</strong><span>seats/year</span></div>
          </div>
          <p className="planning-assumption">Assumption: {runSimulation.data.adjustment.type === 'percent' ? `${runSimulation.data.adjustment.value}% change` : `${runSimulation.data.adjustment.value > 0 ? '+' : ''}${runSimulation.data.adjustment.value} seats`} applied to {runSimulation.data.baseline_seats.toLocaleString()} sanctioned seats. {runSimulation.data.adjustment.rounding}</p>
          <ul className="planning-limitations">{runSimulation.data.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </section>
      )}
    </div>
  );
};
