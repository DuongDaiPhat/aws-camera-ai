"""Cau hinh AI service, doc tu bien moi truong (12-factor)."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
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

    # Module 3 — fire-only detection using the existing verified checkpoint.
    m3_enabled: bool = False
    fire_model_path: str = "models/fire-smoke-yolo26n-checkpoint-nms.onnx"
    fire_model_version: str = "fire-smoke-yolo26n-checkpoint-nms-v1"
    fire_model_sha256: str = ""
    fire_min_consecutive_frames: int = Field(default=3, ge=3, le=60)
    fire_confidence_threshold: float = Field(default=0.50, gt=0, le=1)
    fire_output_confidence_floor: float = Field(default=0.10, ge=0, le=1)
    fire_confirmation_window_seconds: float = Field(default=5, gt=0)
    fire_max_frame_gap_seconds: float = Field(default=1, gt=0)
    fire_clear_seconds: float = Field(default=10, gt=0)
    fire_max_concurrent_requests: int = Field(default=1, ge=1, le=16)
    fire_max_cameras: int = Field(default=16, ge=1, le=1024)
    fire_max_image_bytes: int = Field(default=1_048_576, ge=1)
    fire_max_image_pixels: int = Field(default=2_073_600, ge=1)
    fire_request_timeout_ms: int = Field(default=2000, ge=1)
    fire_frame_max_age_seconds: float = Field(default=1, gt=0)
    fire_frame_future_tolerance_seconds: float = Field(default=0.5, ge=0)
    fire_cpu_threads: int = Field(default=2, ge=1, le=64)
    fire_state_sweep_interval_ms: int = Field(default=250, ge=1)

    @model_validator(mode="after")
    def validate_fire_settings(self) -> "Settings":
        if self.fire_output_confidence_floor > self.fire_confidence_threshold:
            raise ValueError(
                "FIRE_OUTPUT_CONFIDENCE_FLOOR must not exceed FIRE_CONFIDENCE_THRESHOLD"
            )
        if self.fire_max_frame_gap_seconds > self.fire_confirmation_window_seconds:
            raise ValueError("FIRE_MAX_FRAME_GAP_SECONDS must not exceed the confirmation window")
        return self


@lru_cache
def get_settings() -> Settings:
    """Cache de khong doc lai env moi request."""
    return Settings()
