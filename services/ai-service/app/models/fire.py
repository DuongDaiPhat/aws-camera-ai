"""M3 request identity and response evidence matching the internal OpenAPI."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

FireReason = Literal[
    "NEGATIVE",
    "INSUFFICIENT_FRAMES",
    "CONFIRMED",
    "REPLAY",
    "BELOW_THRESHOLD",
    "FRAME_GAP",
    "WINDOW_EXPIRED",
    "STALE_FRAME",
    "OUT_OF_ORDER",
    "INFERENCE_ERROR",
    "ACTIVE_EPISODE",
]
FireErrorCode = Literal[
    "IMAGE_DECODE_FAILED",
    "MODEL_NOT_LOADED",
    "PROVIDER_UNAVAILABLE",
    "TIMEOUT",
    "FIRE_INFERENCE_FAILED",
]


class FireModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid", allow_inf_nan=False)


class FireFrame(FireModel):
    camera_slug: str = Field(min_length=1, max_length=128, alias="cameraSlug")
    source_session_id: str = Field(
        default="legacy", min_length=1, max_length=128, alias="sourceSessionId"
    )
    frame_id: str = Field(min_length=1, max_length=128, alias="frameId")
    observed_at: AwareDatetime = Field(alias="observedAt")


class FireBoundingBox(FireModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class FireDetection(FireModel):
    label: Literal["fire"]
    confidence: float = Field(ge=0, le=1)
    bounding_box: FireBoundingBox = Field(alias="boundingBox")


class FireInferenceError(FireModel):
    code: FireErrorCode
    message: str


class FireResponse(FireModel):
    confirmed: bool = False
    detections: list[FireDetection] = Field(default_factory=list, max_length=100)
    model_version: str = Field(alias="modelVersion")
    processed_at: datetime = Field(alias="processedAt")
    camera_slug: str = Field(alias="cameraSlug")
    source_session_id: str = Field(alias="sourceSessionId")
    frame_id: str = Field(alias="frameId")
    observed_at: datetime = Field(alias="observedAt")
    is_replay: bool = Field(default=False, alias="isReplay")
    consecutive_frames: int = Field(default=0, ge=0, le=60, alias="consecutiveFrames")
    required_frames: int = Field(ge=3, le=60, alias="requiredFrames")
    max_confidence: float | None = Field(default=None, alias="maxConfidence")
    episode_id: UUID | None = Field(default=None, alias="episodeId")
    first_qualified_at: datetime | None = Field(default=None, alias="firstQualifiedAt")
    confirmed_at: datetime | None = Field(default=None, alias="confirmedAt")
    window_seconds: float = Field(alias="windowSeconds")
    max_frame_gap_seconds: float = Field(alias="maxFrameGapSeconds")
    threshold_used: float = Field(alias="thresholdUsed")
    qualifying_frame_ids: list[str] = Field(default_factory=list, alias="qualifyingFrameIds")
    qualifying_frame_timestamps: list[datetime] = Field(
        default_factory=list, alias="qualifyingFrameTimestamps"
    )
    incident_confidence: float | None = Field(default=None, alias="incidentConfidence")
    confidence_policy_version: Literal["fire-only-temporal-min-v1"] = Field(
        default="fire-only-temporal-min-v1", alias="confidencePolicyVersion"
    )
    reason: FireReason
    error: FireInferenceError | None = None
