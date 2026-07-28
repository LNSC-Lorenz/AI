"""
RPA Gateway Configuration
"""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    PREFECT_API_URL: str = "http://127.0.0.1:4200/api"
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://10.86.180.120"]
    SECRET_KEY: str = "change-me-in-production"
    # Job 包存储目录与 Worker 可达的对外地址（Worker 从这里下载包）
    PACKAGES_DIR: str = "/opt/rpa-platform/packages"
    PUBLIC_BASE_URL: str = "http://10.86.180.120"

    class Config:
        env_file = ".env"


settings = Settings()
