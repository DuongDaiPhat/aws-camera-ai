"""Pydantic schemas cho Module 2a — Phat hien te nga (US-16 / US-17).

Khop 100% voi api/openapi-ai-service.yaml.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BoundingBox(BaseModel):
    """Toa do bounding box chuan hoa 0..1."""

    model_config = ConfigDict(populate_by_name=True)

    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    width: float = Field(..., ge=0.0, le=1.0)
    height: float = Field(..., ge=0.0, le=1.0)


class FallInferenceError(BaseModel):
    """Loi ky thuat dac thu cua Module 2a."""

    model_config = ConfigDict(populate_by_name=True)

    code: Literal[
        "IMAGE_DECODE_FAILED",
        "MODEL_NOT_LOADED",
        "PROVIDER_UNAVAILABLE",
        "TIMEOUT",
        "POSE_INFERENCE_FAILED",
    ]
    message: str


class FallResponse(BaseModel):
    """Response phan hoi trang thai theo doi te nga."""

    model_config = ConfigDict(populate_by_name=True)

    track_id: str = Field(..., alias="trackId")
    state: Literal["MONITORING", "CANDIDATE", "CONFIRMED", "CANCELLED"]
    model_version: str = Field(..., alias="modelVersion")
    processed_at: str = Field(..., alias="processedAt")

    camera_slug: str | None = Field(None, alias="cameraSlug")
    source_session_id: str | None = Field(None, alias="sourceSessionId")
    frame_id: str | None = Field(None, alias="frameId")
    observed_at: str | None = Field(None, alias="observedAt")
    pose_available: bool = Field(True, alias="poseAvailable")
    reason: str | None = None
    is_replay: bool = Field(False, alias="isReplay")
    episode_id: str | None = Field(None, alias="episodeId")
    candidate_started_at: str | None = Field(None, alias="candidateStartedAt")
    confirmed_at: str | None = Field(None, alias="confirmedAt")
    confidence: float | None = None
    confidence_policy_version: str | None = Field(
        "fall-rule-evidence-v1", alias="confidencePolicyVersion"
    )
    torso_angle_deg: float | None = Field(None, alias="torsoAngleDeg")
    aspect_ratio: float | None = Field(None, alias="aspectRatio")
    center_height: float | None = Field(None, alias="centerHeight")
    center_drop_ratio: float | None = Field(None, alias="centerDropRatio")
    motion_score: float | None = Field(None, alias="motionScore")
    immobile_seconds: float = Field(0.0, alias="immobileSeconds")
    threshold_seconds: int = Field(15, alias="thresholdSeconds")
    missing_pose_seconds: float = Field(0.0, alias="missingPoseSeconds")
    keypoints_detected: int = Field(0, alias="keypointsDetected")
    bounding_box: BoundingBox | None = Field(None, alias="boundingBox")
    error: FallInferenceError | None = None
