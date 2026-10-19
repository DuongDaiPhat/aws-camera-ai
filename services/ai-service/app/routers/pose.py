"""Router xu ly danh gia chuoi frame te nga: POST /pose/fall (US-16 / US-17)."""

from __future__ import annotations

import json
import logging
import math
import secrets
import threading
from datetime import UTC, datetime

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, status

from app.config import get_settings
from app.models.pose import FallInferenceError, FallResponse
from app.services.fall_tracker_registry import FallTrackerRegistry
from app.services.pose_estimator import PoseEstimator

logger = logging.getLogger(__name__)


def authenticate(x_internal_token: str = Header(default="", alias="X-Internal-Token")) -> None:  # noqa: B008
    expected = get_settings().ai_internal_token
    if expected and not secrets.compare_digest(expected, x_internal_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sai hoac thieu X-Internal-Token.",
        )


router = APIRouter(prefix="/pose", tags=["pose"], dependencies=[Depends(authenticate)])
inference_slots = threading.BoundedSemaphore(get_settings().pose_max_concurrent_requests)


def _parse_timestamp(frame_timestamp: str) -> datetime:
    try:
        dt_str = frame_timestamp.replace("Z", "+00:00")
        observed_at = datetime.fromisoformat(dt_str)
        if observed_at.tzinfo is None:
            observed_at = observed_at.replace(tzinfo=UTC)
        return observed_at
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Dinh dang frameTimestamp khong hop le: {e}",
        ) from e


def _parse_bbox(person_bounding_box: str | None) -> dict[str, float] | None:
    if not person_bounding_box:
        return None
    try:
        parsed = json.loads(person_bounding_box)
        if not isinstance(parsed, dict):
            raise ValueError("BBox phai la JSON object")
        bx = float(parsed.get("x", 0.0))
        by = float(parsed.get("y", 0.0))
        bw = float(parsed.get("width", 0.0))
        bh = float(parsed.get("height", 0.0))
        if (
            not all(math.isfinite(v) for v in (bx, by, bw, bh))
            or bw <= 0.0
            or bh <= 0.0
            or bx < 0.0
            or by < 0.0
            or (bx + bw) > 1.0001
            or (by + bh) > 1.0001
        ):
            raise ValueError("BBox toa do vuot nguong 0..1 hoac am")
        return {"x": bx, "y": by, "width": bw, "height": bh}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"personBoundingBox khong hop le: {e}",
        ) from e


def _decode_and_validate_image(image_bytes: bytes, max_pixels: int) -> np.ndarray | None:
    nparr = np.frombuffer(image_bytes, np.uint8)
    image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image_bgr is None:
        return None
    img_h, img_w = image_bgr.shape[:2]
    if img_h * img_w > max_pixels:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Tong so pixel vuot qua gioi han {max_pixels}.",
        )
    return image_bgr


