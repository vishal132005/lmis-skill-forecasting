"""
Configuration for AI Service.
Uses pydantic-settings for environment variable loading.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """AI service configuration loaded from environment variables."""

    AI_HOST: str = "0.0.0.0"
    AI_PORT: int = 8000
    USE_MOCK_MODELS: bool = True
    LOG_LEVEL: str = "INFO"
    MODEL_VERSION: str = "0.1.0-mock"

    class Config:
        env_file = "../../.env"
        env_file_encoding = "utf-8"


settings = Settings()
