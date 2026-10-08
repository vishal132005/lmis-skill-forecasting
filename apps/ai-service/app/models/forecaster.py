"""
Forecaster – Predicts demand and supply for future months.

POST /ai/forecast
Input: district, trade, horizon (months), history
Output: demand and supply forecast with confidence interval, per month

TODO: Replace mock with time-series model (e.g., Prophet, ARIMA, LSTM, Temporal Fusion Transformer).
"""
import math
import hashlib
from datetime import datetime
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel as PydanticBase, Field
from .base import BaseModel

router = APIRouter()

# ─── Pydantic Schemas ──────────────────────────────────────────

class HistoryPoint(PydanticBase):
    """A single historical data point."""
    month: str = Field(..., description="YYYY-MM format")
    demand: float = Field(..., ge=0)
    supply: float = Field(..., ge=0)

class ForecastRequest(PydanticBase):
    """Request for demand/supply forecast."""
    district_id: str = Field(..., description="District identifier")
    trade_id: str = Field(..., description="Trade identifier")
    horizon_months: int = Field(default=12, ge=1, le=36, description="Forecast horizon in months")
    history: list[HistoryPoint] = Field(default=[], description="Historical demand/supply data (optional, used if available)")

class ForecastPoint(PydanticBase):
    """Single month forecast with confidence interval."""
    month: str
    demand_forecast: float
    supply_forecast: float
    gap: float = Field(..., description="demand - supply (positive = shortage)")
    lower_ci: float = Field(..., description="Lower 90% confidence bound for gap")
    upper_ci: float = Field(..., description="Upper 90% confidence bound for gap")

class ForecastResponse(PydanticBase):
    """Response containing multi-month forecast."""
    is_mock: bool = True
    district_id: str
    trade_id: str
    horizon_months: int
    forecasts: list[ForecastPoint]
    model_used: str = Field(default="mock_linear_trend", description="Model identifier")
    fit_metrics: Optional[dict] = Field(default=None, description="Model fit metrics (MAPE, RMSE etc.)")

# ─── Mock Model ────────────────────────────────────────────────

class ForecasterModel(BaseModel):
    """Forecasts demand and supply time series with confidence intervals."""

    _name = "forecaster"
    _version = "0.1.0-mock"
    _is_mock = True

    def load(self) -> None:
        """Load forecasting model.

        # TODO: IMPLEMENT MODEL HERE
        # Load your time-series model here.
        # Example:
        #   self.demand_model = Prophet()
        #   self.supply_model = Prophet()
        #   self.demand_model.fit(demand_df)
        #   self._is_mock = False
        """
        self._loaded_at = datetime.now()

    def predict(self, input_data: dict) -> dict:
        """Generate demand/supply forecast.

        # TODO: IMPLEMENT MODEL HERE
        # Replace the linear extrapolation below with your time-series model.
        """
        district_id = input_data["district_id"]
        trade_id = input_data["trade_id"]
        horizon = input_data["horizon_months"]
        history = input_data.get("history", [])

        # Derive base values from history or generate deterministic mock
        seed_str = f"{district_id}-{trade_id}"
        seed = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) % 10000

        if history and len(history) >= 3:
            last_demand = history[-1]["demand"]
            last_supply = history[-1]["supply"]
            # Simple trend from last 3 points
            d_trend = (history[-1]["demand"] - history[-3]["demand"]) / (2 * history[-3]["demand"] + 1)
            s_trend = (history[-1]["supply"] - history[-3]["supply"]) / (2 * history[-3]["supply"] + 1)
        else:
            last_demand = 100 + (seed % 400)
            last_supply = 80 + (seed % 300)
            d_trend = 0.02 + (seed % 50) / 1000
            s_trend = 0.01 + (seed % 30) / 1000

        forecasts = []
        base_year = 2026
        base_month = 10

        for h in range(1, horizon + 1):
            m = (base_month + h - 1) % 12
            y = base_year + (base_month + h - 1) // 12
            month_str = f"{y}-{str(m + 1).zfill(2)}" if m < 12 else f"{y}-{str(m - 11).zfill(2)}"

            # Apply trend + slight seasonality
            seasonal = 0.1 * math.sin(2 * math.pi * m / 12)
            d_forecast = max(10, round(last_demand * (1 + d_trend * h) * (1 + seasonal)))
            s_forecast = max(5, round(last_supply * (1 + s_trend * h)))
            gap = d_forecast - s_forecast

            # Widen CI with horizon
            uncertainty = round(abs(d_forecast) * 0.12 * math.sqrt(h))
            forecasts.append(ForecastPoint(
                month=month_str,
                demand_forecast=d_forecast,
                supply_forecast=s_forecast,
                gap=gap,
                lower_ci=gap - uncertainty,
                upper_ci=gap + uncertainty,
            ).model_dump())

        return {
            "is_mock": self._is_mock,
            "district_id": district_id,
            "trade_id": trade_id,
            "horizon_months": horizon,
            "forecasts": forecasts,
            "model_used": "mock_linear_trend",
            "fit_metrics": {"mape": 0.15, "rmse": 42.3} if not self._is_mock else None,
        }


_model = ForecasterModel()
_model.load()


@router.post("/forecast", response_model=ForecastResponse)
async def forecast(request: ForecastRequest) -> ForecastResponse:
    """Generate demand and supply forecasts for a district-trade pair.

    Produces monthly forecasts with 90% confidence intervals for the
    specified horizon. Can optionally use provided historical data
    to improve predictions.

    **Mock mode**: Linear trend extrapolation with sinusoidal seasonality.
    **Real mode**: Will use time-series models (Prophet/ARIMA/TFT).
    """
    result = _model.predict(request.model_dump())
    return ForecastResponse(**result)
