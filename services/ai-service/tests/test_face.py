"""US-09: quyền, lựa chọn, privacy và snapshot/replay; không cần model để chạy CI."""

import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore
from unittest.mock import Mock
from uuid import uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings, get_settings
from app.main import app
from app.models.face import CollectionFace, EmbedResponse, FaceAssessResponse, SyncRequest
from app.routers.face import get_embedder, get_quality_assessor, get_slots
from app.services.embedding_codec import decode, encode
from app.services.face_collection import FaceCollection
from app.services.face_embedder import FaceEmbedder
from app.services.face_matcher import FaceMatcher
from app.services.face_quality import FaceQualityAssessor


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


def _sharp_face_png() -> bytes:
    yy, xx = np.indices((200, 200))
    pattern = (((xx // 4) + (yy // 4)) % 2 * 220 + 20).astype(np.uint8)
    rgb = np.stack([pattern, pattern, pattern], axis=-1)
    output = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(output, format="PNG")
    return output.getvalue()


def test_router_assess_auth_embedding_rekognition_and_unavailable(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    from app.routers import face

    settings = Settings(ai_internal_token="test-token", face_provider="rekognition")
    assessor = FaceQualityAssessor(settings)
    assessor._detector = Mock()
    assessor._detector.detect.return_value = (
        1,
        np.asarray(
            [[40, 40, 120, 120, 76, 82, 124, 82, 100, 106, 82, 130, 118, 130, 0.94]],
            dtype=np.float32,
        ),
    )
    assessor._recognizer = Mock()
    assessor._recognizer.alignCrop.return_value = np.zeros((112, 112, 3), dtype=np.uint8)
    assessor._recognizer.feature.return_value = np.ones((1, 128), dtype=np.float32)

    monkeypatch.setattr(face, "get_settings", lambda: settings)
    monkeypatch.setattr(face, "get_quality_assessor", lambda: assessor)
    client = TestClient(app)
    headers = {"X-Internal-Token": "test-token"}
    try:
        assert (
            client.post("/face/assess", files={"image": ("x.png", _sharp_face_png())}).status_code
            == 401
        )
        res = client.post(
            "/face/assess",
            files={"image": ("x.png", _sharp_face_png())},
            headers=headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert body["passed"] is True
        assert body["gateStatus"] == "READY"
        assert body["faceCount"] == 1
        assert body["rejectionReason"] is None
        assert body["embeddingDim"] == 128
        assert body["embeddingBase64"] is not None
        assert body["metrics"]["faceWidthPx"] == 120
        assert body["metrics"]["faceHeightPx"] == 120
        assert body["boundingBox"] is not None

        no_emb = client.post(
            "/face/assess",
            files={"image": ("x.png", _sharp_face_png())},
            data={"includeEmbedding": "false"},
            headers=headers,
        )
        assert no_emb.status_code == 200
        assert no_emb.json()["passed"] is True
        assert no_emb.json()["embeddingBase64"] is None
        assert no_emb.json()["embeddingDim"] is None

        missing_assessor = FaceQualityAssessor(
            Settings(face_detector_path=str(tmp_path / "missing.onnx"))
        )
        monkeypatch.setattr(face, "get_quality_assessor", lambda: missing_assessor)
        unavailable = client.post(
            "/face/assess",
            files={"image": ("x.png", _sharp_face_png())},
            headers=headers,
        )
        assert unavailable.status_code == 200
        assert unavailable.json()["passed"] is False
        assert unavailable.json()["gateStatus"] == "UNAVAILABLE"
        assert unavailable.json()["rejectionReason"] == "MODEL_UNAVAILABLE"

        slots = get_slots()
        acquired = []
        while slots.acquire(blocking=False):
            acquired.append(True)
        try:
            busy = client.post(
                "/face/assess",
                files={"image": ("x.png", _sharp_face_png())},
                headers=headers,
            )
            assert busy.status_code == 503
            assert busy.json()["detail"] == "PROVIDER_UNAVAILABLE"
        finally:
            for _ in acquired:
                slots.release()
    finally:
        get_quality_assessor.cache_clear()
        get_slots.cache_clear()


class _SpyBoundedSemaphore(BoundedSemaphore):
    def __init__(self, value: int) -> None:
        super().__init__(value)
        self.acquire_waiting = threading.Event()

    def acquire(self, blocking: bool = True, timeout: float | None = None) -> bool:
        if blocking and timeout is not None:
            self.acquire_waiting.set()
        return super().acquire(blocking=blocking, timeout=timeout)


def _post_face_endpoint(endpoint: str, headers: dict[str, str]):
    client = TestClient(app)
    if endpoint == "assess":
        return client.post(
            "/face/assess",
            files={"image": ("x.png", _sharp_face_png())},
            headers=headers,
        )
    if endpoint == "embed":
        return client.post(
            "/face/embed",
            files={"image": ("x.png", picture())},
            headers=headers,
        )
    return client.post(
        "/face/match",
        data={
            "requestId": str(uuid4()),
            "ownerScopeId": str(uuid4()),
            "collectionVersion": "1",
        },
        files={"image": ("crop.jpg", b"crop")},
        headers=headers,
    )


@pytest.mark.parametrize("endpoint", ["assess", "embed", "match"])
def test_router_waits_for_busy_slot_and_succeeds_when_released_in_time(
    monkeypatch: pytest.MonkeyPatch, endpoint: str
) -> None:
    from app.routers import face

    settings = Settings(
        ai_internal_token="test-token",
        face_max_concurrent=1,
        face_acquire_timeout_seconds=1.5,
    )
    spy_slots = _SpyBoundedSemaphore(1)
    assert spy_slots.acquire(blocking=False) is True

    assessor_mock = Mock(spec=FaceQualityAssessor)
    assessor_mock.assess.return_value = FaceAssessResponse(
        passed=True,
        quality_score=0.95,
        face_count=1,
        model_version=settings.face_model_version,
        gate_status="READY",
    )
    embedder_mock = fake_embedder([[10, 10, 20, 20]])
    matcher_mock = FaceMatcher(embedder_mock, FaceCollection())

    monkeypatch.setattr(face, "get_settings", lambda: settings)
    monkeypatch.setattr(face, "get_slots", lambda: spy_slots)
    monkeypatch.setattr(face, "get_quality_assessor", lambda: assessor_mock)
    monkeypatch.setattr(face, "get_embedder", lambda: embedder_mock)
    monkeypatch.setattr(face, "get_matcher", lambda: matcher_mock)

    headers = {"X-Internal-Token": "test-token"}
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_post_face_endpoint, endpoint, headers)
        assert spy_slots.acquire_waiting.wait(timeout=2.0)
        time.sleep(0.02)
        spy_slots.release()
        response = future.result(timeout=5.0)

    assert response.status_code == 200


def test_router_concurrent_assess_requests_serialize_slot_and_both_succeed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routers import face

    get_slots.cache_clear()
    settings = Settings(
        ai_internal_token="test-token",
        face_max_concurrent=1,
        face_acquire_timeout_seconds=1.5,
    )
    spy_slots = _SpyBoundedSemaphore(1)
    first_entered = threading.Event()
    allow_first_finish = threading.Event()
    call_count = 0
    call_lock = threading.Lock()

    def slow_then_fast_assess(_data: bytes, _include_embedding: bool) -> FaceAssessResponse:
        nonlocal call_count
        with call_lock:
            call_count += 1
            current = call_count
        if current == 1:
            first_entered.set()
            assert allow_first_finish.wait(timeout=3.0)
        return FaceAssessResponse(
            passed=True,
            quality_score=0.95,
            face_count=1,
            model_version=settings.face_model_version,
            gate_status="READY",
        )

    assessor_mock = Mock(spec=FaceQualityAssessor)
    assessor_mock.assess.side_effect = slow_then_fast_assess

    monkeypatch.setattr(face, "get_settings", lambda: settings)
    monkeypatch.setattr(face, "get_slots", lambda: spy_slots)
    monkeypatch.setattr(face, "get_quality_assessor", lambda: assessor_mock)

    headers = {"X-Internal-Token": "test-token"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(_post_face_endpoint, "assess", headers)
        assert first_entered.wait(timeout=2.0)
        second = pool.submit(_post_face_endpoint, "assess", headers)
        assert spy_slots.acquire_waiting.wait(timeout=2.0)
        time.sleep(0.02)
        allow_first_finish.set()
        res1 = first.result(timeout=5.0)
        res2 = second.result(timeout=5.0)

    assert res1.status_code == 200 and res1.json()["passed"] is True
    assert res2.status_code == 200 and res2.json()["passed"] is True


@pytest.mark.parametrize("endpoint", ["assess", "embed", "match"])
@pytest.mark.parametrize("timeout_seconds", [0.15, 0.0])
def test_router_returns_503_when_slots_stay_busy_past_timeout(
    monkeypatch: pytest.MonkeyPatch, endpoint: str, timeout_seconds: float
) -> None:
    from app.routers import face

    get_slots.cache_clear()
    settings = Settings(
        ai_internal_token="test-token",
        face_max_concurrent=1,
        face_acquire_timeout_seconds=timeout_seconds,
    )
    monkeypatch.setattr(face, "get_settings", lambda: settings)

    slots = get_slots()
    acquired = []
    while slots.acquire(blocking=False):
        acquired.append(True)
    headers = {"X-Internal-Token": "test-token"}
    try:
        start = time.monotonic()
        busy = _post_face_endpoint(endpoint, headers)
        elapsed = time.monotonic() - start
        assert busy.status_code == 503
        assert busy.json()["detail"] == "PROVIDER_UNAVAILABLE"
        if timeout_seconds > 0:
            assert elapsed >= 0.1
    finally:
        for _ in acquired:
            slots.release()
        get_slots.cache_clear()
