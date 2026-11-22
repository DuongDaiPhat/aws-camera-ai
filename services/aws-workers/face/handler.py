"""SQS face worker. Results are persisted by the backend before SQS publication."""

import json
import logging
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import HTTPRedirectHandler, Request, build_opener

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from jsonschema import Draft202012Validator, FormatChecker

VALIDATOR = Draft202012Validator(
    json.loads(Path(__file__).with_name("queue-v1.schema.json").read_text()),
    format_checker=FormatChecker(),
)
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
_CLIENTS = {}
DEFAULT_COLLECTION_PREFIX = "camerai-s4-dev-owner-"
ALLOWED_COLLECTION_PREFIXES = (
    "camerai-s4-dev-owner-",
    "argusai-staging-owner-",
    "argusai-production-owner-",
)


def collection_prefix():
    raw = os.environ.get("REKOGNITION_COLLECTION_PREFIX")
    prefix = DEFAULT_COLLECTION_PREFIX if raw is None else raw.strip()
    if prefix not in ALLOWED_COLLECTION_PREFIXES:
        raise ValueError("Invalid REKOGNITION_COLLECTION_PREFIX")
    return prefix


def skip_detect_faces():
    raw = os.environ.get("REKOGNITION_SKIP_DETECT_FACES")
    value = (raw or "").strip().lower() or "true"
    if value in ("true", "1", "yes"):
        return True
    if value in ("false", "0", "no"):
        return False
    raise ValueError("Invalid REKOGNITION_SKIP_DETECT_FACES")


def client(service):
    if service not in _CLIENTS:
        _CLIENTS[service] = boto3.client(
            service,
            region_name=os.environ["AWS_REGION"],
            config=Config(
                retries={"total_max_attempts": 2, "mode": "standard"},
                connect_timeout=3,
                read_timeout=8,
            ),
        )
    return _CLIENTS[service]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Backend redirects are not allowed")


def backend(path, data=None):
    base = os.environ["INTERNAL_API_BASE_URL"].rstrip("/")
    if not base.startswith("https://"):
        raise ValueError("Backend must use HTTPS")
    token = os.environ["INTERNAL_SERVICE_TOKEN"]
    if len(token) < 32:
        raise ValueError("Internal token too short")
    request = Request(
        base + path,
        data=None if data is None else json.dumps(data).encode(),
        method="GET" if data is None else "PUT",
        headers={"X-Internal-Token": token, "Content-Type": "application/json"},
    )
    with build_opener(NoRedirect).open(request, timeout=8) as response:
        return json.load(response)


def validate_job(message, context):
    VALIDATOR.validate(message)
    if message["type"] != "face.job" or message != context["envelope"]:
        raise ValueError("Job differs from authorized DB envelope")
    p = message["payload"]
    expected_key = (
        f"owners/{p['ownerScopeId']}/cameras/{p['cameraId']}/"
        f"events/{p['eventId']}/face/{p['jobId']}.jpg"
    )
    if (
        p["image"] != {"bucket": os.environ["S3_BUCKET"], "key": expected_key}
        or p["collectionId"] != collection_prefix() + p["ownerScopeId"]
        or message["messageId"] != p["jobId"]
        or message["correlationId"] != p["eventId"]
        or p["observationId"] != f"track:{p['trackId']}:face"
    ):
        raise ValueError("Face job scope mismatch")


def _build_face_result(
    p,
    *,
    status,
    similarity,
    confidence,
    known_id,
    policy,
    quality,
    model,
    threshold,
):
    """Build a queue-v1 compliant M1_FACE result body."""
    return {
        "schemaVersion": 1,
        "resultId": p["resultId"],
        "requestId": p["jobId"],
        "eventId": p["eventId"],
        "observationId": p["observationId"],
        "revision": p["revision"],
        "module": "M1_FACE",
        "modelVersion": model,
        "processedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "collectionVersion": p["collectionVersion"],
        "personStatus": status,
        "matchedKnownFaceId": known_id,
        "error": None,
        "results": [
            {
                "module": "M1_FACE",
                "label": status,
                "confidence": confidence,
                "boundingBox": None,
                "metadata": {
                    "sourceSessionId": p["sourceSessionId"],
                    "similarity": similarity,
                    "confidencePolicyVersion": policy,
                    "provider": "rekognition",
                    "collectionVersion": p["collectionVersion"],
                    "fellBackToLocal": False,
                    "qualityReason": quality,
                    "thresholdUsed": threshold,
                },
            }
        ],
    }


