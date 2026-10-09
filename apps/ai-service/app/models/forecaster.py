"""Statistical monthly forecasts for independent labour-demand signals."""

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel as PydanticBase, Field

from .base import BaseModel
from .forecast_engine import forecast_demand_sources

router = APIRouter()


class HistoryPoint(PydanticBase):
    period: str
    value: Any


class SourceHistory(PydanticBase):
    job_postings: list[HistoryPoint] = Field(default_factory=list)
    industry_hiring: list[HistoryPoint] = Field(default_factory=list)


class ForecastRequest(PydanticBase):
    district_id: str = Field(..., min_length=1)
    trade_id: str = Field(..., min_length=1)
    horizon_months: int = Field(default=12, ge=1, le=12)
    sources: SourceHistory


class ForecastPoint(PydanticBase):
    period: str
    value: float = Field(..., ge=0, allow_inf_nan=False)


class HistoricalPoint(PydanticBase):
    period: str
    value: float = Field(..., ge=0, allow_inf_nan=False)


class OriginEvaluation(PydanticBase):
    cutoff_period: str
    target_periods: list[str]
    training_observations: int
    mae: float = Field(..., ge=0, allow_inf_nan=False)
    rmse: float = Field(..., ge=0, allow_inf_nan=False)


class CandidateEvaluation(PydanticBase):
    method: str
    mae: float = Field(..., ge=0, allow_inf_nan=False)
    rmse: float = Field(..., ge=0, allow_inf_nan=False)
    evaluation_windows: int
    evaluation_observations: int
    training_observations_min: int
    training_observations_max: int
    minimum_history: int
    origins: list[OriginEvaluation]


class ForecastEvaluation(PydanticBase):
    selected_method: str
    mae: float = Field(..., ge=0, allow_inf_nan=False)
    rmse: float = Field(..., ge=0, allow_inf_nan=False)
    evaluation_windows: int
    evaluation_observations: int
    training_observations_min: int
    training_observations_max: int
    forecast_horizon_months: int
    minimum_history: int
    minimum_history_met: bool
    candidate_methods: list[CandidateEvaluation]


class SourceForecast(PydanticBase):
    source: Literal["job_postings", "industry_hiring"]
    status: Literal["forecasted", "insufficient_history", "unavailable_source"]
    reason: str | None
    method: str | None
    history: list[HistoricalPoint]
    history_observation_count: int
    forecast: list[ForecastPoint]
    evaluation: ForecastEvaluation | None
    missing_periods: list[str]
    invalid_observation_count: int


class ForecastSources(PydanticBase):
    job_postings: SourceForecast
    industry_hiring: SourceForecast


class Methodology(PydanticBase):
    name: str
    version: str
    selection_metric: str
    minimum_history_months: int
    minimum_evaluation_windows: int
    seasonal_naive_minimum_history_months: int
    methods: list[str]
    method_details: dict[str, str]
    missing_history_policy: str
    invalid_data_policy: str
    uncertainty: str


class ForecastResponse(PydanticBase):
    district_id: str
    trade_id: str
    horizon_months: int
    methodology_version: str
    methodology: Methodology
    sources: ForecastSources
    limitations: list[str]


class ForecasterModel(BaseModel):
    """Data-driven statistical baselines; no learned weights or synthetic fallback."""

    _name = "forecaster"
    _version = "1.0.0-statistical"
    _is_mock = False

    def load(self) -> None:
        self._loaded_at = datetime.now()

    def predict(self, input_data: dict[str, Any]) -> dict[str, Any]:
        histories = {
            source: input_data["sources"][source]
            for source in ("job_postings", "industry_hiring")
        }
        return forecast_demand_sources(
            district_id=input_data["district_id"],
            trade_id=input_data["trade_id"],
            horizon=input_data["horizon_months"],
            sources=histories,
        )


_model = ForecasterModel()
_model.load()


@router.post("/forecast", response_model=ForecastResponse)
async def forecast(request: ForecastRequest) -> ForecastResponse:
    """Compare rolling-origin statistical forecasts for each supplied source history."""
    result = _model.predict(request.model_dump())
    return ForecastResponse(**result)
