# Replacing AI Model Stubs with Real Models

This directory contains **placeholder AI/ML modules** for the LMIS system.
Each module returns deterministic mock data so the full system runs end-to-end.

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
- **Input**: `{district_id, trade_id, horizon_months, history?: [{month, demand, supply}]}`
- **Output**: `{forecasts: [{month, demand_forecast, supply_forecast, gap, lower_ci, upper_ci}]}`
- **Suggested approach**: Prophet, ARIMA, or Temporal Fusion Transformer

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

# Check model status
curl http://localhost:8000/ai/model-status

# Test your endpoint
curl -X POST http://localhost:8000/ai/forecast \
  -H "Content-Type: application/json" \
  -d '{"district_id": "MH-MUM", "trade_id": "HC-GDA", "horizon_months": 6}'
```

## Important Notes

- **Response schema must be preserved**: Your model's output must match the Pydantic response schemas
- **Set `is_mock: false`** in responses when using real models
- **Set `_is_mock = False`** on the model class to report correctly in `/ai/model-status`
- **Graceful fallback**: The Node API will fall back to rule-based logic if the AI service is down
- **All models are singletons**: Loaded once at startup via `_model = YourModel(); _model.load()`
