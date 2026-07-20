"""
RPA Gateway Configuration
"""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    PREFECT_API_URL: str = "http://127.0.0.1:4200/api"
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://10.86.180.120"]
    SECRET_KEY: str = "change-me-in-production"

    class Config:
        env_file = ".env"


settings = Settings()
