"""Hợp đồng kết quả M1 bàn giao US-10 → US-11; không đổi API đăng ký US-09."""

from unittest.mock import Mock
from uuid import uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.models.face import CollectionFace, EmbedResponse, InferenceError, SyncRequest
from app.services.embedding_codec import encode
from app.services.face_collection import FaceCollection
from app.services.face_embedder import FaceEmbedder
from app.services.face_matcher import FaceMatcher


@pytest.mark.parametrize(
    "code,expected_status",
    [
        ("NO_FACE_DETECTED", "UNDETERMINED"),
        ("MULTIPLE_FACES", "UNDETERMINED"),
        ("MODEL_NOT_LOADED", None),
        ("IMAGE_DECODE_FAILED", None),
        ("PROVIDER_UNAVAILABLE", None),
    ],
    ids=["không-thấy-mặt", "nhiều-mặt", "thiếu-model", "ảnh-hỏng", "provider-lỗi"],
)
def test_quality_outcome_is_not_technical_failure(code: str, expected_status: str | None) -> None:
    embedder = Mock(spec=FaceEmbedder)
    embedder.embed.return_value = EmbedResponse(
        model_version="test", error=InferenceError(code=code, message="Không phân tích được ảnh")
    )
    matcher = FaceMatcher(embedder, FaceCollection())

    result = matcher.match(b"crop", uuid4(), uuid4(), 1, threshold=0.65)

    assert result.person_status == expected_status
    assert result.label_confidence is None
    assert result.similarity is None
    assert result.threshold_used == 0.65
    assert result.matched_known_face_id is None
    if expected_status == "UNDETERMINED":
        assert result.error is None
        assert result.quality_reason == code
    else:
        assert result.error is not None
        assert result.error.code == code
        assert result.quality_reason is None


@pytest.mark.parametrize("threshold,expected_status", [(0.6, "KNOWN"), (0.9, "UNKNOWN")])
def test_matching_reports_actual_threshold_and_label_score(
    threshold: float, expected_status: str
) -> None:
    owner_id, face_id = uuid4(), uuid4()
    collection = FaceCollection()
    collection.sync(
        SyncRequest(
            owner_scope_id=owner_id,
            version=7,
            model_version="test",
            embedding_dim=2,
            faces=[
                CollectionFace(
                    known_face_id=face_id,
                    person_name="Người quen",
                    embedding_base64=encode(np.array([0.8, 0.6], dtype=np.float32)),
                )
            ],
        )
    )
    embedder = Mock(spec=FaceEmbedder)
    embedder.embed.return_value = EmbedResponse(
        model_version="test",
        embedding_dim=2,
        embedding_base64=encode(np.array([1, 0], dtype=np.float32)),
    )

    result = FaceMatcher(embedder, collection).match(b"crop", uuid4(), owner_id, 7, threshold)

    assert result.error is None
    assert result.person_status == expected_status
    assert result.threshold_used == threshold
    assert result.similarity == pytest.approx(0.8)
    assert result.label_confidence == pytest.approx(0.8 if expected_status == "KNOWN" else 0.2)
    assert result.matched_known_face_id == (face_id if expected_status == "KNOWN" else None)


def test_empty_loaded_collection_is_unknown_but_missing_collection_is_error() -> None:
    owner_id = uuid4()
    collection = FaceCollection()
    collection.sync(
        SyncRequest(
            owner_scope_id=owner_id, version=1, model_version="test", embedding_dim=2, faces=[]
        )
    )
    embedder = Mock(spec=FaceEmbedder)
    embedder.embed.return_value = EmbedResponse(
        model_version="test",
        embedding_dim=2,
        embedding_base64=encode(np.array([1, 0], dtype=np.float32)),
    )
    matcher = FaceMatcher(embedder, collection)
    matcher.settings = Settings(face_match_threshold=0.67)

    empty = matcher.match(b"crop", uuid4(), owner_id, 1)
    unavailable = matcher.match(b"crop", uuid4(), owner_id, 2)

    assert empty.person_status == "UNKNOWN"
    assert empty.similarity is None
    assert empty.label_confidence == 1
    assert empty.error is None
    assert empty.quality_reason == "EMPTY_COLLECTION"
    assert empty.confidence_policy_version == "empty-collection-v1"
    assert empty.model_dump(by_alias=True)["thresholdUsed"] == 0.67
    assert unavailable.person_status is None
    assert unavailable.error is not None
    assert unavailable.error.code == "COLLECTION_NOT_READY"
    assert unavailable.label_confidence is None


def test_match_api_serializes_quality_result_and_rejects_invalid_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routers import face

    embedder = Mock(spec=FaceEmbedder)
    embedder.embed.return_value = EmbedResponse(
        model_version="test",
        error=InferenceError(code="NO_FACE_DETECTED", message="Không thấy khuôn mặt"),
    )
    matcher = FaceMatcher(embedder, FaceCollection())
    matcher.settings = Settings(face_match_threshold=0.67)
    monkeypatch.setattr(face, "get_settings", lambda: Settings(ai_internal_token="test-token"))
    monkeypatch.setattr(face, "get_matcher", lambda: matcher)
    client = TestClient(app)
    data = {"requestId": str(uuid4()), "ownerScopeId": str(uuid4()), "collectionVersion": "1"}
    headers = {"X-Internal-Token": "test-token"}
    try:
        response = client.post(
            "/face/match", data=data, files={"image": ("crop.jpg", b"crop")}, headers=headers
        )
        assert response.status_code == 200
        result = response.json()
        assert result["personStatus"] == "UNDETERMINED"
        assert result["qualityReason"] == "NO_FACE_DETECTED"
        assert result["error"] is None
        assert result["thresholdUsed"] == 0.67
        override = client.post(
            "/face/match",
            data={**data, "threshold": "0.8"},
            files={"image": ("crop.jpg", b"crop")},
            headers=headers,
        )
        assert override.status_code == 200
        assert override.json()["thresholdUsed"] == 0.8
        for threshold in ["-0.1", "1.1"]:
            response = client.post(
                "/face/match",
                data={**data, "threshold": threshold},
                files={"image": ("crop.jpg", b"crop")},
                headers=headers,
            )
            assert response.status_code == 422
    finally:
        face.get_slots.cache_clear()