def _search_and_classify(rek, p, image, mappings, threshold, model):
    """Call Rekognition SearchFacesByImage once and classify match/quality outcomes."""
    status, similarity, confidence, known_id, quality = "UNDETERMINED", None, None, None, None
    try:
        response = rek.search_faces_by_image(
            CollectionId=p["collectionId"],
            Image=image,
            FaceMatchThreshold=0,
            MaxFaces=1,
            QualityFilter="NONE",
        )
    except ClientError as exc:
        # Rekognition raises InvalidParameterException when the image contains no face;
        # treat it as an undetermined quality outcome instead of retrying via SQS.
        if exc.response.get("Error", {}).get("Code") == "InvalidParameterException":
            return status, similarity, confidence, known_id, "NO_FACE_DETECTED", model
        raise

    face_model_version = response.get("FaceModelVersion")
    if face_model_version:
        model = "rekognition-" + face_model_version

    matches = response.get("FaceMatches") or []
    if not matches:
        quality = "NO_SIMILARITY_SCORE"
    else:
        best = matches[0]
        similarity = best["Similarity"] / 100.0
        if similarity >= threshold:
            known_id = mappings.get(best["Face"]["FaceId"])
            if not known_id:
                raise ValueError("Rekognition FaceId has no active owner mapping")
            status, confidence = "KNOWN", similarity
        else:
            status, confidence = "UNKNOWN", 1 - similarity
    return status, similarity, confidence, known_id, quality, model


def _recognize_legacy(p, image, mappings, threshold, collection_face_count):
    """Legacy multi-call Rekognition flow guarded by REKOGNITION_SKIP_DETECT_FACES=false."""
    rek = client("rekognition")
    faces = rek.detect_faces(Image=image, Attributes=["DEFAULT"])["FaceDetails"]
    if len(faces) != 1:
        quality = "NO_FACE_DETECTED" if not faces else "MULTIPLE_FACES"
        return "UNDETERMINED", None, None, None, "rekognition-normalized-v1", quality, "rekognition"

    model = "rekognition"
    if collection_face_count is None:
        collection = rek.describe_collection(CollectionId=p["collectionId"])
        model = "rekognition-" + collection["FaceModelVersion"]
        face_count = collection["FaceCount"]
    else:
        face_count = collection_face_count

    if face_count == 0:
        return "UNKNOWN", None, 1.0, None, "empty-collection-v1", None, model

    status, similarity, confidence, known_id, quality, model = _search_and_classify(
        rek, p, image, mappings, threshold, model
    )
    return status, similarity, confidence, known_id, "rekognition-normalized-v1", quality, model


def recognize(p, mappings, collection_face_count=None):
    threshold = float(os.environ.get("REKOGNITION_MATCH_THRESHOLD", "0.90"))
    if not 0 < threshold <= 1:
        raise ValueError("Threshold must be in (0,1]")

    image = {"S3Object": {"Bucket": p["image"]["bucket"], "Name": p["image"]["key"]}}

    if not skip_detect_faces():
        status, similarity, confidence, known_id, policy, quality, model = _recognize_legacy(
            p, image, mappings, threshold, collection_face_count
        )
    elif collection_face_count == 0:
        status, similarity, confidence, known_id = "UNKNOWN", None, 1.0, None
        policy, quality, model = "empty-collection-v1", None, "rekognition"
    else:
        rek = client("rekognition")
        policy = "rekognition-normalized-v1"
        status, similarity, confidence, known_id, quality, model = _search_and_classify(
            rek, p, image, mappings, threshold, "rekognition"
        )

    return _build_face_result(
        p,
        status=status,
        similarity=similarity,
        confidence=confidence,
        known_id=known_id,
        policy=policy,
        quality=quality,
        model=model,
        threshold=threshold,
    )


def process(message):
    started = time.monotonic()
    VALIDATOR.validate(message)
    if message["type"] != "face.job":
        raise ValueError("Expected face.job")
    p = message["payload"]
    path = "/internal/cloud/face-jobs/" + p["jobId"]
    context = backend(path)
    validate_job(message, context)
    result = context["cached_result"]
    cache_hit = result is not None
    if result is None:
        collection_face_count = context.get("collection_face_count")
        body = recognize(p, context["mappings"], collection_face_count=collection_face_count)
        result = {
            "schemaVersion": 1,
            "type": "face.result",
            "messageId": p["resultId"],
            "correlationId": p["eventId"],
            "occurredAt": body["processedAt"],
            "payload": {
                "jobId": p["jobId"],
                "ownerScopeId": p["ownerScopeId"],
                "cameraId": p["cameraId"],
                "body": body,
            },
        }
        VALIDATOR.validate(result)
        # First DB writer wins. A concurrent retry publishes the same stored body.
        result = backend(path + "/result", result)
    VALIDATOR.validate(result)
    client("sqs").send_message(
        QueueUrl=os.environ["APPLICATION_RESULTS_QUEUE_URL"],
        MessageBody=json.dumps(result),
    )
    body = result["payload"]["body"]
    LOGGER.info(
        "Face completed jobId=%s resultId=%s status=%s cacheHit=%s durationMs=%s",
        p["jobId"],
        body["resultId"],
        body["personStatus"],
        cache_hit,
        round((time.monotonic() - started) * 1000),
    )


def lambda_handler(event, _context):
    failures = []
    for record in event["Records"]:
        try:
            process(json.loads(record["body"]))
        except Exception as error:  # noqa: BLE001 - Report any record failure for SQS retry.
            # Do not log images, tokens, response bodies or provider details.
            LOGGER.warning(
                "Face input failed messageId=%s errorType=%s",
                record["messageId"],
                type(error).__name__,
            )
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
