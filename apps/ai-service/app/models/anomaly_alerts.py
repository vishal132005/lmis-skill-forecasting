"""
Anomaly & Early Warning Detector – Detects market anomalies and raises flags.

POST /ai/early-warning
Input: time series data
Output: list of flags with reason/explanation

TODO: Replace mock with anomaly detection model (e.g., Isolation Forest, LSTM autoencoder).
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel as PydanticBase, Field
from .base import BaseModel

router = APIRouter()

# ─── Pydantic Schemas ──────────────────────────────────────────

class TimeSeriesPoint(PydanticBase):
    """A single point in a time series."""
    month: str
    demand: float
    supply: float

class EarlyWarningRequest(PydanticBase):
    """Request to analyse time series for anomalies."""
    district_id: str = Field(..., description="District identifier")
    trade_id: str = Field(..., description="Trade identifier")
    series: list[TimeSeriesPoint] = Field(..., min_length=3, description="Time series data (min 3 points)")
    sensitivity: float = Field(default=0.5, ge=0, le=1, description="Detection sensitivity (0=low, 1=high)")

class WarningFlag(PydanticBase):
    """A detected anomaly or early warning."""
    type: str = Field(..., description="SATURATION | ACUTE_SHORTAGE | TREND_REVERSAL | SEASONAL_ANOMALY | DEMAND_SPIKE")
    severity: str = Field(..., description="LOW | MEDIUM | HIGH | CRITICAL")
    month: str = Field(..., description="Month where anomaly detected")
    reason: str = Field(..., description="Human-readable explanation")
    metric_value: float = Field(..., description="The anomalous metric value")
    expected_range: Optional[str] = Field(default=None, description="Expected range for context")
    confidence: float = Field(..., ge=0, le=1)

class EarlyWarningResponse(PydanticBase):
    """Response containing detected warnings."""
    is_mock: bool = True
    district_id: str
    trade_id: str
    flags: list[WarningFlag]
    series_length: int
    analysis_summary: str

# ─── Mock Model ────────────────────────────────────────────────

class AnomalyDetector(BaseModel):
    """Detects anomalies and generates early warnings from time series."""

    _name = "anomaly_alerts"
    _version = "0.1.0-mock"
    _is_mock = True

    def load(self) -> None:
        """Load anomaly detection model.

        # TODO: IMPLEMENT MODEL HERE
        # Load your anomaly detection model here.
        # Example:
        #   self.isolation_forest = joblib.load("iso_forest.pkl")
        #   self.lstm_ae = keras.models.load_model("lstm_autoencoder.h5")
        #   self._is_mock = False
        """
        self._loaded_at = datetime.now()

    def predict(self, input_data: dict) -> dict:
        """Detect anomalies in time series.

        # TODO: IMPLEMENT MODEL HERE
        # Replace the rule-based detection below with your ML model.
        """
        series = input_data["series"]
        district_id = input_data["district_id"]
        trade_id = input_data["trade_id"]
        sensitivity = input_data.get("sensitivity", 0.5)
        flags = []

        if len(series) < 3:
            return {
                "is_mock": self._is_mock,
                "district_id": district_id,
                "trade_id": trade_id,
                "flags": [],
                "series_length": len(series),
                "analysis_summary": "Insufficient data for analysis (need >= 3 points)",
            }

        # Rule-based detection (mock)
        # 1. Check for sustained shortage (demand > 1.5x supply for 3+ periods)
        shortage_streak = 0
        for point in series:
            if point["demand"] > point["supply"] * 1.5:
                shortage_streak += 1
            else:
                shortage_streak = 0

            if shortage_streak >= 3:
                flags.append(WarningFlag(
                    type="ACUTE_SHORTAGE",
                    severity="HIGH" if shortage_streak >= 5 else "MEDIUM",
                    month=point["month"],
                    reason=f"Demand has exceeded 1.5x supply for {shortage_streak} consecutive months",
                    metric_value=round(point["demand"] / max(point["supply"], 1), 2),
                    expected_range="0.8 - 1.2",
                    confidence=0.82,
                ))
                break

        # 2. Check for saturation (supply > 1.3x demand for 3+ periods)
        saturation_streak = 0
        for point in series:
            if point["supply"] > point["demand"] * 1.3:
                saturation_streak += 1
            else:
                saturation_streak = 0

            if saturation_streak >= 3:
                flags.append(WarningFlag(
                    type="SATURATION",
                    severity="HIGH" if saturation_streak >= 5 else "MEDIUM",
                    month=point["month"],
                    reason=f"Supply has exceeded 1.3x demand for {saturation_streak} consecutive months",
                    metric_value=round(point["supply"] / max(point["demand"], 1), 2),
                    expected_range="0.8 - 1.2",
                    confidence=0.78,
                ))
                break

        # 3. Check for demand spike (>30% increase in single month)
        for i in range(1, len(series)):
            prev_d = series[i - 1]["demand"]
            curr_d = series[i]["demand"]
            if prev_d > 0 and (curr_d - prev_d) / prev_d > 0.3:
                flags.append(WarningFlag(
                    type="DEMAND_SPIKE",
                    severity="MEDIUM",
                    month=series[i]["month"],
                    reason=f"Demand spiked by {round((curr_d - prev_d) / prev_d * 100)}% in a single month",
                    metric_value=curr_d,
                    expected_range=f"{round(prev_d * 0.9)}-{round(prev_d * 1.1)}",
                    confidence=0.7,
                ))
                break

        # 4. Check for trend reversal in last 6 points
        if len(series) >= 6:
            first_half = series[-6:-3]
            second_half = series[-3:]
            first_trend = (first_half[-1]["demand"] - first_half[0]["demand"]) / max(first_half[0]["demand"], 1)
            second_trend = (second_half[-1]["demand"] - second_half[0]["demand"]) / max(second_half[0]["demand"], 1)
            if first_trend > 0.05 and second_trend < -0.05:
                flags.append(WarningFlag(
                    type="TREND_REVERSAL",
                    severity="LOW",
                    month=second_half[0]["month"],
                    reason="Demand trend reversed from growth to decline",
                    metric_value=round(second_trend * 100, 1),
                    confidence=0.65,
                ))

        summary_parts = []
        if not flags:
            summary_parts.append("No anomalies detected in the time series.")
        else:
            summary_parts.append(f"Detected {len(flags)} warning(s).")
            for f in flags:
                summary_parts.append(f"- {f.type}: {f.reason}")

        return {
            "is_mock": self._is_mock,
            "district_id": district_id,
            "trade_id": trade_id,
            "flags": [f.model_dump() for f in flags],
            "series_length": len(series),
            "analysis_summary": " ".join(summary_parts),
        }


_model = AnomalyDetector()
_model.load()


@router.post("/early-warning", response_model=EarlyWarningResponse)
async def early_warning(request: EarlyWarningRequest) -> EarlyWarningResponse:
    """Analyse a demand-supply time series for anomalies and early warnings.

    Detects patterns like sustained shortages, market saturation,
    demand spikes, and trend reversals. Sensitivity parameter controls
    the detection threshold.

    **Mock mode**: Rule-based detection with fixed thresholds.
    **Real mode**: Will use Isolation Forest, LSTM autoencoder, or similar.
    """
    result = _model.predict(request.model_dump())
    return EarlyWarningResponse(**result)
