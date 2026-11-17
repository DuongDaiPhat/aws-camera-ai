"""SQS face worker. Results are persisted by the backend before SQS publication."""

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import HTTPRedirectHandler, Request, build_opener

import boto3
from botocore.config import Config
from jsonschema import Draft202012Validator, FormatChecker

VALIDATOR = Draft202012Validator(
    json.loads(Path(__file__).with_name("queue-v1.schema.json").read_text()),
    format_checker=FormatChecker(),
)
LOGGER = logging.getLogger(__name__)
_CLIENTS = {}


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
        or p["collectionId"] != "camerai-s4-dev-owner-" + p["ownerScopeId"]
        or message["messageId"] != p["jobId"]
        or message["correlationId"] != p["eventId"]
        or p["observationId"] != f"track:{p['trackId']}:face"
    ):
        raise ValueError("Face job scope mismatch")


def recognize(p, mappings):
    rek = client("rekognition")
    image = {"S3Object": {"Bucket": p["image"]["bucket"], "Name": p["image"]["key"]}}
    faces = rek.detect_faces(Image=image, Attributes=["DEFAULT"])["FaceDetails"]
    threshold = float(os.environ.get("REKOGNITION_MATCH_THRESHOLD", "0.90"))
    if not 0 < threshold <= 1:
        raise ValueError("Threshold must be in (0,1]")
    status, similarity, confidence, known_id = "UNDETERMINED", None, None, None
    policy, quality, model = "rekognition-normalized-v1", None, "rekognition"
    if len(faces) != 1:
        quality = "NO_FACE_DETECTED" if not faces else "MULTIPLE_FACES"
    else:
        collection = rek.describe_collection(CollectionId=p["collectionId"])
        model = "rekognition-" + collection["FaceModelVersion"]
        if collection["FaceCount"] == 0:
            status, confidence, policy = "UNKNOWN", 1.0, "empty-collection-v1"
        else:
            response = rek.search_faces_by_image(
                CollectionId=p["collectionId"],
                Image=image,
                FaceMatchThreshold=0,
                MaxFaces=1,
                QualityFilter="NONE",
            )
            matches = response["FaceMatches"]
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
    body = {
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
    return body


def process(message):
    VALIDATOR.validate(message)
    if message["type"] != "face.job":
        raise ValueError("Expected face.job")
    p = message["payload"]
    path = "/internal/cloud/face-jobs/" + p["jobId"]
    context = backend(path)
    validate_job(message, context)
    result = context["cached_result"]
    if result is None:
        body = recognize(p, context["mappings"])
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


def lambda_handler(event, _context):
    failures = []
    for record in event["Records"]:
        try:
            process(json.loads(record["body"]))
        except Exception:  # noqa: BLE001 - Report any record failure for SQS retry.
            # Do not log images, tokens, response bodies or provider details.
            LOGGER.warning("Face input failed messageId=%s", record["messageId"])
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
