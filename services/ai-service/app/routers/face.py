"""API nội bộ US-09, token bắt buộc và giới hạn xử lý đồng thời."""

import secrets
from functools import lru_cache
from threading import BoundedSemaphore

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.models.face import EmbedResponse, SyncRequest, SyncResponse
from app.services.face_collection import FaceCollection
from app.services.face_embedder import FaceEmbedder


def authenticate(x_internal_token: str = Header(default="")) -> None:
    expected = get_settings().ai_internal_token
    if not expected or not secrets.compare_digest(expected, x_internal_token):
        raise HTTPException(status_code=401, detail="UNAUTHORIZED")


router = APIRouter(prefix="/face", dependencies=[Depends(authenticate)])
collection = FaceCollection()


@lru_cache
def get_embedder() -> FaceEmbedder:
    return FaceEmbedder(get_settings())


@lru_cache
def get_slots() -> BoundedSemaphore:
    return BoundedSemaphore(get_settings().face_max_concurrent)


@router.post("/embed", response_model=EmbedResponse)
async def embed_face(
    image: UploadFile = File(...),  # noqa: B008
    selected_face_index: int | None = Form(default=None, alias="selectedFaceIndex"),  # noqa: B008
) -> EmbedResponse:
    slots = get_slots()
    if not slots.acquire(blocking=False):
        await image.close()
        raise HTTPException(status_code=503, detail="PROVIDER_UNAVAILABLE")
    try:
        data = await image.read(get_settings().face_max_image_bytes + 1)
        return await run_in_threadpool(get_embedder().embed, data, selected_face_index)
    finally:
        await image.close()
        slots.release()


@router.post("/collection/sync", response_model=SyncResponse)
def sync_collection(request: SyncRequest) -> SyncResponse:
    if request.model_version != get_settings().face_model_version or request.embedding_dim != 128:
        raise HTTPException(status_code=422, detail="MODEL_DIMENSION_MISMATCH")
    try:
        return collection.sync(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="INVALID_EMBEDDING") from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail="COLLECTION_VERSION_CONFLICT") from error
