"""
Gap Scorer – Computes gap severity from demand vs supply forecasts.

POST /ai/gap-score
Input: demand forecast, supply forecast
Output: gap, severity score (0-100), category (OVERSUPPLY | BALANCED | SHORTAGE)

TODO: Replace mock with ML-based severity model incorporating economic context.
"""
from datetime import datetime
from fastapi import APIRouter
from pydantic import BaseModel as PydanticBase, Field
from .base import BaseModel

router = APIRouter()

# ─── Pydantic Schemas ──────────────────────────────────────────

class GapScoreRequest(PydanticBase):
    """Request to compute gap severity score."""
    district_id: str = Field(..., description="District identifier")
    trade_id: str = Field(..., description="Trade identifier")
    demand_forecast: float = Field(..., ge=0, description="Forecasted demand (e.g., average monthly)")
    supply_forecast: float = Field(..., ge=0, description="Forecasted supply (e.g., certified output)")
    demand_trend: float = Field(default=0.0, description="Demand growth rate (monthly %)")
    supply_trend: float = Field(default=0.0, description="Supply growth rate (monthly %)")

class GapScoreResponse(PydanticBase):
    """Response with gap analysis results."""
    is_mock: bool = True
    district_id: str
    trade_id: str
    gap: float = Field(..., description="Absolute gap (demand - supply)")
    gap_ratio: float = Field(..., description="Gap as ratio of demand")
    severity_score: float = Field(..., ge=0, le=100, description="Severity score (0=balanced, 100=extreme)")
    category: str = Field(..., description="OVERSUPPLY | BALANCED | SHORTAGE")
    recommended_action: str = Field(..., description="Brief recommended action")
    confidence: float = Field(..., ge=0, le=1)

# ─── Mock Model ────────────────────────────────────────────────

class GapScorerModel(BaseModel):
    """Scores the severity of demand-supply gaps."""

    _name = "gap_scorer"
    _version = "0.1.0-mock"
    _is_mock = True

    def load(self) -> None:
        """Load gap scoring model.

        # TODO: IMPLEMENT MODEL HERE
        # Load your severity model here. Could incorporate:
        # - Economic indicators (GDP growth, FDI in sector)
        # - Historical placement rates
        # - Regional labor mobility data
        #   self._is_mock = False
        """
        self._loaded_at = datetime.now()

    def predict(self, input_data: dict) -> dict:
        """Compute gap severity score.

        # TODO: IMPLEMENT MODEL HERE
        # Replace the rule-based scoring below with your ML model.
        """
        demand = input_data["demand_forecast"]
        supply = input_data["supply_forecast"]
        d_trend = input_data.get("demand_trend", 0)
        s_trend = input_data.get("supply_trend", 0)

        gap = demand - supply
        denominator = max(demand, 1)
        gap_ratio = gap / denominator

        # Score based on gap ratio and trend divergence
        trend_factor = max(0, (d_trend - s_trend) * 10)  # Amplify diverging trends

        if gap_ratio > 0.1:  # Shortage
            severity = min(100, abs(gap_ratio) * 80 + trend_factor * 20)
            category = "SHORTAGE"
            if severity > 70:
                action = "Urgently increase training capacity; consider new centres and fast-track certification"
            elif severity > 40:
                action = "Increase sanctioned seats by 30-50%; enhance industry partnerships"
            else:
                action = "Moderate seat increase recommended; monitor trend"
        elif gap_ratio < -0.1:  # Oversupply
            severity = min(100, abs(gap_ratio) * 80 + max(0, s_trend - d_trend) * 200)
            category = "OVERSUPPLY"
            if severity > 70:
                action = "Significantly reduce seats; redirect candidates to shortage trades; RPL pathways"
            elif severity > 40:
                action = "Freeze new centre approvals; reduce seats by 20-30%"
            else:
                action = "Slight seat reduction; focus on quality and placement linkage"
        else:
            severity = abs(gap_ratio) * 50
            category = "BALANCED"
            action = "Maintain current capacity; focus on certification and placement rates"

        return {
            "is_mock": self._is_mock,
            "district_id": input_data["district_id"],
            "trade_id": input_data["trade_id"],
            "gap": round(gap, 1),
            "gap_ratio": round(gap_ratio, 4),
            "severity_score": round(severity, 1),
            "category": category,
            "recommended_action": action,
            "confidence": 0.75,
        }


_model = GapScorerModel()
_model.load()


@router.post("/gap-score", response_model=GapScoreResponse)
async def compute_gap_score(request: GapScoreRequest) -> GapScoreResponse:
    """Compute the severity of a demand-supply gap for a district-trade pair.

    Analyses the gap magnitude, direction, and trend to produce a severity
    score (0-100) and categorisation (OVERSUPPLY / BALANCED / SHORTAGE)
    with actionable recommendations.

    **Mock mode**: Rule-based scoring with ratio and trend analysis.
    **Real mode**: Will use ML model incorporating economic context.
    """
    result = _model.predict(request.model_dump())
    return GapScoreResponse(**result)
