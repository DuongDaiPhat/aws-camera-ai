"""Schema US-09; camelCase theo OpenAPI nội bộ."""

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
