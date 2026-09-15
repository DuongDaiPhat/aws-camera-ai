"""Cau hinh AI service, doc tu bien moi truong (12-factor)."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Moi tham so nguong deu phai cau hinh duoc — khong hard-code (US-15, US-17)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    log_level: str = "INFO"

    # Module 1 — nhan dien nguoi la
    face_provider: Literal["local", "rekognition"] = "local"
    face_match_threshold: float = 0.60
    aws_region: str = "ap-southeast-1"
    rekognition_collection_id: str = "camerai-known-faces"

    # Module 2a — te nga
    fall_immobility_seconds: int = 15
    fall_torso_angle_threshold_deg: int = 30

    # Module 3 — chay/khoi
    fire_min_consecutive_frames: int = 3
    fire_confidence_threshold: float = 0.50


@lru_cache
def get_settings() -> Settings:
    """Cache de khong doc lai env moi request."""
    return Settings()
