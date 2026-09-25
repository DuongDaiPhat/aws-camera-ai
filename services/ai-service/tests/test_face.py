"""US-09: quyền, lựa chọn, privacy và snapshot/replay; không cần model để chạy CI."""

import io
from unittest.mock import Mock
from uuid import uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings, get_settings
from app.main import app
from app.models.face import CollectionFace, EmbedResponse, SyncRequest
from app.routers.face import get_embedder, get_slots
from app.services.embedding_codec import decode, encode
from app.services.face_collection import FaceCollection
from app.services.face_embedder import FaceEmbedder


def picture() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (80, 100)).save(output, format="PNG")
    return output.getvalue()


def test_codec_rejects_invalid_vectors() -> None:
    vector = np.array([3, 4], dtype=np.float32)
    assert np.allclose(decode(encode(vector), 2), [0.6, 0.8])
    for payload in ["!", "", encode(vector)]:
        with pytest.raises(ValueError):
            decode(payload, 3)
    for values in [[0, 0], [float("nan"), 1]]:
        with pytest.raises(ValueError):
            encode(np.array(values, dtype=np.float32))


def test_collection_atomic_replay_delete_and_scope() -> None:
    store = FaceCollection()
    owner = uuid4()
    face = CollectionFace(
        known_face_id=uuid4(),
        person_name="Test",
        embedding_base64=encode(np.ones(2, dtype=np.float32)),
    )
    request = SyncRequest(
        owner_scope_id=owner, version=1, model_version="test", embedding_dim=2, faces=[face]
    )
    store.sync(request)
    previous = store.get(owner, "test")
    assert previous is not None
    assert store.sync(request).loaded == 1
    assert store.get(uuid4(), "test") is None
    assert store.get(owner, "other") is None
    with pytest.raises(ValueError):
        store.sync(request.model_copy(update={"version": 2, "embedding_dim": 3}))
    assert store.get(owner, "test").version == 1
    with pytest.raises(ValueError):
        store.sync(request.model_copy(update={"faces": [face, face]}))
    with pytest.raises(RuntimeError):
        store.sync(request.model_copy(update={"faces": []}))
    store.sync(request.model_copy(update={"version": 2, "faces": []}))
    assert store.get(owner, "test").faces == ()
    assert len(previous.faces) == 1  # Reader đang chạy giữ snapshot nhất quán.
    with pytest.raises(RuntimeError):
        store.sync(request)


def fake_embedder(faces: list[list[float]]) -> FaceEmbedder:
    service = FaceEmbedder(Settings())
    service._detector = Mock()
    service._detector.detect.return_value = (None, np.asarray(faces) if faces else None)
    service._recognizer = Mock()
    service._recognizer.feature.return_value = np.ones((1, 128), dtype=np.float32)
    return service


@pytest.mark.parametrize(
    "count,selected,code",
    [
        (0, None, "NO_FACE_DETECTED"),
        (2, None, "MULTIPLE_FACES"),
        (1, 2, "INVALID_FACE_SELECTION"),
        (1, -1, "INVALID_FACE_SELECTION"),
        (1, None, None),
        (2, 1, None),
    ],
)
def test_detection_selection(count: int, selected: int | None, code: str | None) -> None:
    service = fake_embedder([[10, 10 + index * 20, 20, 20] for index in range(count)])
    result = service.embed(picture(), selected)
    assert (result.error.code if result.error else None) == code
    if code:
        assert result.embedding_base64 is None
    else:
        assert result.embedding_dim == 128
        assert result.selected_face_index == (selected or 0)
        assert len(decode(result.embedding_base64, 128)) == 128
    for box in result.faces:
        assert 0 <= box.x + box.width <= 1


def test_stable_face_order_and_exif() -> None:
    service = fake_embedder([[40, 70, 20, 20], [20, 10, 20, 20], [5, 10, 20, 20]])
    result = service.embed(picture(), 0)
    assert result.faces[0].x < result.faces[1].x
    assert result.faces[1].y < result.faces[2].y
    output = io.BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (30, 50)).save(output, format="JPEG", exif=exif)
    assert service._image(output.getvalue()).shape[:2] == (30, 50)


def test_invalid_image_limits_and_missing_model(tmp_path) -> None:
    service = FaceEmbedder(Settings(face_detector_path=str(tmp_path / "missing")))
    assert service.embed(b"invalid", None).error.code == "IMAGE_DECODE_FAILED"
    assert service.embed(picture(), None).error.code == "MODEL_NOT_LOADED"
    limited = FaceEmbedder(Settings(face_max_pixels=1))
    assert limited.embed(picture(), None).error.code == "IMAGE_DECODE_FAILED"
    limited = FaceEmbedder(Settings(face_max_image_bytes=1))
    assert limited.embed(picture(), None).error.code == "IMAGE_DECODE_FAILED"
    assert list(tmp_path.iterdir()) == []


def test_router_auth_embed_and_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.routers import face

    app.dependency_overrides[get_settings] = lambda: Settings(ai_internal_token="test-token")
    monkeypatch.setattr(face, "get_settings", lambda: Settings(ai_internal_token="test-token"))
    monkeypatch.setattr(face, "get_embedder", lambda: fake_embedder([[10, 10, 20, 20]]))
    client = TestClient(app)
    headers = {"X-Internal-Token": "test-token"}
    try:
        assert client.post("/face/embed", files={"image": ("x.png", picture())}).status_code == 401
        response = client.post(
            "/face/embed", files={"image": ("x.png", picture())}, headers=headers
        )
        assert response.status_code == 200
        assert response.json()["embeddingDim"] == 128
        request = {
            "ownerScopeId": str(uuid4()),
            "version": 1,
            "modelVersion": Settings().face_model_version,
            "embeddingDim": 128,
            "faces": [],
        }
        assert (
            client.post("/face/collection/sync", json=request, headers=headers).status_code == 200
        )
        request["version"] = 2
        assert (
            client.post("/face/collection/sync", json=request, headers=headers).status_code == 200
        )
        request["version"] = 1
        assert (
            client.post("/face/collection/sync", json=request, headers=headers).status_code == 409
        )
        request["embeddingDim"] = 2
        assert (
            client.post("/face/collection/sync", json=request, headers=headers).status_code == 422
        )
    finally:
        app.dependency_overrides.clear()
        get_embedder.cache_clear()
        get_slots.cache_clear()


def test_embed_response_never_contains_image() -> None:
    response = EmbedResponse(model_version="test").model_dump(by_alias=True)
    assert "image" not in response
    assert "filename" not in response
