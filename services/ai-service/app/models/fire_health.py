"""Read-only process diagnostics, distinct from liveness and hazard evidence."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.models.fire import FireModel


class FireRuntimeHealth(FireModel):
    status: Literal["DISABLED", "STARTING", "READY", "DEGRADED"]
    instance_id: UUID = Field(alias="instanceId")
    model_version: str = Field(alias="modelVersion")
    model_loaded: bool = Field(alias="modelLoaded")
    request_count: int = Field(ge=0, alias="requestCount")
    error_count: int = Field(ge=0, alias="errorCount")
    stale_frame_count: int = Field(ge=0, alias="staleFrameCount")
    capacity_rejected_count: int = Field(ge=0, alias="capacityRejectedCount")
    in_flight: int = Field(ge=0, alias="inFlight")
    last_request_at: datetime | None = Field(alias="lastRequestAt")
    last_success_at: datetime | None = Field(alias="lastSuccessAt")
    last_error_code: str | None = Field(alias="lastErrorCode")
    last_duration_ms: float | None = Field(ge=0, alias="lastDurationMs")
