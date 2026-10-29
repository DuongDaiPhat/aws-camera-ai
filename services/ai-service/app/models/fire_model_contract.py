"""Checksum-bound deployment properties not fully recorded in ONNX metadata."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FireModelContract(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, allow_inf_nan=False)
    model_sha256: str = Field(pattern=r"^[0-9a-f]{64}$", alias="modelSha256")
    prediction_mode: Literal["nms-free-one-to-one", "one-to-many-embedded-nms"] = Field(
        alias="predictionMode"
    )
    output_confidence_floor: float = Field(ge=0, le=1, alias="outputConfidenceFloor")
