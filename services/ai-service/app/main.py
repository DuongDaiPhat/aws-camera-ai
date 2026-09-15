"""
AI service — FastAPI.

Sprint 0 chi co /health. Cac router module duoc bat dan theo user story:
  Sprint 2: routers/face.py   (US-10, Module 1)
  Sprint 3: routers/pose.py   (US-16/US-17, Module 2a)
  Sprint 3: routers/fire.py   (US-18, Module 3)

Hop dong API: api/openapi-ai-service.yaml
"""

import logging

from fastapi import FastAPI

from app.config import get_settings
from app.routers import health

settings = get_settings()
logging.basicConfig(level=settings.log_level)

app = FastAPI(
    title="CameraAI — AI Inference Service",
    version="0.0.1",
    description="Face / Pose / Fire inference cho orchestrator",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.include_router(health.router)
