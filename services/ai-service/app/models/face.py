"""Schema US-09; camelCase theo OpenAPI nội bộ."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class FaceModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class BoundingBox(FaceModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)


class InferenceError(FaceModel):
    code: str
    message: str


class EmbedResponse(FaceModel):
    embedding_base64: str | None = Field(default=None, alias="embeddingBase64")
    embedding_dim: int | None = Field(default=None, alias="embeddingDim")
    selected_face_index: int | None = Field(default=None, alias="selectedFaceIndex")
    faces: list[BoundingBox] = Field(default_factory=list)
    model_version: str = Field(alias="modelVersion")
    provider: Literal["local", "rekognition"] = "local"
    error: InferenceError | None = None


class CollectionFace(FaceModel):
    known_face_id: UUID = Field(alias="knownFaceId")
    person_name: str = Field(alias="personName")
    embedding_base64: str | None = Field(default=None, alias="embeddingBase64")
    rekognition_face_id: str | None = Field(default=None, alias="rekognitionFaceId")


class SyncRequest(FaceModel):
    owner_scope_id: UUID = Field(alias="ownerScopeId")
    version: int = Field(ge=1)
    model_version: str = Field(min_length=1, alias="modelVersion")
    embedding_dim: int = Field(ge=1, le=4096, alias="embeddingDim")
    faces: list[CollectionFace]


class SyncResponse(FaceModel):
    owner_scope_id: UUID = Field(alias="ownerScopeId")
    version: int
    loaded: int
    provider: Literal["local"] = "local"


class MatchResponse(FaceModel):
    request_id: UUID = Field(alias="requestId")
    collection_version: int = Field(alias="collectionVersion")
    person_status: Literal["KNOWN", "UNKNOWN", "UNDETERMINED"] | None = Field(alias="personStatus")
    similarity: float | None = None
    threshold_used: float = Field(ge=0, le=1, alias="thresholdUsed")
    label_confidence: float | None = Field(default=None, alias="labelConfidence")
    confidence_policy_version: str = Field(default="v1", alias="confidencePolicyVersion")
    quality_reason: str | None = Field(default=None, alias="qualityReason")
    matched_known_face_id: UUID | None = Field(default=None, alias="matchedKnownFaceId")
    matched_person_name: str | None = Field(default=None, alias="matchedPersonName")
    model_version: str = Field(alias="modelVersion")
    processed_at: datetime = Field(alias="processedAt")
    provider: Literal["local"] = "local"
    bounding_box: BoundingBox | None = Field(default=None, alias="boundingBox")
    error: InferenceError | None = None


class FaceQualityMetrics(FaceModel):
    face_width_px: int = Field(ge=0, alias="faceWidthPx")
    face_height_px: int = Field(ge=0, alias="faceHeightPx")
    detection_score: float = Field(ge=0.0, le=1.0, alias="detectionScore")
    sharpness: float = Field(ge=0.0)
    pose_yaw_ratio: float = Field(ge=0.0, alias="poseYawRatio")
    pose_pitch_ratio: float = Field(ge=0.0, alias="posePitchRatio")


class FaceAssessResponse(FaceModel):
    passed: bool
    quality_score: float = Field(default=0.0, ge=0.0, le=1.0, alias="qualityScore")
    face_count: int = Field(default=0, ge=0, alias="faceCount")
    rejection_reason: str | None = Field(default=None, alias="rejectionReason")
    metrics: FaceQualityMetrics | None = None
    bounding_box: BoundingBox | None = Field(default=None, alias="boundingBox")
    embedding_base64: str | None = Field(default=None, alias="embeddingBase64")
    embedding_dim: int | None = Field(default=None, alias="embeddingDim")
    model_version: str = Field(alias="modelVersion")
    gate_status: Literal["READY", "DISABLED", "UNAVAILABLE"] = Field(alias="gateStatus")
