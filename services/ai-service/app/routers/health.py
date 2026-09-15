"""Health check — dung cho docker healthcheck va CI smoke test."""

import time

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings

router = APIRouter(tags=["health"])

_STARTED_AT = time.time()


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    face_provider: str
    uptime_seconds: int


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Tra ve trang thai service va provider dang bat (kiem tra feature flag US-24)."""
    settings = get_settings()
    return HealthResponse(
        status="ok",
        service="ai-service",
        version="0.0.1",
        face_provider=settings.face_provider,
        uptime_seconds=int(time.time() - _STARTED_AT),
    )
