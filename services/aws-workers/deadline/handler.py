"""Step Functions deadline worker. Delegates all state decisions to backend API."""

import json
import logging
import os
from datetime import datetime
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID

from jsonschema import Draft202012Validator, FormatChecker, ValidationError

_SCHEMA = json.loads(
    Path(__file__).with_name("queue-v1.schema.json").read_text(encoding="utf-8")
)
VALIDATOR = Draft202012Validator(
    {
        "$schema": _SCHEMA["$schema"],
        "$defs": _SCHEMA["$defs"],
        "$ref": "#/$defs/deadlineCommand",
    },
    format_checker=FormatChecker(),
)
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
REQUEST_TIMEOUT_SECONDS = 15
VALID_NO_OP_REASONS = frozenset(
    {"ACKNOWLEDGED", "RESOLVED", "STALE_DEADLINE", "ALREADY_APPLIED"}
)


class DeadlineRetryable(Exception):
    """Transient failure that Step Functions should retry."""


class DeadlineTerminalError(Exception):
    """Non-retryable contract, auth, or client failure."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DeadlineTerminalError("Backend redirects are not allowed")


def _is_valid_uuid(value):
    if not isinstance(value, str):
        return False
    try:
        UUID(value)
        return True
    except ValueError:
        return False


def _is_valid_utc_timestamp(value):
    if not isinstance(value, str) or not value.endswith("Z"):
        return False
    try:
        datetime.fromisoformat(value[:-1] + "+00:00")
        return True
    except ValueError:
        return False


def _validate_command(event):
    if not isinstance(event, dict):
        raise DeadlineTerminalError("Deadline command must be a JSON object")
    try:
        VALIDATOR.validate(event)
    except ValidationError as exc:
        raise DeadlineTerminalError(f"Invalid deadline command: {exc.message}") from exc
    if not _is_valid_uuid(event.get("commandId")) or not _is_valid_uuid(
        event.get("eventId")
    ):
        raise DeadlineTerminalError("Invalid deadline command UUID fields")
    if not _is_valid_utc_timestamp(event.get("expectedDeadlineAt")):
        raise DeadlineTerminalError("Invalid deadline command expectedDeadlineAt")


def _validate_200_response(body, expected_command_id):
    if not isinstance(body, dict):
        raise DeadlineTerminalError("Deadline 200 response must be a JSON object")
    version = body.get("aggregateVersion")
    disposition = body.get("disposition")
    reason = body.get("reason")
    valid_reason = (disposition == "APPLIED" and reason == "ESCALATED") or (
        disposition == "NO_OP" and reason in VALID_NO_OP_REASONS
    )
    if (
        body.get("commandId") != expected_command_id
        or not valid_reason
        or not isinstance(version, int)
        or isinstance(version, bool)
        or version < 1
    ):
        raise DeadlineTerminalError("Invalid deadline 200 response schema")


def _parse_json_bytes(raw):
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DeadlineTerminalError("Backend returned invalid JSON") from exc


def post_deadline(command):
    """POST the deadline command to the orchestrator internal API."""
    base = os.environ.get("INTERNAL_API_BASE_URL", "").rstrip("/")
    if not base.startswith("https://"):
        raise DeadlineTerminalError("INTERNAL_API_BASE_URL must use HTTPS")
    token = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
    if len(token) < 32:
        raise DeadlineTerminalError("INTERNAL_SERVICE_TOKEN too short")

    url = f"{base}/internal/events/{command['eventId']}/deadline"
    request = Request(
        url,
        data=json.dumps(command).encode("utf-8"),
        method="POST",
        headers={"X-Internal-Token": token, "Content-Type": "application/json"},
    )
    try:
        with build_opener(NoRedirect).open(
            request, timeout=REQUEST_TIMEOUT_SECONDS
        ) as response:
            status = getattr(response, "status", 200)
            body = _parse_json_bytes(response.read())
            return status, body
    except HTTPError as err:
        raw = err.read()
        if err.code == 429 or 500 <= err.code < 600:
            raise DeadlineRetryable(f"Backend HTTP {err.code}") from err
        if err.code == 409:
            return 409, _parse_json_bytes(raw)
        raise DeadlineTerminalError(f"Backend HTTP {err.code}") from err
    except (TimeoutError, URLError, HTTPException, OSError) as err:
        raise DeadlineRetryable(
            f"Backend network/timeout error: {type(err).__name__}"
        ) from err


def lambda_handler(event, _context):
    """Entry point invoked by Step Functions ApplyDeadline task."""
    _validate_command(event)
    status, body = post_deadline(event)

    if status == 200:
        _validate_200_response(body, event["commandId"])
        LOGGER.info(
            "deadline_result commandId=%s eventId=%s disposition=%s reason=%s aggregateVersion=%s",
            event["commandId"],
            event["eventId"],
            body["disposition"],
            body["reason"],
            body["aggregateVersion"],
        )
        return body

    if status == 409 and isinstance(body, dict) and body.get("code") == "NOT_DUE":
        retry_at = body.get("retryAt")
        if not _is_valid_utc_timestamp(retry_at):
            raise DeadlineTerminalError("NOT_DUE response missing valid UTC retryAt")
        LOGGER.info(
            "deadline_not_due commandId=%s eventId=%s retryAt=%s",
            event["commandId"],
            event["eventId"],
            retry_at,
        )
        return body

    if status == 409 and isinstance(body, dict):
        raise DeadlineTerminalError(
            f"Deadline 409 terminal error: {body.get('code', 'CONFLICT')}"
        )

    raise DeadlineTerminalError(f"Unexpected deadline status {status}")
