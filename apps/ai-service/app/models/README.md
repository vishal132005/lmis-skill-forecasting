# Replacing AI Model Stubs with Real Models

This directory contains placeholder AI/ML modules for the LMIS system. The
forecaster is an exception: it runs deterministic statistical baselines over
the supplied source history. It is not a trained ML model. Other model modules
remain placeholders.

## Architecture

```
models/
├── base.py              # Abstract BaseModel class (inherit from this)
├── taxonomy_mapper.py   # POST /ai/map-job-title
├── demand_index.py      # POST /ai/demand-index
├── forecaster.py        # POST /ai/forecast
├── gap_scorer.py        # POST /ai/gap-score
├── anomaly_alerts.py    # POST /ai/early-warning
├── explainer.py         # POST /ai/explain
└── README.md            # This file
```

## How to Replace a Stub

### Step 1: Find the `# TODO: IMPLEMENT MODEL HERE` markers

Each model file has two clearly marked locations:

1. **`load()` method** – where you load model weights/artifacts
2. **`predict()` method** – where you run inference

### Step 2: Implement your model class

```python
# Example: Replacing the forecaster with a Prophet model

class ForecasterModel(BaseModel):
    _name = "forecaster"
    _version = "1.0.0"
    _is_mock = False  # ← Change to False!

    def load(self):
        from prophet import Prophet
        self.demand_model = Prophet()
        # Load pre-trained parameters...
        self._loaded_at = datetime.now()

    def predict(self, input_data: dict) -> dict:
        # Your inference logic here
        # input_data matches the Pydantic request schema
        # Return a dict matching the response schema
        ...
```

### Step 3: Set environment variable

```env
USE_MOCK_MODELS=false
```

### Step 4: Install additional dependencies

Add your model's dependencies to `requirements.txt`:
```
prophet==1.1.5
torch==2.1.0
transformers==4.35.0
```

## Module Contracts

### 1. Taxonomy Mapper (`taxonomy_mapper.py`)
- **Endpoint**: `POST /ai/map-job-title`
- **Input**: `{job_title: str, language: str, context?: str}`
- **Output**: `{mappings: [{nco_code, nsqf_level, qp_code, trade_name, sector, confidence}]}`
- **Suggested approach**: Fine-tuned BERT/mBERT on NCO taxonomy with multi-label classification

### 2. Demand Index (`demand_index.py`)
- **Endpoint**: `POST /ai/demand-index`
- **Input**: `{district_id, trade_id, period, signals: {job_postings, industry_hiring, ...}}`
- **Output**: `{index_value, confidence, contributions: [{source, weight, raw_value, weighted_value}]}`
- **Suggested approach**: Bayesian factor analysis or learned ensemble weighting

### 3. Forecaster (`forecaster.py`)
- **Endpoint**: `POST /ai/forecast`
- **Input**: `{district_id, trade_id, horizon_months, sources: {job_postings: [{period, value}], industry_hiring: [{period, value}]}}`
- **Output**: source-specific chronological history and forecasts, selected method, rolling-origin MAE/RMSE, evaluation windows, and explicit availability/insufficient-history status.
- **Methods**: last observation, seasonal naive (requires 24 months), and damped linear trend. Candidate selection uses MAE over common rolling-origin windows; the supported horizon is 1–12 months.
- **Missing months**: never filled with zero; a series with gaps is not forecast.
- **Uncertainty**: prediction intervals are unavailable; no confidence interval is returned.
- Job postings are summed across the available `source` labels. The current schema has no posting identity for deduplication across portals.
- **Provenance**: the current Express API labels outputs from the seeded SQLite histories as synthetic demonstration data.
- **Contract note**: the earlier mock `{history: [{month, demand, supply}]}` contract had no Express or frontend caller in the repository and forecast table records are not used as history. It has been replaced with independent source histories to avoid combining unlike signals or forecasting the legacy mock supply series.

### 4. Gap Scorer (`gap_scorer.py`)
- **Endpoint**: `POST /ai/gap-score`
- **Input**: `{district_id, trade_id, demand_forecast, supply_forecast, demand_trend, supply_trend}`
- **Output**: `{gap, severity_score (0-100), category, recommended_action}`
- **Suggested approach**: Gradient boosting with economic context features

### 5. Anomaly Alerts (`anomaly_alerts.py`)
- **Endpoint**: `POST /ai/early-warning`
- **Input**: `{district_id, trade_id, series: [{month, demand, supply}], sensitivity}`
- **Output**: `{flags: [{type, severity, month, reason, metric_value, confidence}]}`
- **Suggested approach**: Isolation Forest + LSTM autoencoder hybrid

### 6. Explainer (`explainer.py`)
- **Endpoint**: `POST /ai/explain`
- **Input**: `{entity_type, district_id, trade_id, period?, alert_id?}`
- **Output**: `{drivers: [{factor, contribution, direction, description}], summary}`
- **Suggested approach**: SHAP TreeExplainer or LIME

## Testing Your Model

```bash
# Start the AI service
cd apps/ai-service
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000

# Run the forecasting baseline tests
python -m unittest discover -s tests

# Check model status
curl http://localhost:8000/ai/model-status

# Test your endpoint
# This one-month example demonstrates the request shape and returns
# `insufficient_history`; forecasts require enough consecutive observations.
curl -X POST http://localhost:8000/ai/forecast \
  -H "Content-Type: application/json" \
  -d '{"district_id": "MH-MUM", "trade_id": "HC-GDA", "horizon_months": 6, "sources": {"job_postings": [{"period": "2024-01", "value": 80}], "industry_hiring": []}}'
```

## Important Notes

- The forecaster reports `is_mock: false` in model status because its results are calculated from supplied histories; this does not mean it is a trained ML model or that the synthetic data is real.
- Forecast requests through the Express API return a classified service error when the Python service is unavailable. They do not return fallback or fabricated predictions.
- The existing `GET /api/v1/forecasts` endpoint remains the compatibility route for previously stored demonstration forecasts; it is not used as forecast history.
- **All models are singletons**: Loaded once at startup via `_model = YourModel(); _model.load()`
