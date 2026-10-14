import React, { useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Download, ArrowRight } from 'lucide-react';
import { apiClient } from '../lib/apiClient';

type TableKey = 'job_posting_signals' | 'industry_hiring_signals' | 'eshram_signals' | 'training_capacity';

interface TableMeta {
  label: string;
  description: string;
  templateHeaders: string[];
  sampleRow: string[];
}

const TABLES: Record<TableKey, TableMeta> = {
  job_posting_signals: {
    label: 'Job Posting Signals',
    description: 'Aggregated monthly vacancy counts from job portals by district and trade.',
    templateHeaders: ['district_id', 'trade_id', 'month', 'postings_count', 'source'],
    sampleRow: ['DIST-MH-PUN', 'TRD-AUTO-EVM', '2025-01', '145', 'ncs_portal'],
  },
  industry_hiring_signals: {
    label: 'Industry Hiring Signals',
    description: 'Direct employer survey hiring data and verified industrial uptake.',
    templateHeaders: ['district_id', 'trade_id', 'month', 'hires'],
    sampleRow: ['DIST-MH-PUN', 'TRD-AUTO-EVM', '2025-01', '85'],
  },
  eshram_signals: {
    label: 'e-Shram Worker Registrations',
    description: 'Unorganized worker registrations and migrant inflow signals.',
    templateHeaders: ['district_id', 'trade_id', 'month', 'registered_workers'],
    sampleRow: ['DIST-MH-PUN', 'TRD-AUTO-EVM', '2025-01', '210'],
  },
  training_capacity: {
    label: 'Training Capacity & Placements',
    description: 'Annual sanctioned seats, enrolment, certification, and placement tracking.',
    templateHeaders: ['district_id', 'trade_id', 'year', 'sanctioned_seats', 'enrolled', 'certified', 'placed', 'placement_rate'],
    sampleRow: ['DIST-MH-PUN', 'TRD-AUTO-EVM', '2025', '200', '190', '175', '140', '0.80'],
  },
};

export function DataUpload() {
  const [selectedTable, setSelectedTable] = useState<TableKey>('job_posting_signals');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [csvContent, setCsvContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [result, setResult] = useState<{
    success: boolean;
    inserted?: number;
    rejected?: { index: number; reason: string }[];
    error?: string;
  } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvContent(text);
      parsePreview(text);
    };
    reader.readAsText(file);
  };

  const parsePreview = (text: string) => {
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      const rawHeaders = lines[0].split(',').map((h) => h.trim().replace(/^"/, '').replace(/"$/, ''));
      setHeaders(rawHeaders);
      const rows = lines.slice(1, 6).map((line) => line.split(',').map((v) => v.trim().replace(/^"/, '').replace(/"$/, '')));
      setPreviewRows(rows);
    } else {
      setHeaders([]);
      setPreviewRows([]);
    }
  };

  const handleDownloadTemplate = () => {
    const meta = TABLES[selectedTable];
    const content = [meta.templateHeaders.join(','), meta.sampleRow.join(',')].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `template_${selectedTable}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvContent) return;

    setIsUploading(true);
    setResult(null);

    try {
      const res = await apiClient.post('/data/upload', {
        table: selectedTable,
        csv: csvContent,
        mode,
      });
      setResult({
        success: true,
        inserted: res.data?.inserted ?? 0,
        rejected: res.data?.rejected ?? [],
      });
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Failed to upload CSV. Please verify column names and formatting.';
      setResult({
        success: false,
        error: errorMsg,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const activeMeta = TABLES[selectedTable];

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Upload size={24} className="text-blue" />
          Multi-Source Labour Market Data Upload
        </h1>
        <p className="page-subtitle" style={{ margin: '0.25rem 0 0 0', color: 'var(--muted)' }}>
          Ingest external labor-market observations, portal vacancy scrapers, industrial surveys, and training center datasets.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* Upload Form Card */}
        <div className="surface" style={{ padding: '1.5rem', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} />
            Data Ingestion Configuration
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.875rem' }}>
                Target Signal Table
              </label>
              <select
                className="form-select"
                value={selectedTable}
                onChange={(e) => {
                  setSelectedTable(e.target.value as TableKey);
                  setResult(null);
                }}
                style={{ width: '100%' }}
              >
                {Object.entries(TABLES).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
              <small style={{ display: 'block', marginTop: '0.25rem', color: 'var(--muted)' }}>
                {activeMeta.description}
              </small>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, fontSize: '0.875rem' }}>
                Ingestion Mode
              </label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                  <input
                    type="radio"
                    name="mode"
                    value="append"
                    checked={mode === 'append'}
                    onChange={() => setMode('append')}
                  />
                  Append / Update (Upsert)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                  <input
                    type="radio"
                    name="mode"
                    value="replace"
                    checked={mode === 'replace'}
                    onChange={() => setMode('replace')}
                  />
                  Full Replace (Truncate & Load)
                </label>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                  CSV File Selection
                </label>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="btn btn-outline"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <Download size={13} />
                  Download Sample CSV
                </button>
              </div>

              <div style={{
                border: '2px dashed var(--border)',
                borderRadius: '8px',
                padding: '1.5rem',
                textAlign: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
              }}>
                <input
                  type="file"
                  id="csv-file-input"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <label htmlFor="csv-file-input" className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Upload size={16} />
                  Choose CSV File
                </label>
                <span style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.85rem', color: fileName ? 'var(--text-primary)' : 'var(--muted)' }}>
                  {fileName ? `Selected: ${fileName}` : 'or drag and drop a .csv file here'}
                </span>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!csvContent || isUploading}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
            >
              {isUploading ? 'Validating and Ingesting…' : 'Ingest Data into LMIS'}
              <ArrowRight size={16} />
            </button>
          </form>

          {/* Result Banner */}
          {result && (
            <div style={{
              marginTop: '1.25rem',
              padding: '1rem',
              borderRadius: '6px',
              backgroundColor: result.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${result.success ? '#22c55e' : '#ef4444'}`,
            }}>
              {result.success ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#22c55e', fontWeight: 600 }}>
                    <CheckCircle2 size={18} />
                    Data Ingestion Successful!
                  </div>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                    Inserted <strong>{result.inserted}</strong> rows into <code>{selectedTable}</code>.
                  </p>
                  {result.rejected && result.rejected.length > 0 && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#f59e0b' }}>
                      ⚠️ {result.rejected.length} rows were skipped due to schema errors.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', color: '#ef4444' }}>
                  <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong>Upload Error:</strong>
                    <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>{result.error}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Expected Schema & Preview Card */}
        <div className="surface" style={{ padding: '1.5rem', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '0.5rem' }}>
            Expected Schema: <code>{selectedTable}</code>
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 0 }}>
            Ensure your CSV columns match the headers below:
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {activeMeta.templateHeaders.map((h) => (
              <span key={h} className="badge" style={{ backgroundColor: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', fontFamily: 'monospace' }}>
                {h}
              </span>
            ))}
          </div>

          <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>
            File Preview {previewRows.length > 0 && `(First ${previewRows.length} rows)`}
          </h3>

          {previewRows.length > 0 ? (
            <div style={{ overflowX: 'auto', maxHeight: '260px' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} style={{ padding: '0.4rem 0.6rem' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((val, cIdx) => (
                        <td key={cIdx} style={{ padding: '0.4rem 0.6rem' }}>{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '6px' }}>
              No CSV loaded. Select or drag a CSV file to inspect data columns before submitting.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
