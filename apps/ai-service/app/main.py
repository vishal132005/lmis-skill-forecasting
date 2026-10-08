"""
LMIS AI Service – FastAPI application.

Provides ML/AI endpoints for the Labour Market Intelligence System.
All models are stubs returning mock data by default (USE_MOCK_MODELS=true).
See app/models/README.md for how to replace stubs with real models.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

from .config import settings
from .models import (
    taxonomy_router,
    demand_index_router,
    forecaster_router,
    gap_scorer_router,
    anomaly_alerts_router,
    explainer_router,
)
from .models.taxonomy_mapper import _model as taxonomy_model
from .models.demand_index import _model as demand_index_model
from .models.forecaster import _model as forecaster_model
from .models.gap_scorer import _model as gap_scorer_model
from .models.anomaly_alerts import _model as anomaly_model
from .models.explainer import _model as explainer_model

app = FastAPI(
    title="LMIS AI Service",
    description=(
        "Machine Learning and AI endpoints for the Labour Market Intelligence System (LMIS). "
        "Provides taxonomy mapping, demand indexing, forecasting, gap scoring, anomaly detection, "
        "and explainability. All endpoints return mock data by default."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount AI routers
app.include_router(taxonomy_router, prefix="/ai", tags=["Taxonomy"])
app.include_router(demand_index_router, prefix="/ai", tags=["Demand Index"])
app.include_router(forecaster_router, prefix="/ai", tags=["Forecasting"])
app.include_router(gap_scorer_router, prefix="/ai", tags=["Gap Scoring"])
app.include_router(anomaly_alerts_router, prefix="/ai", tags=["Early Warning"])
app.include_router(explainer_router, prefix="/ai", tags=["Explainability"])


@app.get("/health", tags=["System"])
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "lmis-ai-service",
        "version": "0.1.0",
        "timestamp": datetime.now().isoformat(),
        "mock_mode": settings.USE_MOCK_MODELS,
    }


@app.get("/ai/model-status", tags=["System"])
async def model_status():
    """Report status of all AI model modules (mock vs real)."""
    models = [
        taxonomy_model,
        demand_index_model,
        forecaster_model,
        gap_scorer_model,
        anomaly_model,
        explainer_model,
    ]
    return {
        "use_mock_models_config": settings.USE_MOCK_MODELS,
        "models": [m.status() for m in models],
        "all_mock": all(m.is_mock for m in models),
        "timestamp": datetime.now().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.AI_HOST, port=settings.AI_PORT)
