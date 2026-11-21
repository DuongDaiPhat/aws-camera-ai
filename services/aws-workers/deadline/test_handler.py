import copy
import io
import json
import os
import unittest
from http.client import RemoteDisconnected
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

import handler

FIXTURES = Path(__file__).resolve().parents[3] / "aws/sprint4/contracts/fixtures"


def make_http_error(code, payload):
    raw = json.dumps(payload).encode("utf-8")
    return HTTPError(
        url="https://example.test/api/v1/internal/events/x/deadline",
        code=code,
        msg="err",
        hdrs=None,
        fp=io.BytesIO(raw),
    )


class DeadlineWorkerTests(unittest.TestCase):
    def setUp(self):
        self.command = json.loads(
            (FIXTURES / "deadline-command.valid.json").read_text(encoding="utf-8")
        )
        self.environment = patch.dict(
            os.environ,
            {
                "INTERNAL_API_BASE_URL": "https://example.test/api/v1",
                "INTERNAL_SERVICE_TOKEN": "t" * 32,
            },
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_200_applied_and_no_op_returned_directly(self):
        for disposition, reason in [
            ("APPLIED", "ESCALATED"),
            ("NO_OP", "ACKNOWLEDGED"),
            ("NO_OP", "RESOLVED"),
            ("NO_OP", "STALE_DEADLINE"),
            ("NO_OP", "ALREADY_APPLIED"),
        ]:
            payload = {
                "commandId": self.command["commandId"],
                "disposition": disposition,
                "reason": reason,
                "aggregateVersion": 3,
            }
            with patch.object(handler, "post_deadline", return_value=(200, payload)):
                self.assertEqual(handler.lambda_handler(self.command, None), payload)

    def test_409_not_due_returns_retry_payload(self):
        payload = {"code": "NOT_DUE", "retryAt": "2026-11-05T03:02:00Z"}
        with patch.object(handler, "post_deadline", return_value=(409, payload)):
            self.assertEqual(handler.lambda_handler(self.command, None), payload)

    def test_409_not_due_with_invalid_retry_at_is_terminal(self):
        for bad_retry in ("invalid", "2026-11-05T03:02:00+07:00", None):
            payload = {"code": "NOT_DUE", "retryAt": bad_retry}
            with (
                patch.object(handler, "post_deadline", return_value=(409, payload)),
                self.assertRaises(handler.DeadlineTerminalError),
            ):
                handler.lambda_handler(self.command, None)

    def test_409_command_conflict_is_terminal(self):
        err = make_http_error(409, {"code": "COMMAND_CONFLICT"})
        opener = Mock()
        opener.open.side_effect = err
        with (
            patch.object(handler, "build_opener", return_value=opener),
            self.assertRaises(handler.DeadlineTerminalError),
        ):
            handler.lambda_handler(self.command, None)

    def test_429_5xx_and_network_errors_raise_retryable(self):
        for exc in [
            make_http_error(429, {"message": "rate limited"}),
            make_http_error(500, {"message": "internal error"}),
            make_http_error(503, {"message": "unavailable"}),
            TimeoutError("timed out"),
            URLError("network down"),
            RemoteDisconnected("remote closed"),
        ]:
            opener = Mock()
            opener.open.side_effect = exc
            with (
                patch.object(handler, "build_opener", return_value=opener),
                self.assertRaises(handler.DeadlineRetryable),
            ):
                handler.lambda_handler(self.command, None)

    def test_400_401_404_and_invalid_input_raise_terminal(self):
        for code in (400, 401, 404):
            opener = Mock()
            opener.open.side_effect = make_http_error(code, {"code": "ERR"})
            with (
                patch.object(handler, "build_opener", return_value=opener),
                self.assertRaises(handler.DeadlineTerminalError),
            ):
                handler.lambda_handler(self.command, None)

        bad_version = copy.deepcopy(self.command)
        bad_version["deadlineVersion"] = 0
        with self.assertRaises(handler.DeadlineTerminalError):
            handler.lambda_handler(bad_version, None)

        bad_ts = copy.deepcopy(self.command)
        bad_ts["expectedDeadlineAt"] = "2026-11-05T03:01:00+07:00"
        with self.assertRaises(handler.DeadlineTerminalError):
            handler.lambda_handler(bad_ts, None)

        bad_uuid = copy.deepcopy(self.command)
        bad_uuid["commandId"] = "not-a-uuid"
        with self.assertRaises(handler.DeadlineTerminalError):
            handler.lambda_handler(bad_uuid, None)

    def test_invalid_200_schema_raises_terminal(self):
        for bad_body in [
            {
                "commandId": self.command["commandId"],
                "disposition": "UNKNOWN",
                "reason": "ESCALATED",
                "aggregateVersion": 2,
            },
            {
                "commandId": self.command["commandId"],
                "disposition": "APPLIED",
                "reason": "ACKNOWLEDGED",
                "aggregateVersion": 2,
            },
            {
                "commandId": self.command["commandId"],
                "disposition": "NO_OP",
                "reason": "ESCALATED",
                "aggregateVersion": 2,
            },
            {
                "commandId": "00000000-0000-4000-8000-000000000099",
                "disposition": "APPLIED",
                "reason": "ESCALATED",
                "aggregateVersion": 2,
            },
            {
                "commandId": self.command["commandId"],
                "disposition": "APPLIED",
                "reason": "ESCALATED",
                "aggregateVersion": 0,
            },
        ]:
            with (
                patch.object(handler, "post_deadline", return_value=(200, bad_body)),
                self.assertRaises(handler.DeadlineTerminalError),
            ):
                handler.lambda_handler(self.command, None)

    def test_rejects_non_https_and_short_token(self):
        with (
            patch.dict(
                os.environ,
                {
                    "INTERNAL_API_BASE_URL": "http://example.test/api/v1",
                    "INTERNAL_SERVICE_TOKEN": "t" * 32,
                },
            ),
            self.assertRaises(handler.DeadlineTerminalError),
        ):
            handler.lambda_handler(self.command, None)

        with (
            patch.dict(
                os.environ,
                {
                    "INTERNAL_API_BASE_URL": "https://example.test/api/v1",
                    "INTERNAL_SERVICE_TOKEN": "too-short",
                },
            ),
            self.assertRaises(handler.DeadlineTerminalError),
        ):
            handler.lambda_handler(self.command, None)

    def test_redirect_is_terminal(self):
        with self.assertRaises(handler.DeadlineTerminalError):
            handler.NoRedirect().redirect_request(
                None, None, 302, "Found", {}, "https://other"
            )

    def test_post_deadline_200_success_reads_and_parses_json(self):
        payload = {
            "commandId": self.command["commandId"],
            "disposition": "APPLIED",
            "reason": "ESCALATED",
            "aggregateVersion": 4,
        }
        response = Mock()
        response.status = 200
        response.read.return_value = json.dumps(payload).encode("utf-8")
        cm = Mock()
        cm.__enter__ = Mock(return_value=response)
        cm.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = cm

        with patch.object(handler, "build_opener", return_value=opener):
            self.assertEqual(handler.lambda_handler(self.command, None), payload)

        req = opener.open.call_args.args[0]
        self.assertEqual(
            req.full_url,
            f"https://example.test/api/v1/internal/events/{self.command['eventId']}/deadline",
        )
        self.assertEqual(req.get_method(), "POST")

    def test_invalid_json_or_non_utf8_backend_response_is_terminal(self):
        for bad_bytes in (b"not-json", b"\xff\xfe"):
            response = Mock()
            response.status = 200
            response.read.return_value = bad_bytes
            cm = Mock()
            cm.__enter__ = Mock(return_value=response)
            cm.__exit__ = Mock(return_value=False)
            opener = Mock()
            opener.open.return_value = cm
            with (
                patch.object(handler, "build_opener", return_value=opener),
                self.assertRaises(handler.DeadlineTerminalError),
            ):
                handler.lambda_handler(self.command, None)

    def test_non_dict_event_non_dict_200_and_unexpected_status_are_terminal(self):
        for non_dict_event in (None, ["not-an-object"], "str"):
            with self.assertRaises(handler.DeadlineTerminalError):
                handler.lambda_handler(non_dict_event, None)

        with (
            patch.object(handler, "post_deadline", return_value=(200, ["not-an-object"])),
            self.assertRaises(handler.DeadlineTerminalError),
        ):
            handler.lambda_handler(self.command, None)

        for status, body in ((201, {}), (409, ["not-an-object"])):
            with (
                patch.object(handler, "post_deadline", return_value=(status, body)),
                self.assertRaises(handler.DeadlineTerminalError),
            ):
                handler.lambda_handler(self.command, None)

    def test_validation_helpers_and_defense_in_depth_guards(self):
        self.assertFalse(handler._is_valid_uuid(123))
        self.assertFalse(handler._is_valid_uuid("not-a-uuid"))
        self.assertFalse(handler._is_valid_utc_timestamp("not-a-timestampZ"))

        bad_date = copy.deepcopy(self.command)
        bad_date["expectedDeadlineAt"] = "2026-99-99T00:00:00Z"
        with self.assertRaises(handler.DeadlineTerminalError):
            handler.lambda_handler(bad_date, None)

        bad_uuid = copy.deepcopy(self.command)
        bad_uuid["eventId"] = "not-a-uuid"
        with (
            patch.object(handler, "VALIDATOR", Mock()),
            self.assertRaises(handler.DeadlineTerminalError),
        ):
            handler.lambda_handler(bad_uuid, None)


if __name__ == "__main__":
    unittest.main()
