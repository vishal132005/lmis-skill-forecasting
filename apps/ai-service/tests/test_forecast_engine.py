import math
import unittest

from app.models.forecast_engine import (
    aggregate_monthly_observations,
    forecast_demand_sources,
    forecast_source,
    missing_months,
    rolling_origin_backtest,
)


def periods_from(start_year, start_month, count):
    periods = []
    year = start_year
    month = start_month
    for _ in range(count):
        periods.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return periods


def observations(values, periods=None):
    selected_periods = periods or periods_from(2023, 1, len(values))
    return [
        {"period": period, "value": value}
        for period, value in zip(selected_periods, values)
    ]


class ForecastEngineTests(unittest.TestCase):
    def test_constant_and_all_zero_series_forecast_without_negative_values(self):
        constant = forecast_source(
            "job_postings", observations([12] * 36), 3
        )
        zero = forecast_source("industry_hiring", observations([0] * 36), 3)

        self.assertEqual(constant["status"], "forecasted")
        self.assertTrue(all(point["value"] == 12 for point in constant["forecast"]))
        self.assertTrue(all(point["value"] == 0 for point in zero["forecast"]))
        self.assertTrue(all(point["value"] >= 0 for point in zero["forecast"]))

    def test_increasing_and_decreasing_series_use_finite_nonnegative_values(self):
        increasing = forecast_source(
            "job_postings", observations(list(range(1, 37))), 3
        )
        decreasing = forecast_source(
            "industry_hiring", observations(list(range(36, 0, -1))), 3
        )

        self.assertEqual(increasing["status"], "forecasted")
        self.assertEqual(decreasing["status"], "forecasted")
        self.assertTrue(
            all(
                math.isfinite(point["value"]) and point["value"] >= 0
                for result in (increasing, decreasing)
                for point in result["forecast"]
            )
        )

    def test_seasonal_naive_is_selected_when_rolling_backtests_support_it(self):
        seasonal_values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120] * 4
        result = forecast_source(
            "job_postings", observations(seasonal_values), 1
        )

        self.assertEqual(result["status"], "forecasted")
        self.assertEqual(result["method"], "seasonal_naive")
        self.assertEqual(result["forecast"][0]["value"], 10)

    def test_insufficient_history_is_explicit(self):
        result = forecast_source("job_postings", observations([1, 2, 3, 4, 5]), 1)
        self.assertEqual(result["status"], "insufficient_history")
        self.assertEqual(result["reason"], "minimum_history_not_met")
        self.assertEqual(result["forecast"], [])
        self.assertIsNone(result["evaluation"])

    def test_gaps_are_not_filled_with_zeros(self):
        series_periods = periods_from(2024, 1, 12)
        del series_periods[5]
        result = forecast_source(
            "job_postings", observations(list(range(1, 12)), series_periods), 1
        )
        self.assertEqual(result["status"], "insufficient_history")
        self.assertEqual(result["reason"], "missing_months")
        self.assertEqual(result["missing_periods"], ["2024-06"])
        self.assertEqual(missing_months(["2024-01", "2024-03"]), ["2024-02"])

    def test_invalid_and_non_finite_values_are_counted_not_imputed(self):
        result = forecast_source(
            "job_postings",
            observations([1, 2, 3, 4, 5, 6])
            + [
                {"period": "2023-07", "value": -1},
                {"period": "2023-08", "value": float("nan")},
                {"period": "not-a-month", "value": 4},
            ],
            1,
        )
        self.assertEqual(result["status"], "insufficient_history")
        self.assertEqual(result["reason"], "invalid_observations")
        self.assertEqual(result["invalid_observation_count"], 3)
        self.assertEqual(result["forecast"], [])

    def test_duplicate_source_periods_are_aggregated_before_forecasting(self):
        values, invalid = aggregate_monthly_observations(
            [
                {"period": "2024-01", "value": 2},
                {"period": "2024-01", "value": 3},
            ]
        )
        self.assertEqual(invalid, 0)
        self.assertEqual(len(values), 1)
        self.assertEqual(values[0].value, 5)

    def test_backtest_is_rolling_origin_and_has_no_future_training_rows(self):
        all_periods = periods_from(2020, 1, 36)
        evaluation = rolling_origin_backtest(
            list(range(1, 37)), all_periods, horizon=2
        )

        self.assertIsNotNone(evaluation)
        for candidate in evaluation["candidate_methods"]:
            for origin in candidate["origins"]:
                self.assertLess(origin["cutoff_period"], origin["target_periods"][0])
                self.assertEqual(len(origin["target_periods"]), 2)
                self.assertEqual(
                    origin["training_observations"],
                    all_periods.index(origin["cutoff_period"]) + 1,
                )
                self.assertGreaterEqual(origin["mae"], 0)
                self.assertGreaterEqual(origin["rmse"], 0)
        self.assertEqual(
            evaluation["selected_method"],
            min(evaluation["candidate_methods"], key=lambda row: row["mae"])["method"],
        )

    def test_seasonal_method_requires_two_years_and_three_evaluation_windows(self):
        evaluation = rolling_origin_backtest(
            list(range(36)), periods_from(2020, 1, 36), horizon=12
        )
        seasonal = [
            candidate
            for candidate in evaluation["candidate_methods"]
            if candidate["method"] == "seasonal_naive"
        ]
        self.assertEqual(seasonal, [])

    def test_forecast_is_chronological_deterministic_and_horizon_bounded(self):
        series_periods = list(reversed(periods_from(2020, 1, 36)))
        unsorted_observations = observations(list(range(1, 37)), series_periods)
        first = forecast_source("job_postings", unsorted_observations, 12)
        second = forecast_source("job_postings", unsorted_observations, 12)

        self.assertEqual(first, second)
        self.assertEqual(
            [point["period"] for point in first["history"]],
            sorted(point["period"] for point in first["history"]),
        )
        self.assertEqual(len(first["forecast"]), 12)
        self.assertEqual(first["forecast"][0]["period"], "2023-01")
        self.assertEqual(first["forecast"][-1]["period"], "2023-12")
        self.assertTrue(
            all(math.isfinite(point["value"]) for point in first["forecast"])
        )

    def test_unavailable_source_is_distinct_from_valid_zero_forecast(self):
        unavailable = forecast_source("job_postings", [], 1)
        zero = forecast_source(
            "industry_hiring", observations([0] * 36), 1
        )
        self.assertEqual(unavailable["status"], "unavailable_source")
        self.assertEqual(zero["status"], "forecasted")
        self.assertEqual(zero["forecast"][0]["value"], 0)

    def test_horizon_must_be_between_one_and_twelve(self):
        for horizon in (0, 13, True):
            with self.subTest(horizon=horizon):
                with self.assertRaises(ValueError):
                    forecast_demand_sources("D1", "T1", horizon, {
                        "job_postings": [],
                        "industry_hiring": [],
                    })


if __name__ == "__main__":
    unittest.main()
