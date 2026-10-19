"""
AI service — FastAPI.

Sprint 0 chi co /health. Cac router module duoc bat dan theo user story:
  Sprint 2: routers/face.py   (US-10, Module 1)
  Sprint 3: routers/pose.py   (US-16/US-17, Module 2a)
  Sprint 3: routers/fire.py   (US-18, Module 3)

Hop dong API: api/openapi-ai-service.yaml
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from app.config import get_settings
from app.routers import face, health, pose
from app.services.fall_tracker_registry import FallTrackerRegistry

settings = get_settings()
logging.basicConfig(level=settings.log_level)


async def sweep_pose_tracks() -> None:
    while True:
        await asyncio.sleep(settings.pose_track_sweep_interval_ms / 1000)
        await asyncio.to_thread(FallTrackerRegistry.get_instance().sweep_all)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    task = asyncio.create_task(sweep_pose_tracks())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="CameraAI — AI Inference Service",
    version="0.0.1",
    description="Face / Pose / Fire inference cho orchestrator",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(face.router)
app.include_router(pose.router)
