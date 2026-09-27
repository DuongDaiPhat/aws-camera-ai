"""Thực hiện matching giữa ảnh crop và face collection (US-10)."""

import math
from datetime import UTC, datetime
from uuid import UUID

import numpy as np

from app.config import get_settings
from app.models.face import InferenceError, MatchResponse
from app.services.embedding_codec import decode
from app.services.face_collection import FaceCollection
from app.services.face_embedder import FaceEmbedder


class FaceMatcher:
    def __init__(self, embedder: FaceEmbedder, collection: FaceCollection) -> None:
        self.embedder = embedder
        self.collection = collection
        self.settings = get_settings()

    def match(
        self,
        image_data: bytes,
        request_id: UUID,
        owner_scope_id: UUID,
        collection_version: int,
        threshold: float | None = None,
    ) -> MatchResponse:
        now = datetime.now(UTC)
        if threshold is None:
            threshold = self.settings.face_match_threshold

        embed_resp = self.embedder.embed(image_data, selected=None)

        bounding_box = None
        if embed_resp.selected_face_index is not None and embed_resp.faces:
            bounding_box = embed_resp.faces[embed_resp.selected_face_index]

        response = MatchResponse(
            request_id=request_id,
            collection_version=collection_version,
            person_status="UNDETERMINED",
            model_version=embed_resp.model_version,
            processed_at=now,
            bounding_box=bounding_box,
            error=embed_resp.error,
        )

        if embed_resp.error:
            return response

        if not embed_resp.embedding_base64 or not embed_resp.embedding_dim:
            response.error = InferenceError(code="NO_EMBEDDING", message="Lỗi trích xuất đặc trưng")
            return response

        snapshot = self.collection.get(owner_scope_id, embed_resp.model_version)
        if snapshot is None or snapshot.version != collection_version:
            response.person_status = None
            response.error = InferenceError(
                code="COLLECTION_NOT_READY",
                message="Danh sách khuôn mặt chưa sẵn sàng hoặc sai phiên bản",
            )
            return response

        if not snapshot.faces:
            response.person_status = "UNKNOWN"
            response.similarity = 0.0
            response.label_confidence = 1.0
            response.error = InferenceError(
                code="EMPTY_COLLECTION", message="Danh sách khuôn mặt trống"
            )
            return response

        q = decode(embed_resp.embedding_base64, embed_resp.embedding_dim)
        q_norm = float(np.linalg.norm(q))
        if q_norm == 0 or math.isnan(q_norm) or math.isinf(q_norm):
            response.error = InferenceError(code="INVALID_EMBEDDING", message="Lỗi dữ liệu vector")
            return response

        best_sim = -1.0
        best_face_id = None
        best_name = None

        for face_id, name, v in snapshot.faces:
            v_norm = float(np.linalg.norm(v))
            if v_norm == 0 or math.isnan(v_norm) or math.isinf(v_norm):
                continue

            raw_cosine = float(np.dot(q, v) / (q_norm * v_norm))
            sim = float(np.clip(raw_cosine, 0.0, 1.0))
            if sim > best_sim:
                best_sim = sim
                best_face_id = face_id
                best_name = name

        response.similarity = best_sim
        if best_sim >= threshold:
            response.person_status = "KNOWN"
            response.label_confidence = best_sim
            response.matched_known_face_id = best_face_id
            response.matched_person_name = best_name
        else:
            response.person_status = "UNKNOWN"
            response.label_confidence = 1.0 - best_sim

        return response
