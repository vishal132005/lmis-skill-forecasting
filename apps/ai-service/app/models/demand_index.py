"""
Demand Index Calculator – Computes unified demand index from multiple signals.

POST /ai/demand-index
Input: normalised signals per source for district+trade+period
Output: unified index + per-source weights/contributions

TODO: Replace mock with learned weighting model (e.g., factor analysis, Bayesian ensemble).
"""
from datetime import datetime
from typing import Dict, Optional
from fastapi import APIRouter
from pydantic import BaseModel as PydanticBase, Field
from .base import BaseModel

router = APIRouter()

# ─── Pydantic Schemas ──────────────────────────────────────────

class SignalInput(PydanticBase):
    """Normalised signal values from each data source."""
    job_postings: float = Field(..., ge=0, description="Normalised job posting count")
    industry_hiring: float = Field(..., ge=0, description="Normalised industry hiring count")
    eshram_registrations: float = Field(..., ge=0, description="e-Shram registered workers")
    plfs_employment_rate: Optional[float] = Field(default=None, ge=0, le=1, description="PLFS employment rate")
    ncs_vacancies: Optional[float] = Field(default=None, ge=0, description="NCS portal vacancies")

class DemandIndexRequest(PydanticBase):
    """Request to compute demand index for a district-trade-period."""
    district_id: str = Field(..., description="District identifier")
    trade_id: str = Field(..., description="Trade identifier")
    period: str = Field(..., description="Period (YYYY-MM format)")
    signals: SignalInput

class SourceContribution(PydanticBase):
    """Weight and contribution of each data source to the index."""
    source: str
    weight: float = Field(..., ge=0, le=1)
    raw_value: float
    weighted_value: float

class DemandIndexResponse(PydanticBase):
    """Response with computed demand index and breakdowns."""
    is_mock: bool = True
    district_id: str
    trade_id: str
    period: str
    index_value: float = Field(..., description="Unified demand index (0-1000 scale)")
    confidence: float = Field(..., ge=0, le=1, description="Index confidence based on data completeness")
    contributions: list[SourceContribution]
    data_completeness: float = Field(..., ge=0, le=1, description="Fraction of sources with data")

# ─── Mock Model ────────────────────────────────────────────────

# Default weights (to be learned from data in real implementation)
DEFAULT_WEIGHTS = {
    "job_postings": 0.35,
    "industry_hiring": 0.30,
    "eshram_registrations": 0.20,
    "plfs_employment_rate": 0.10,
    "ncs_vacancies": 0.05,
}


class DemandIndexModel(BaseModel):
    """Computes a unified demand index from multiple signal sources."""

    _name = "demand_index"
    _version = "0.1.0-mock"
    _is_mock = True

    def load(self) -> None:
        """Load demand index model.

        # TODO: IMPLEMENT MODEL HERE
        # Load your learned weights or factor model here.
        # Example:
        #   self.weight_model = joblib.load("weights_model.pkl")
        #   self._is_mock = False
        """
        self._loaded_at = datetime.now()

    def predict(self, input_data: dict) -> dict:
        """Compute demand index from signals.

        # TODO: IMPLEMENT MODEL HERE
        # Replace the fixed-weight formula below with your learned model.
        """
        signals = input_data["signals"]
        contributions = []
        total_index = 0.0
        sources_available = 0

        for source, weight in DEFAULT_WEIGHTS.items():
            value = signals.get(source)
            if value is not None:
                sources_available += 1
                weighted = value * weight
                total_index += weighted
                contributions.append(SourceContribution(
                    source=source,
                    weight=weight,
                    raw_value=value,
                    weighted_value=round(weighted, 2),
                ))

        completeness = sources_available / len(DEFAULT_WEIGHTS)
        confidence = min(1.0, completeness * 0.8 + 0.2)

        return {
            "is_mock": self._is_mock,
            "district_id": input_data["district_id"],
            "trade_id": input_data["trade_id"],
            "period": input_data["period"],
            "index_value": round(total_index, 2),
            "confidence": round(confidence, 2),
            "contributions": [c.model_dump() for c in contributions],
            "data_completeness": round(completeness, 2),
        }


_model = DemandIndexModel()
_model.load()


@router.post("/demand-index", response_model=DemandIndexResponse)
async def compute_demand_index(request: DemandIndexRequest) -> DemandIndexResponse:
    """Compute a unified demand index from multiple normalised signal sources.

    Combines job postings, industry hiring data, e-Shram registrations,
    PLFS employment rate, and NCS vacancies into a single index value
    with per-source contribution breakdown.

    **Mock mode**: Uses fixed weights (35% jobs, 30% hiring, 20% e-Shram, 10% PLFS, 5% NCS).
    **Real mode**: Will use learned weights from factor analysis or Bayesian ensemble.
    """
    result = _model.predict(request.model_dump())
    return DemandIndexResponse(**result)
