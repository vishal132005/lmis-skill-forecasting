"""
Explainer – Provides feature/driver breakdowns for forecasts and alerts.

POST /ai/explain
Input: forecast/alert ID or context
Output: driver breakdown (feature contributions)

TODO: Replace mock with SHAP/LIME-based explainability on actual models.
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel as PydanticBase, Field
from .base import BaseModel

router = APIRouter()

# ─── Pydantic Schemas ──────────────────────────────────────────

class ExplainRequest(PydanticBase):
    """Request to explain a forecast or alert."""
    entity_type: str = Field(..., description="Type: 'forecast' | 'alert' | 'gap_score'")
    district_id: str
    trade_id: str
    period: Optional[str] = Field(default=None, description="Period for context (YYYY-MM)")
    alert_id: Optional[str] = Field(default=None, description="Alert ID if explaining an alert")

class DriverContribution(PydanticBase):
    """A single factor contributing to the prediction."""
    factor: str = Field(..., description="Factor name")
    contribution: float = Field(..., description="Contribution magnitude (can be negative)")
    direction: str = Field(..., description="POSITIVE | NEGATIVE | NEUTRAL")
    description: str = Field(..., description="Human-readable explanation")

class ExplainResponse(PydanticBase):
    """Response with explainability breakdown."""
    is_mock: bool = True
    entity_type: str
    district_id: str
    trade_id: str
    drivers: list[DriverContribution]
    summary: str = Field(..., description="Plain-language summary of key drivers")
    methodology: str = Field(default="mock_rule_based", description="Explainability method used")

# ─── Mock Model ────────────────────────────────────────────────

# Pre-built driver explanations by sector pattern
MOCK_DRIVERS = {
    "SHORTAGE": [
        DriverContribution(factor="Industry Growth", contribution=0.35, direction="POSITIVE",
                          description="Sector experiencing rapid growth, increasing labour demand"),
        DriverContribution(factor="Training Pipeline", contribution=-0.25, direction="NEGATIVE",
                          description="Insufficient training centres and seats to meet demand"),
        DriverContribution(factor="Policy Push", contribution=0.20, direction="POSITIVE",
                          description="Government schemes driving sectoral expansion"),
        DriverContribution(factor="Migration", contribution=0.10, direction="POSITIVE",
                          description="Skilled workers migrating to other districts/states"),
        DriverContribution(factor="Certification Rate", contribution=-0.10, direction="NEGATIVE",
                          description="Low certification rates reducing effective supply"),
    ],
    "OVERSUPPLY": [
        DriverContribution(factor="Market Saturation", contribution=0.30, direction="POSITIVE",
                          description="Too many candidates trained for declining demand"),
        DriverContribution(factor="Automation Risk", contribution=0.25, direction="POSITIVE",
                          description="Technology replacing manual roles in this trade"),
        DriverContribution(factor="Excess Centres", contribution=0.20, direction="POSITIVE",
                          description="Unchecked growth in training centre approvals"),
        DriverContribution(factor="Demand Decline", contribution=-0.15, direction="NEGATIVE",
                          description="Industry demand declining due to market shifts"),
        DriverContribution(factor="Low Placement", contribution=-0.10, direction="NEGATIVE",
                          description="Poor industry linkage reducing effective demand signals"),
    ],
    "BALANCED": [
        DriverContribution(factor="Stable Demand", contribution=0.05, direction="NEUTRAL",
                          description="Steady industry demand with moderate growth"),
        DriverContribution(factor="Adequate Supply", contribution=0.03, direction="NEUTRAL",
                          description="Training capacity reasonably aligned with demand"),
        DriverContribution(factor="Seasonal Factors", contribution=-0.02, direction="NEUTRAL",
                          description="Minor seasonal fluctuations within normal range"),
    ],
}


class ExplainerModel(BaseModel):
    """Provides interpretable explanations for model outputs."""

    _name = "explainer"
    _version = "0.1.0-mock"
    _is_mock = True

    def load(self) -> None:
        """Load explainer model.

        # TODO: IMPLEMENT MODEL HERE
        # Set up SHAP/LIME explainer for your trained models.
        # Example:
        #   self.shap_explainer = shap.TreeExplainer(your_model)
        #   self._is_mock = False
        """
        self._loaded_at = datetime.now()

    def predict(self, input_data: dict) -> dict:
        """Generate explanation for a prediction.

        # TODO: IMPLEMENT MODEL HERE
        # Replace mock drivers with SHAP values from your actual model.
        """
        import hashlib
        seed_str = f"{input_data['district_id']}-{input_data['trade_id']}"
        seed = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) % 3

        categories = ["SHORTAGE", "OVERSUPPLY", "BALANCED"]
        category = categories[seed]
        drivers = MOCK_DRIVERS[category]

        summary_map = {
            "SHORTAGE": f"The primary driver for the gap in {input_data['trade_id']} is rapid industry growth "
                       f"outpacing the training pipeline. Expanding training capacity is recommended.",
            "OVERSUPPLY": f"Market saturation and automation risk are the key factors causing oversupply in "
                         f"{input_data['trade_id']}. Consider redirecting candidates to shortage trades.",
            "BALANCED": f"The market for {input_data['trade_id']} is currently well-balanced with stable "
                       f"demand and adequate supply. Maintain current capacity levels.",
        }

        return {
            "is_mock": self._is_mock,
            "entity_type": input_data["entity_type"],
            "district_id": input_data["district_id"],
            "trade_id": input_data["trade_id"],
            "drivers": [d.model_dump() for d in drivers],
            "summary": summary_map[category],
            "methodology": "mock_rule_based",
        }


_model = ExplainerModel()
_model.load()


@router.post("/explain", response_model=ExplainResponse)
async def explain(request: ExplainRequest) -> ExplainResponse:
    """Explain the key drivers behind a forecast, alert, or gap score.

    Provides a breakdown of contributing factors with magnitudes and
    human-readable descriptions. Useful for understanding why a
    particular prediction was made.

    **Mock mode**: Returns pre-built driver templates based on gap category.
    **Real mode**: Will use SHAP/LIME values from actual trained models.
    """
    result = _model.predict(request.model_dump())
    return ExplainResponse(**result)
