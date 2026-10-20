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
    m2a_enabled: bool = False
    pose_model_path: str = "artifacts/models/pose_landmarker_lite.task"
    pose_model_version: str = "pose-landmarker-lite-v1"
    pose_min_visibility: float = Field(0.60, ge=0, le=1, allow_inf_nan=False)
    pose_min_association_iou: float = Field(0.30, gt=0, le=1, allow_inf_nan=False)
    pose_roi_padding_ratio: float = Field(0.10, ge=0, le=1, allow_inf_nan=False)
    fall_history_frame_count: int = Field(10, ge=2, le=1024)
    fall_history_max_seconds: float = Field(3.0, gt=0, allow_inf_nan=False)
    fall_torso_angle_threshold_deg: float = Field(30.0, gt=0, lt=90, allow_inf_nan=False)
    fall_center_drop_ratio: float = Field(0.20, gt=0, le=1, allow_inf_nan=False)
    fall_immobility_seconds: float = Field(3.0, gt=0, allow_inf_nan=False)
    fall_motion_speed_threshold: float = Field(0.05, gt=0, allow_inf_nan=False)
    fall_max_valid_frame_gap_seconds: float = Field(0.60, gt=0, allow_inf_nan=False)
    fall_missing_pose_grace_seconds: float = Field(5.0, gt=0, allow_inf_nan=False)
    fall_recovery_angle_deg: float = Field(60.0, gt=0, le=90, allow_inf_nan=False)
    fall_candidate_max_seconds: float = Field(60.0, gt=0, allow_inf_nan=False)
    fall_torso_shrink_ratio: float = Field(0.55, gt=0, le=1, allow_inf_nan=False)
    fall_aspect_ratio_threshold: float = Field(0.90, gt=0, le=5, allow_inf_nan=False)
    pose_track_ttl_seconds: float = Field(60.0, gt=0, allow_inf_nan=False)
    pose_max_concurrent_requests: int = Field(2, ge=1)
    pose_max_tracks: int = Field(128, ge=1)
    pose_max_image_bytes: int = Field(1048576, ge=1)
    pose_max_image_pixels: int = Field(2073600, ge=1)
    pose_request_timeout_ms: int = Field(2000, ge=1)
    pose_track_sweep_interval_ms: int = Field(250, ge=1)

    @model_validator(mode="after")
    def _validate_pose_relations(self) -> "Settings":
        if self.fall_recovery_angle_deg <= self.fall_torso_angle_threshold_deg:
            raise ValueError("FALL_RECOVERY_ANGLE_DEG must exceed the candidate angle")
        if self.fall_candidate_max_seconds <= self.fall_immobility_seconds:
            raise ValueError("FALL_CANDIDATE_MAX_SECONDS must exceed the immobility interval")
        if self.fall_missing_pose_grace_seconds <= self.fall_max_valid_frame_gap_seconds:
            raise ValueError("Missing-pose grace must exceed the valid-frame gap")
        if self.pose_track_ttl_seconds < self.fall_missing_pose_grace_seconds:
            raise ValueError("Track TTL must cover the missing-pose grace")
        return self

    # Module 3 — chay/khoi
    fire_min_consecutive_frames: int = 3
    fire_confidence_threshold: float = 0.50


@lru_cache
def get_settings() -> Settings:
    """Cache de khong doc lai env moi request."""
    return Settings()
