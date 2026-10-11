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
    m2a_enabled: bool = True
    pose_model_path: str = "artifacts/models/pose_landmarker_lite.task"
    pose_model_version: str = "pose-landmarker-lite-v1"
    pose_min_visibility: float = 0.60
    pose_min_association_iou: float = 0.30
    pose_roi_padding_ratio: float = 0.10
    fall_history_frame_count: int = 10
    fall_history_max_seconds: float = 3.0
    fall_torso_angle_threshold_deg: float = 30.0
    fall_center_drop_ratio: float = 0.20
    fall_immobility_seconds: float = 15.0
    fall_motion_speed_threshold: float = 0.05
    fall_max_valid_frame_gap_seconds: float = 0.60
    fall_missing_pose_grace_seconds: float = 5.0
    fall_recovery_angle_deg: float = 60.0
    fall_candidate_max_seconds: float = 60.0
    pose_track_ttl_seconds: float = 60.0
    pose_max_concurrent_requests: int = 2
    pose_max_tracks: int = 128
    pose_max_image_bytes: int = 1048576
    pose_max_image_pixels: int = 2073600
    pose_request_timeout_ms: int = 2000
    pose_track_sweep_interval_ms: int = 250

    # Module 3 — chay/khoi
    fire_min_consecutive_frames: int = 3
    fire_confidence_threshold: float = 0.50


@lru_cache
def get_settings() -> Settings:
    """Cache de khong doc lai env moi request."""
    return Settings()
