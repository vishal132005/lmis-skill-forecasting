"""
Base model class for all LMIS AI models.

To replace a mock stub with your own model:
1. Subclass BaseModel
2. Implement load() to load weights/artifacts
3. Implement predict() with your inference logic
4. Set _is_mock = False
5. Set USE_MOCK_MODELS=false in .env

See models/README.md for detailed instructions.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict
from datetime import datetime


class BaseModel(ABC):
    """Abstract base class for all LMIS AI/ML models."""

    _is_mock: bool = True
    _version: str = "0.0.0"
    _name: str = "unnamed"
    _loaded_at: datetime | None = None

    @abstractmethod
    def load(self) -> None:
        """Load model weights, artifacts, or configuration.
        Called once at startup.
        """
        pass

    @abstractmethod
    def predict(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Run inference on the given input data.

        Args:
            input_data: Dictionary matching the endpoint's Pydantic request schema.

        Returns:
            Dictionary matching the endpoint's Pydantic response schema.
        """
        pass

    @property
    def version(self) -> str:
        return self._version

    @property
    def is_mock(self) -> bool:
        return self._is_mock

    @property
    def name(self) -> str:
        return self._name

    def status(self) -> Dict[str, Any]:
        """Return status info for /ai/model-status endpoint."""
        return {
            "name": self._name,
            "version": self._version,
            "is_mock": self._is_mock,
            "loaded_at": self._loaded_at.isoformat() if self._loaded_at else None,
        }
