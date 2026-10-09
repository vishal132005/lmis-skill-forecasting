"""Transparent statistical baselines for monthly source-signal forecasting."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Iterable

MIN_HISTORY = 6
MIN_SEASONAL_HISTORY = 24
MIN_EVALUATION_WINDOWS = 3
TREND_DAMPING = 0.8
METHODOLOGY_VERSION = "TSF-v1"

METHODS: tuple[tuple[str, int], ...] = (
    ("last_observation", MIN_HISTORY),
    ("seasonal_naive", MIN_SEASONAL_HISTORY),
    ("damped_linear_trend", MIN_HISTORY),
)
PERIOD_PATTERN = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


@dataclass(frozen=True)
class MonthlyValue:
    period: str
    value: float


def _parse_period(period: Any) -> tuple[int, int] | None:
    if not isinstance(period, str):
        return None
    match = PERIOD_PATTERN.fullmatch(period)
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2))


def _next_period(period: str, offset: int = 1) -> str:
    parsed = _parse_period(period)
    if parsed is None:
        raise ValueError(f"Invalid monthly period: {period!r}")
    year, month = parsed
    absolute_month = year * 12 + month - 1 + offset
    return f"{absolute_month // 12:04d}-{absolute_month % 12 + 1:02d}"


def _valid_count(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        numeric = float(value)
    except (OverflowError, ValueError):
        return None
    if not math.isfinite(numeric) or numeric < 0 or not numeric.is_integer():
        return None
    return numeric


def aggregate_monthly_observations(
    observations: Iterable[dict[str, Any]],
) -> tuple[list[MonthlyValue], int]:
    """Sum duplicate month rows; count and omit malformed periods or counts."""
    totals: dict[str, float] = {}
    invalid_count = 0
    for observation in observations:
        period = observation.get("period")
        value = _valid_count(observation.get("value"))
        if _parse_period(period) is None or value is None:
            invalid_count += 1
            continue
        total = totals.get(period, 0.0) + value
        if not math.isfinite(total):
            invalid_count += 1
            continue
        totals[period] = total
    return (
        [MonthlyValue(period, totals[period]) for period in sorted(totals)],
        invalid_count,
    )


def missing_months(periods: list[str]) -> list[str]:
    if len(periods) < 2:
        return []
    missing: list[str] = []
    current = periods[0]
    for expected_period in periods[1:]:
        current = _next_period(current)
        while current < expected_period:
            missing.append(current)
            current = _next_period(current)
    return missing


def _forecast_candidate(
    method: str, training: list[float], horizon: int
) -> list[float] | None:
    if method == "last_observation":
        predictions = [training[-1]] * horizon
    elif method == "seasonal_naive":
        if len(training) < MIN_SEASONAL_HISTORY:
            return None
        seasonal_values = training[-12:]
        predictions = [seasonal_values[index % 12] for index in range(horizon)]
    elif method == "damped_linear_trend":
        count = len(training)
        mean_x = (count - 1) / 2
        mean_y = sum(training) / count
        denominator = sum((index - mean_x) ** 2 for index in range(count))
        if denominator == 0:
            slope = 0.0
        else:
            slope = sum(
                (index - mean_x) * (value - mean_y)
                for index, value in enumerate(training)
            ) / denominator
        predictions = []
        damped_steps = 0.0
        damping_factor = 1.0
        for _ in range(horizon):
            damping_factor *= TREND_DAMPING
            damped_steps += damping_factor
            predictions.append(max(0.0, training[-1] + slope * damped_steps))
    else:
        raise ValueError(f"Unknown forecasting method: {method}")

    if any(not math.isfinite(value) for value in predictions):
        return None
    return [max(0.0, value) for value in predictions]


def _metrics(
    errors: list[float], squared_errors: list[float]
) -> dict[str, float] | None:
    mae = sum(errors) / len(errors)
    squared_error_sum = sum(squared_errors)
    if not math.isfinite(mae) or not math.isfinite(squared_error_sum):
        return None
    rmse = math.sqrt(squared_error_sum / len(squared_errors))
    if not math.isfinite(rmse):
        return None
    return {"mae": mae, "rmse": rmse}


def rolling_origin_backtest(
    values: list[float], periods: list[str], horizon: int
) -> dict[str, Any] | None:
    """Compare candidates over common, strictly chronological fixed-horizon windows."""
    last_origin = len(values) - horizon
    eligible_methods = [
        (name, minimum)
        for name, minimum in METHODS
        if last_origin - minimum + 1 >= MIN_EVALUATION_WINDOWS
    ]
    if not eligible_methods:
        return None

    first_origin = max(minimum for _, minimum in eligible_methods)
    origins = list(range(first_origin, last_origin + 1))
    candidate_results: list[dict[str, Any]] = []
    for method, minimum in eligible_methods:
        errors: list[float] = []
        squared_errors: list[float] = []
        origin_results: list[dict[str, Any]] = []
        valid = True
        for origin in origins:
            training = values[:origin]
            actual = values[origin : origin + horizon]
            prediction = _forecast_candidate(method, training, horizon)
            if prediction is None or len(actual) != horizon:
                valid = False
                break
            origin_errors = [abs(observed - predicted) for observed, predicted in zip(actual, prediction)]
            origin_squared_errors = [
                (observed - predicted) ** 2
                for observed, predicted in zip(actual, prediction)
            ]
            errors.extend(origin_errors)
            squared_errors.extend(origin_squared_errors)
            origin_results.append(
                {
                    "cutoff_period": periods[origin - 1],
                    "target_periods": periods[origin : origin + horizon],
                    "training_observations": len(training),
                    "mae": sum(origin_errors) / len(origin_errors),
                    "rmse": math.sqrt(
                        sum(origin_squared_errors) / len(origin_squared_errors)
                    ),
                }
            )
        if not valid or not errors:
            continue
        metrics = _metrics(errors, squared_errors)
        if metrics is None:
            continue
        candidate_results.append(
            {
                "method": method,
                **metrics,
                "evaluation_windows": len(origin_results),
                "evaluation_observations": len(errors),
                "training_observations_min": min(
                    item["training_observations"] for item in origin_results
                ),
                "training_observations_max": max(
                    item["training_observations"] for item in origin_results
                ),
                "minimum_history": minimum,
                "origins": origin_results,
            }
        )
    if not candidate_results:
        return None
    selected = min(
        candidate_results,
        key=lambda result: (
            result["mae"],
            next(
                index
                for index, (name, _) in enumerate(METHODS)
                if name == result["method"]
            ),
        ),
    )
    return {
        "selected_method": selected["method"],
        "mae": selected["mae"],
        "rmse": selected["rmse"],
        "evaluation_windows": selected["evaluation_windows"],
        "evaluation_observations": selected["evaluation_observations"],
        "training_observations_min": selected["training_observations_min"],
        "training_observations_max": selected["training_observations_max"],
        "forecast_horizon_months": horizon,
        "minimum_history": selected["minimum_history"],
        "minimum_history_met": len(values) >= selected["minimum_history"],
        "candidate_methods": candidate_results,
    }


def forecast_source(
    source: str,
    observations: list[dict[str, Any]],
    horizon: int,
) -> dict[str, Any]:
    monthly, invalid_count = aggregate_monthly_observations(observations)
    history = [{"period": point.period, "value": point.value} for point in monthly]
    periods = [point.period for point in monthly]

    def unavailable(status: str, reason: str, gaps: list[str] | None = None) -> dict[str, Any]:
        return {
            "source": source,
            "status": status,
            "reason": reason,
            "method": None,
            "history": history,
            "history_observation_count": len(history),
            "forecast": [],
            "evaluation": None,
            "missing_periods": gaps or [],
            "invalid_observation_count": invalid_count,
        }

    if not observations:
        return unavailable("unavailable_source", "no_source_observations")
    if invalid_count:
        return unavailable("insufficient_history", "invalid_observations")
    if not monthly:
        return unavailable("insufficient_history", "no_valid_observations")

    gaps = missing_months(periods)
    if gaps:
        return unavailable("insufficient_history", "missing_months", gaps)
    if len(monthly) < MIN_HISTORY:
        return unavailable("insufficient_history", "minimum_history_not_met")

    values = [point.value for point in monthly]
    evaluation = rolling_origin_backtest(values, periods, horizon)
    if evaluation is None:
        return unavailable("insufficient_history", "insufficient_backtest_windows")

    predictions = _forecast_candidate(evaluation["selected_method"], values, horizon)
    if predictions is None:
        return unavailable("insufficient_history", "non_finite_prediction")
    forecast = [
        {
            "period": _next_period(periods[-1], step),
            "value": value,
        }
        for step, value in enumerate(predictions, 1)
    ]
    return {
        "source": source,
        "status": "forecasted",
        "reason": None,
        "method": evaluation["selected_method"],
        "history": history,
        "history_observation_count": len(history),
        "forecast": forecast,
        "evaluation": evaluation,
        "missing_periods": [],
        "invalid_observation_count": 0,
    }


def forecast_demand_sources(
    district_id: str,
    trade_id: str,
    horizon: int,
    sources: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= 12:
        raise ValueError("horizon_months must be an integer from 1 to 12")
    return {
        "district_id": district_id,
        "trade_id": trade_id,
        "horizon_months": horizon,
        "methodology_version": METHODOLOGY_VERSION,
        "methodology": {
            "name": "Transparent rolling-origin statistical baselines",
            "version": METHODOLOGY_VERSION,
            "selection_metric": "lowest MAE on common rolling-origin windows; RMSE is secondary",
            "minimum_history_months": MIN_HISTORY,
            "minimum_evaluation_windows": MIN_EVALUATION_WINDOWS,
            "seasonal_naive_minimum_history_months": MIN_SEASONAL_HISTORY,
            "methods": [name for name, _ in METHODS],
            "method_details": {
                "last_observation": "Repeats the latest valid monthly observation.",
                "seasonal_naive": "Repeats the matching month from the latest 12-month cycle.",
                "damped_linear_trend": (
                    "Fits an ordinary least-squares linear trend to available history "
                    f"and damps each future step by {TREND_DAMPING}."
                ),
            },
            "missing_history_policy": "Do not fill missing months; a gapped source series is not forecast.",
            "invalid_data_policy": (
                "Invalid periods or counts are excluded and counted; if any are present, "
                "no forecast is produced for that source."
            ),
            "uncertainty": "Prediction intervals are unavailable; no calibrated confidence interval is produced.",
        },
        "sources": {
            "job_postings": forecast_source(
                "job_postings", sources["job_postings"], horizon
            ),
            "industry_hiring": forecast_source(
                "industry_hiring", sources["industry_hiring"], horizon
            ),
        },
        "limitations": [
            "This is a statistical baseline, not a trained machine-learning model.",
            "Backtests on synthetic demonstration data do not establish real-world forecast accuracy.",
            "Forecasts are source-specific and must not be added as a unique worker/job count.",
            "Job postings are summed across the source column; listings duplicated across portals cannot be deduplicated with the current schema.",
            "No confidence or prediction interval is available.",
        ],
    }
