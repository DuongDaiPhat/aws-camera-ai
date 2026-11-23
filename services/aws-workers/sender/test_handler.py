import copy
import json
import os
import unittest
from datetime import UTC
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

import handler
from botocore.exceptions import ClientError, NoCredentialsError

FIXTURES = Path(__file__).resolve().parents[3] / "aws/sprint4/contracts/fixtures"
JOB = json.loads((FIXTURES / "notification-job.valid.json").read_text())
CACHED = json.loads((FIXTURES / "notification-outcome.valid.json").read_text())
ID = JOB["payload"]["notificationId"]
EVENT = JOB["payload"]["eventId"]
ATTEMPT = CACHED["payload"]["attemptId"]
TOPIC = "arn:aws:sns:ap-southeast-1:123456789012:argusai-dev-incident-email"
PREFIX = "[ArgusAI][DEV]"
PHONE = "+12025550101"
SOURCE_PHONE = "+12025550102"


class SenderTests(unittest.TestCase):
    def setUp(self):
        self.job = copy.deepcopy(JOB)
        self.delivery = {
            "channel": "SNS_EMAIL",
            "recipientRef": "owner",
            "topicArn": TOPIC,
            "message": f"{PREFIX} Incident",
            "subject": f"{PREFIX} Alarm",
        }
        self.claim = {
            "notificationId": ID,
            "disposition": "CLAIMED",
            "attemptId": ATTEMPT,
            "leaseUntil": "2099-01-01T00:00:00Z",
            "mode": "REAL",
            "delivery": self.delivery,
        }
        self.cached = None
        self.trace = []
        self.sqs = MagicMock()
        self.sns = MagicMock()
        self.connect = MagicMock()
        self.sqs.send_message.side_effect = self.send
        self.sns.publish.return_value = {"MessageId": "provider-42"}
        self.connect.start_outbound_voice_contact.return_value = {"ContactId": "call-42"}
        self.start_patch(
            patch.dict(
                os.environ,
                {
                    "APP_ENV": "dev",
                    "AWS_REGION": "ap-southeast-1",
                    "SENDER_DRY_RUN": "false",
                    "SNS_TOPIC_ARN": TOPIC,
                    "APPLICATION_RESULTS_QUEUE_URL": "https://sqs.example/results",
                    "INTERNAL_API_BASE_URL": "https://example.com/api/v1",
                    "INTERNAL_SERVICE_TOKEN": "x" * 32,
                },
                clear=True,
            )
        )
        self.api_mock = self.start_patch(patch.object(handler, "backend", side_effect=self.api))
        self.client = self.start_patch(
            patch.object(
                handler,
                "client",
                side_effect={
                    "sns": self.sns,
                    "sqs": self.sqs,
                    "connect": self.connect,
                }.__getitem__,
            )
        )

    def start_patch(self, patcher):
        self.addCleanup(patcher.stop)
        return patcher.start()

    def api(self, path, *, method="GET", data=None):
        base = f"/internal/notifications/{ID}"
        self.trace.append(method)
        if method == "GET":
            self.assertEqual(path, base)
            return {"envelope": self.job, "cached_result": self.cached}
        if method == "POST":
            self.assertEqual(path, base + "/claim")
            self.assertEqual(
                data,
                {
                    "schemaVersion": 1,
                    "claimId": ID,
                    "eventId": EVENT,
                    "expectedEventVersion": 3,
                },
            )
            return self.claim
        self.assertEqual(path, base + "/result")
        self.cached = copy.deepcopy(data)
        return self.cached

    def send(self, **arguments):
        self.trace.append("SQS")
        self.assertEqual(json.loads(arguments["MessageBody"]), self.cached)

    def run_batch(self, *messages, context=None):
        records = [{"messageId": str(i), "body": json.dumps(m)} for i, m in enumerate(messages)]
        return handler.lambda_handler({"Records": records}, context)

    def assert_outcome(self, status, called, provider_id=None, reason=None):
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": []})
        self.assertEqual(self.trace, ["GET", "POST", "PUT", "SQS"])
        outcome = self.cached["payload"]
        self.assertEqual(outcome["status"], status)
        self.assertEqual(outcome["providerCalled"], called)
        self.assertEqual(outcome["providerId"], provider_id)
        self.assertEqual(outcome["reason"], reason)
        self.assertEqual(outcome["attemptId"], ATTEMPT)

    def test_cached_result_is_republished_unchanged_without_new_claim(self):
        self.cached = copy.deepcopy(CACHED)
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": []})
        self.assertEqual(self.trace, ["GET", "SQS"])
        self.sns.publish.assert_not_called()

    def test_backend_dry_run_ignores_enabled_worker(self):
        self.claim["mode"] = "DRY_RUN"
        self.assert_outcome("DRY_RUN", False, reason="LAB_DRY_RUN")
        self.client.assert_called_once_with("sqs")

    def test_backend_blocked_dry_run_reports_reason(self):
        self.claim.update(mode="DRY_RUN", reason="BLOCKED_PROVIDER")
        self.assert_outcome("DRY_RUN", False, reason="BLOCKED_PROVIDER")
        self.client.assert_called_once_with("sqs")

    def test_lambda_defaults_to_dry_run(self):
        del os.environ["SENDER_DRY_RUN"]
        self.assert_outcome("DRY_RUN", False, reason="SENDER_DRY_RUN")
        self.sns.publish.assert_not_called()

    def test_email_uses_authorized_topic_and_content(self):
        self.assert_outcome("PROVIDER_ACCEPTED", True, "provider-42")
        self.sns.publish.assert_called_once_with(
            TopicArn=TOPIC, Message=f"{PREFIX} Incident", Subject=f"{PREFIX} Alarm"
        )

    def test_email_rejects_mismatched_topic(self):
        self.delivery["topicArn"] += "-other"
        self.assert_outcome("FAILED", False, reason="BLOCKED_PROVIDER")
        self.sns.publish.assert_not_called()

    def test_email_subject_is_optional(self):
        del self.delivery["subject"]
        self.assert_outcome("PROVIDER_ACCEPTED", True, "provider-42")
        self.sns.publish.assert_called_once_with(TopicArn=TOPIC, Message=f"{PREFIX} Incident")

    def test_email_subject_must_be_valid_single_line(self):
        self.delivery["subject"] += "\nInvalid subject"
        self.assert_outcome("FAILED", False, reason="BLOCKED_PROVIDER")
        self.sns.publish.assert_not_called()

    def test_email_requires_environment_prefix(self):
        self.delivery["message"] = "Missing environment"
        self.assert_outcome("FAILED", False, reason="BLOCKED_PROVIDER")
        self.sns.publish.assert_not_called()

    def test_email_requires_known_environment(self):
        os.environ["APP_ENV"] = "local"
        self.assert_outcome("FAILED", False, reason="BLOCKED_PROVIDER")
        self.sns.publish.assert_not_called()

    def phone_channel(self, name, phone=PHONE):
        self.job["payload"]["channel"] = name
        self.delivery.update(channel=name, destination=phone)

    def test_sms_uses_authorized_e164_destination(self):
        self.phone_channel("SNS_SMS")
        self.assert_outcome("PROVIDER_ACCEPTED", True, "provider-42")
        self.sns.publish.assert_called_once_with(PhoneNumber=PHONE, Message=f"{PREFIX} Incident")

    def test_sms_rejects_invalid_destination(self):
        self.phone_channel("SNS_SMS", "555-0101")
        self.assert_outcome("FAILED", False, reason="BLOCKED_PROVIDER")
        self.client.assert_called_once_with("sqs")

    def configure_connect(self):
        self.phone_channel("CONNECT_CALL")
        self.delivery.update(
            instanceId="instance", contactFlowId="flow", sourcePhoneNumber=SOURCE_PHONE
        )
        os.environ.update(
            CONNECT_INSTANCE_ID="instance",
            CONNECT_CONTACT_FLOW_ID="flow",
            CONNECT_SOURCE_PHONE_NUMBER=SOURCE_PHONE,
        )

    def test_connect_uses_stable_token_and_configured_source(self):
        self.configure_connect()
        self.assert_outcome("PROVIDER_ACCEPTED", True, "call-42")
        self.connect.start_outbound_voice_contact.assert_called_once_with(
            DestinationPhoneNumber=PHONE,
            InstanceId="instance",
            ContactFlowId="flow",
            SourcePhoneNumber=SOURCE_PHONE,
            ClientToken=ID,
            Attributes={"message": f"{PREFIX} Incident"},
        )

    def test_connect_rejects_unapproved_flow(self):
        self.configure_connect()
        self.delivery["contactFlowId"] = "other-flow"
        self.assert_outcome("FAILED", False, reason="BLOCKED_PROVIDER")
        self.client.assert_called_once_with("sqs")

    def test_expired_grant_cannot_call_provider(self):
        self.claim["leaseUntil"] = "2000-01-01T00:00:00Z"
        self.assert_outcome("FAILED", False, reason="LEASE_EXPIRED")
        self.sns.publish.assert_not_called()

    def test_invalid_lease_cannot_call_provider(self):
        self.claim["leaseUntil"] = "2099-01-01T00:00:00"
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.client.assert_not_called()

    def test_no_op_completes_without_provider_or_results(self):
        self.claim = {
            "notificationId": ID,
            "disposition": "NO_OP",
            "reason": "UNCERTAIN",
        }
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": []})
        self.assertEqual(self.trace, ["GET", "POST"])
        self.client.assert_not_called()

    def test_wrong_claim_scope_is_retried_without_send(self):
        self.claim["notificationId"] = EVENT
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.client.assert_not_called()

    def test_unknown_disposition_is_retried_without_send(self):
        self.claim["disposition"] = "GARBAGE"
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.client.assert_not_called()

    def test_unknown_claim_mode_is_retried_without_send(self):
        self.claim["mode"] = "UNKNOWN"
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.client.assert_not_called()

    def test_channel_swap_is_retried_without_send(self):
        self.delivery["channel"] = "SNS_SMS"
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.client.assert_not_called()

    def test_busy_is_partial_batch_failure(self):
        self.api_mock.side_effect = [
            {"envelope": self.job, "cached_result": None},
            HTTPError("https://example.com", 409, "BUSY", {}, None),
            {"envelope": self.job, "cached_result": CACHED},
        ]
        self.cached = CACHED
        self.assertEqual(
            self.run_batch(self.job, self.job),
            {"batchItemFailures": [{"itemIdentifier": "0"}]},
        )
        self.sns.publish.assert_not_called()

    def test_context_404_from_wrong_tunnel_route_is_retained_for_retry(self):
        self.api_mock.side_effect = HTTPError("https://example.com", 404, "Missing", {}, None)
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.client.assert_not_called()

    def test_live_invocation_with_thirty_seconds_sends_and_persists(self):
        context = MagicMock()
        context.get_remaining_time_in_millis.return_value = 30_000
        self.assertEqual(self.run_batch(self.job, context=context), {"batchItemFailures": []})
        self.assertEqual(self.trace, ["GET", "POST", "PUT", "SQS"])
        self.assertEqual(self.cached["payload"]["status"], "PROVIDER_ACCEPTED")
        self.assertGreaterEqual(context.get_remaining_time_in_millis.call_count, 4)

    def test_low_remaining_time_after_context_lookup_blocks_claim(self):
        context = MagicMock()
        context.get_remaining_time_in_millis.side_effect = [30_000, 10_000]
        self.assertEqual(
            self.run_batch(self.job, context=context),
            {"batchItemFailures": [{"itemIdentifier": "0"}]},
        )
        self.assertEqual(self.trace, ["GET"])
        self.client.assert_not_called()

    def test_time_runs_low_after_claim_and_worker_persists_failure_without_provider_call(
        self,
    ):
        context = MagicMock()
        context.get_remaining_time_in_millis.side_effect = [
            30_000,
            26_000,
            12_000,
            11_000,
            9_000,
        ]
        self.assertEqual(self.run_batch(self.job, context=context), {"batchItemFailures": []})
        self.assertEqual(self.trace, ["GET", "POST", "PUT", "SQS"])
        self.sns.publish.assert_not_called()
        self.assertEqual(self.cached["payload"]["status"], "FAILED")
        self.assertFalse(self.cached["payload"]["providerCalled"])
        self.assertEqual(self.cached["payload"]["reason"], "LAMBDA_TIME_BUDGET")

    def test_time_runs_low_after_provider_and_worker_prioritizes_durable_cache(self):
        context = MagicMock()
        context.get_remaining_time_in_millis.side_effect = [
            30_000,
            26_000,
            22_000,
            8_000,
            3_000,
        ]
        self.assertEqual(
            self.run_batch(self.job, context=context),
            {"batchItemFailures": [{"itemIdentifier": "0"}]},
        )
        self.assertEqual(self.trace, ["GET", "POST", "PUT"])
        self.assertEqual(self.cached["payload"]["status"], "PROVIDER_ACCEPTED")
        self.sqs.send_message.assert_not_called()

    def test_cached_publish_is_retained_when_remaining_time_cannot_cover_sqs(self):
        self.cached = CACHED
        context = MagicMock()
        context.get_remaining_time_in_millis.side_effect = [12_000, 6_000]
        self.assertEqual(
            self.run_batch(self.job, context=context),
            {"batchItemFailures": [{"itemIdentifier": "0"}]},
        )
        self.assertEqual(self.trace, ["GET"])
        self.client.assert_not_called()

    def test_low_remaining_time_never_starts_context_lookup(self):
        context = MagicMock()
        context.get_remaining_time_in_millis.return_value = 1_000
        self.assertEqual(
            self.run_batch(self.job, context=context),
            {"batchItemFailures": [{"itemIdentifier": "0"}]},
        )
        self.api_mock.assert_not_called()

    def test_forged_payload_never_reaches_claim(self):
        forged = copy.deepcopy(self.job)
        forged["payload"]["expectedEventVersion"] += 1
        self.assertEqual(self.run_batch(forged), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.assertEqual(self.trace, ["GET"])
        self.client.assert_not_called()

    def test_wrong_queue_type_never_reaches_backend(self):
        self.assertEqual(self.run_batch(CACHED), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.api_mock.assert_not_called()

    def test_cached_result_must_be_for_matching_owner(self):
        self.cached = copy.deepcopy(CACHED)
        self.cached["payload"]["ownerScopeId"] = ID
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.client.assert_not_called()

    def test_provider_timeout_caches_uncertain(self):
        self.sns.publish.side_effect = TimeoutError("delivery outcome unknown")
        self.assert_outcome("UNCERTAIN", True, reason="PROVIDER_CALL_UNCERTAIN")

    def test_provider_5xx_caches_uncertain(self):
        self.sns.publish.side_effect = ClientError({"Error": {"Code": "InternalError"}}, "Publish")
        self.assert_outcome("UNCERTAIN", True, reason="PROVIDER_CALL_UNCERTAIN")

    def test_provider_rejection_caches_failed(self):
        self.sns.publish.side_effect = ClientError({"Error": {"Code": "AccessDenied"}}, "Publish")
        self.assert_outcome("FAILED", True, reason="BLOCKED_PROVIDER")

    def test_missing_credentials_caches_failed_without_provider_called(self):
        self.sns.publish.side_effect = NoCredentialsError()
        self.assert_outcome("FAILED", False, reason="BLOCKED_PROVIDER")

    def test_empty_provider_id_caches_uncertain(self):
        self.sns.publish.return_value = {"MessageId": ""}
        self.assert_outcome("UNCERTAIN", True, reason="PROVIDER_CALL_UNCERTAIN")

    def test_cache_failure_never_publishes_unstored_result(self):
        def fail_put(path, *, method="GET", data=None):
            if method == "PUT":
                raise TimeoutError
            return self.api(path, method=method, data=data)

        self.api_mock.side_effect = fail_put
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.sns.publish.assert_called_once()
        self.sqs.send_message.assert_not_called()

    def test_publish_failure_retries_stored_result_without_second_provider_call(self):
        self.sqs.send_message.side_effect = [TimeoutError, None]
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": []})
        self.sns.publish.assert_called_once()
        self.assertEqual(
            self.sqs.send_message.call_args_list[0],
            self.sqs.send_message.call_args_list[1],
        )

    def test_invalid_attempt_id_is_retried_before_any_provider_call(self):
        self.claim["attemptId"] = "not-an-attempt"
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.client.assert_not_called()

    def test_client_setup_cannot_outlast_lease(self):
        from datetime import datetime

        clock = MagicMock(wraps=datetime)
        clock.now.side_effect = [
            datetime(2026, 11, 21, tzinfo=UTC),
            datetime(2100, 1, 1, tzinfo=UTC),
            datetime(2100, 1, 1, tzinfo=UTC),
        ]
        with patch.object(handler, "datetime", clock):
            self.assert_outcome("FAILED", False, reason="LEASE_EXPIRED")
        self.sns.publish.assert_not_called()

    def test_backend_lookup_5xx_is_retried(self):
        self.api_mock.side_effect = HTTPError("https://example.com", 502, "Bad Gateway", {}, None)
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.client.assert_not_called()

    def test_publishes_canonical_first_writer_after_cache_put(self):
        self.claim["mode"] = "DRY_RUN"
        self.api_mock.side_effect = [
            {"envelope": self.job, "cached_result": None},
            self.claim,
            CACHED,
        ]
        self.cached = CACHED
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": []})
        self.sqs.send_message.assert_called_once()

    def test_replay_without_cache_relies_on_backend_no_op_fence(self):
        original = self.api_mock.side_effect

        def fence_after_first_claim(path, *, method="GET", data=None):
            if method == "PUT":
                self.claim = {
                    "notificationId": ID,
                    "disposition": "NO_OP",
                    "reason": "UNCERTAIN",
                }
                raise TimeoutError
            return original(path, method=method, data=data)

        self.api_mock.side_effect = fence_after_first_claim
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": [{"itemIdentifier": "0"}]})
        self.assertEqual(self.run_batch(self.job), {"batchItemFailures": []})
        self.sns.publish.assert_called_once()
        self.sqs.send_message.assert_not_called()

    def test_bundled_schema_matches_canonical_contract(self):
        packaged = Path(handler.__file__).with_name("queue-v1.schema.json")
        canonical = FIXTURES.parent / "queue-v1.schema.json"
        self.assertEqual(packaged.read_bytes(), canonical.read_bytes())

    def test_empty_batch_has_no_side_effects(self):
        self.assertEqual(self.run_batch(), {"batchItemFailures": []})
        self.api_mock.assert_not_called()
        self.client.assert_not_called()


class TransportTests(unittest.TestCase):
    def test_https_request_options(self):
        with (
            patch.dict(
                os.environ,
                {
                    "INTERNAL_API_BASE_URL": "https://example.com/api/v1",
                    "INTERNAL_SERVICE_TOKEN": "x" * 32,
                },
            ),
            patch.object(handler, "BACKEND_OPENER") as opener,
        ):
            opener.open.return_value.__enter__.return_value.read.return_value = b'{"ok":true}'
            self.assertEqual(
                handler.backend("/check", method="PUT", data={"version": 1}),
                {"ok": True},
            )
            request = opener.open.call_args.args[0]
            self.assertEqual(request.full_url, "https://example.com/api/v1/check")
            self.assertEqual(request.method, "PUT")
            self.assertEqual(request.get_header("X-internal-token"), "x" * 32)
            self.assertEqual(json.loads(request.data), {"version": 1})

    def test_backend_url_requires_https_api_v1(self):
        for base in (
            "http://example.com/api/v1",
            "https://example.com",
            "https://example.com/api/v1?x=y",
        ):
            with (
                self.subTest(base=base),
                patch.dict(os.environ, {"INTERNAL_API_BASE_URL": base}),
                self.assertRaises(ValueError),
            ):
                handler.backend("/check")

    def test_rejects_short_token(self):
        with (
            patch.dict(
                os.environ,
                {
                    "INTERNAL_API_BASE_URL": "https://example.com/api/v1",
                    "INTERNAL_SERVICE_TOKEN": "short",
                },
            ),
            self.assertRaises(ValueError),
        ):
            handler.backend("/check")

    def test_rejects_redirect_including_token_forward(self):
        with self.assertRaises(ValueError):
            handler.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example")

    def test_provider_client_is_reused_and_has_no_sdk_retry(self):
        with (
            patch.dict(os.environ, {"AWS_REGION": "ap-southeast-1"}),
            patch.dict(handler.CLIENTS, clear=True),
            patch.object(handler.boto3, "client") as boto,
        ):
            self.assertIs(handler.client("sns"), handler.client("sns"))
            self.assertEqual(boto.call_count, 1)
            self.assertEqual(boto.call_args.kwargs["config"].retries["total_max_attempts"], 1)