@router.post(
    "/fall",
    response_model=FallResponse,
    operation_id="evaluateFall",
    summary="Danh gia mot frame trong chuoi theo doi te nga",
)
def evaluate_fall(
    image: UploadFile = File(...),  # noqa: B008
    track_id: str = Form(alias="trackId"),  # noqa: B008
    camera_slug: str = Form(alias="cameraSlug"),  # noqa: B008
    frame_timestamp: str = Form(alias="frameTimestamp"),  # noqa: B008
    frame_id: str | None = Form(default=None, alias="frameId"),  # noqa: B008
    source_session_id: str = Form(default="legacy", alias="sourceSessionId"),  # noqa: B008
    person_bounding_box: str | None = Form(default=None, alias="personBoundingBox"),  # noqa: B008
    zone_config_version: int | None = Form(default=None, alias="zoneConfigVersion"),  # noqa: B008
    in_rest_area: bool = Form(default=False, alias="inRestArea"),  # noqa: B008
) -> FallResponse:
    """Danh gia mot frame cua track de phat hien va theo doi te nga."""
    settings = get_settings()

    observed_at = _parse_timestamp(frame_timestamp)
    bbox_dict = _parse_bbox(person_bounding_box)

    # FastAPI runs this synchronous endpoint in its worker pool, keeping health/face responsive.
    image_bytes = image.file.read(settings.pose_max_image_bytes + 1)
    if len(image_bytes) > settings.pose_max_image_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Anh vuot qua gioi han {settings.pose_max_image_bytes} bytes.",
        )

    now_utc = datetime.now(UTC).isoformat()
    if not settings.m2a_enabled:
        FallTrackerRegistry.reset_instance()
        return FallResponse.model_validate(
            dict(
                trackId=track_id,
                cameraSlug=camera_slug,
                sourceSessionId=source_session_id,
                frameId=frame_id,
                observedAt=observed_at.isoformat(),
                state="MONITORING",
                poseAvailable=False,
                reason="M2A_DISABLED",
                modelVersion=settings.pose_model_version,
                processedAt=now_utc,
                error=FallInferenceError(
                    code="PROVIDER_UNAVAILABLE", message="M2a admission is disabled"
                ),
            )
        )
    image_bgr = _decode_and_validate_image(image_bytes, settings.pose_max_image_pixels)
    if image_bgr is None:
        return FallResponse.model_validate(
            dict(
                trackId=track_id,
                cameraSlug=camera_slug,
                sourceSessionId=source_session_id,
                frameId=frame_id,
                observedAt=observed_at.isoformat(),
                state="MONITORING",
                poseAvailable=False,
                reason="IMAGE_DECODE_FAILED",
                isReplay=False,
                modelVersion=settings.pose_model_version,
                processedAt=now_utc,
                error=FallInferenceError(
                    code="IMAGE_DECODE_FAILED",
                    message="Khong the decode du lieu anh thanh anh mau.",
                ),
            )
        )

    try:
        if not inference_slots.acquire(blocking=False):
            return FallResponse.model_validate(
                dict(
                    trackId=track_id,
                    cameraSlug=camera_slug,
                    sourceSessionId=source_session_id,
                    frameId=frame_id,
                    observedAt=observed_at.isoformat(),
                    state="MONITORING",
                    poseAvailable=False,
                    reason="PROVIDER_UNAVAILABLE",
                    modelVersion=settings.pose_model_version,
                    processedAt=now_utc,
                    error=FallInferenceError(
                        code="PROVIDER_UNAVAILABLE", message="Pose workers are busy"
                    ),
                )
            )
        try:
            estimator = PoseEstimator.get_instance()
            keypoints, geometry, pose_available, reason = estimator.estimate(
                image_bgr=image_bgr,
                person_bbox=bbox_dict,
            )
        finally:
            inference_slots.release()
    except FileNotFoundError as e:
        return FallResponse.model_validate(
            dict(
                trackId=track_id,
                cameraSlug=camera_slug,
                sourceSessionId=source_session_id,
                frameId=frame_id,
                observedAt=observed_at.isoformat(),
                state="MONITORING",
                poseAvailable=False,
                reason="MODEL_NOT_LOADED",
                isReplay=False,
                modelVersion=settings.pose_model_version,
                processedAt=now_utc,
                error=FallInferenceError(
                    code="MODEL_NOT_LOADED",
                    message=str(e),
                ),
            )
        )

    registry = FallTrackerRegistry.get_instance()
    tracker = registry.get_tracker(
        camera_slug=camera_slug,
        source_session_id=source_session_id,
        track_id=track_id,
    )

    result_dict = tracker.evaluate_frame(
        observed_at=observed_at,
        frame_id=frame_id,
        keypoints=keypoints,
        geometry=geometry,
        pose_available=pose_available,
        reason=reason,
        in_rest_area=in_rest_area,
    )

    if bbox_dict:
        result_dict["boundingBox"] = bbox_dict

    logger.debug(
        "[POSE_EVAL] track=%s state=%s reason=%s poseAvail=%s angle=%s immobile=%.1fs",
        track_id,
        result_dict.get("state"),
        result_dict.get("reason"),
        result_dict.get("poseAvailable"),
        f"{result_dict.get('torsoAngleDeg'):.1f}"
        if result_dict.get("torsoAngleDeg") is not None
        else "None",
        result_dict.get("immobileSeconds") or 0.0,
    )

    return FallResponse.model_validate(dict(**result_dict))
