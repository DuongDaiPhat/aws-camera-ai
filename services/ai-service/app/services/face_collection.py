"""Snapshot bất biến theo owner/model; swap sau khi validate toàn bộ."""

import hashlib
import threading
from dataclasses import dataclass
from uuid import UUID

import numpy as np
from numpy.typing import NDArray

from app.models.face import SyncRequest, SyncResponse
from app.services.embedding_codec import decode


@dataclass(frozen=True)
class CollectionSnapshot:
    version: int
    fingerprint: str
    dimension: int
    faces: tuple[tuple[UUID, str, NDArray[np.float32]], ...]


class FaceCollection:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._snapshots: dict[tuple[UUID, str], CollectionSnapshot] = {}

    def get(self, owner: UUID, model: str) -> CollectionSnapshot | None:
        with self._lock:
            return self._snapshots.get((owner, model))

    def sync(self, request: SyncRequest) -> SyncResponse:
        faces = sorted(request.faces, key=lambda face: str(face.known_face_id))
        if len({face.known_face_id for face in faces}) != len(faces):
            raise ValueError("Trùng knownFaceId")
        vectors = tuple(
            (
                face.known_face_id,
                face.person_name,
                decode(face.embedding_base64 or "", request.embedding_dim),
            )
            for face in faces
        )
        canonical = request.model_copy(update={"faces": faces}).model_dump_json()
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        key = (request.owner_scope_id, request.model_version)
        with self._lock:
            previous = self._snapshots.get(key)
            if previous and (
                request.version < previous.version
                or (request.version == previous.version and fingerprint != previous.fingerprint)
            ):
                raise RuntimeError("COLLECTION_VERSION_CONFLICT")
            self._snapshots[key] = CollectionSnapshot(
                request.version, fingerprint, request.embedding_dim, vectors
            )
        return SyncResponse(
            owner_scope_id=request.owner_scope_id, version=request.version, loaded=len(vectors)
        )
