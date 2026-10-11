# KaushalPulse AI service

The FastAPI service runs from this directory and currently provides the statistical forecasting service used by the API. Its inputs are demonstration/history records; forecasts are not calibrated employment statistics.

## Local environment

Use Python 3.11 or 3.12 for the pinned runtime dependencies. From `apps/ai-service`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
```

On macOS or Linux, activate the environment with:

```sh
source .venv/bin/activate
```

`requirements.txt` contains runtime dependencies. `requirements-dev.txt` includes those dependencies and the test runner without adding pytest to the production dependency set.

## Run tests

With the virtual environment active, from `apps/ai-service` run:

```sh
python -m pytest
```

The tests use in-memory observations and do not reset, seed, or modify either SQLite database.
