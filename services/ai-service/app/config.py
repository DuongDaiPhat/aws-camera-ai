"""Cau hinh AI service, doc tu bien moi truong (12-factor)."""

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Moi tham so nguong deu phai cau hinh duoc — khong hard-code (US-15, US-17)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    log_level: str = "INFO"

    @field_validator("log_level")
    @classmethod
    def _chuan_hoa_log_level(cls, v: str) -> str:
        """`logging` cua Python chi chap nhan ten muc VIET HOA.

        `.env` thuong duoc viet thuong (`LOG_LEVEL=debug`) nen phai tu chuan hoa,
        neu khong service se chet ngay luc khoi dong voi `ValueError: Unknown level`.
        """
        muc = v.strip().upper()
        hop_le = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"}
        if muc not in hop_le:
            raise ValueError(f"LOG_LEVEL khong hop le: {v!r}. Chon mot trong {sorted(hop_le)}")
        return muc

    # Module 1 — nhan dien nguoi la
    face_provider: Literal["local", "rekognition"] = "local"
    face_match_threshold: float = 0.60
    ai_internal_token: str = ""
    face_detector_path: str = "models/face_detection_yunet_2023mar.onnx"
    face_embedder_path: str = "models/face_recognition_sface_2021dec.onnx"
    face_model_version: str = "yunet-2023mar-sface-2021dec"
    face_max_image_bytes: int = 5 * 1024 * 1024
    face_max_pixels: int = 12_000_000
    face_detection_threshold: float = 0.9
    face_max_concurrent: int = 2
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
