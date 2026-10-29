"""Internal full-camera M3 endpoint; no event persistence or notifications."""

from datetime import UTC, datetime
from functools import lru_cache

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.models.fire import FireFrame, FireResponse
from app.models.fire_health import FireRuntimeHealth
from app.routers.face import authenticate
from app.services.fire_detector import FireImageTooLargeError
from app.services.fire_service import FireService
from app.services.fire_tracker import canonical_timestamp

router = APIRouter(prefix="/fire", dependencies=[Depends(authenticate)])


@lru_cache
def get_fire_service() -> FireService:
    return FireService(get_settings())


@router.get("/health", response_model=FireRuntimeHealth, operation_id="fireRuntimeHealth")
def fire_health() -> FireRuntimeHealth:
    service = get_fire_service()
    return service.health.snapshot(service.detector.is_loaded)


@router.post("/detect", response_model=FireResponse, operation_id="detectFire")
async def detect_fire(
    image: UploadFile = File(...),  # noqa: B008
    camera_slug: str = Form(alias="cameraSlug", min_length=1, max_length=128),  # noqa: B008
    frame_timestamp: str = Form(alias="frameTimestamp", min_length=1, max_length=64),  # noqa: B008
    frame_id: str | None = Form(default=None, alias="frameId", min_length=1, max_length=128),  # noqa: B008
    source_session_id: str = Form(
        default="legacy", alias="sourceSessionId", min_length=1, max_length=128
    ),  # noqa: B008
) -> FireResponse:
    try:
        try:
            parsed = datetime.fromisoformat(frame_timestamp.replace("Z", "+00:00"))
            if "T" not in frame_timestamp or parsed.tzinfo is None:
                raise ValueError("Expected an ISO-8601 timestamp with a timezone")
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Invalid frameTimestamp") from error
        observed_at = parsed.astimezone(UTC)
        frame = FireFrame(
            camera_slug=camera_slug,
            source_session_id=source_session_id,
            frame_id=frame_id or canonical_timestamp(observed_at),
            observed_at=observed_at,
        )
        data = await image.read(get_settings().fire_max_image_bytes + 1)
        if len(data) > get_settings().fire_max_image_bytes:
            get_fire_service().tracker.reset(camera_slug)
            raise FireImageTooLargeError("Encoded image exceeds FIRE_MAX_IMAGE_BYTES")
        return await run_in_threadpool(get_fire_service().process, frame, data)
    except FireImageTooLargeError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    finally:
        await image.close()
