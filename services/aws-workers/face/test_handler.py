import copy
import json
import os
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import handler

FIXTURES = Path(__file__).resolve().parents[3] / "aws/sprint4/contracts/fixtures"


class FaceWorkerTests(unittest.TestCase):
    def setUp(self):
        self.job = json.loads((FIXTURES / "face-job.valid.json").read_text())
        self.result = json.loads((FIXTURES / "face-result-unknown.valid.json").read_text())
        self.environment = patch.dict(
            os.environ,
            {
                "S3_BUCKET": self.job["payload"]["image"]["bucket"],
                "APPLICATION_RESULTS_QUEUE_URL": "queue",
                "REKOGNITION_MATCH_THRESHOLD": "0.90",
            },
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_replay_uses_exact_durable_result_without_recognition(self):
        backend = Mock(
            return_value={
                "envelope": self.job,
                "cached_result": self.result,
                "mappings": {},
            }
        )
        sqs = Mock()
        with (
            patch.object(handler, "backend", backend),
            patch.object(handler, "client", return_value=sqs),
            patch.object(handler, "recognize") as recognize,
        ):
            handler.process(self.job)
        recognize.assert_not_called()
        self.assertEqual(json.loads(sqs.send_message.call_args.kwargs["MessageBody"]), self.result)

    def test_cache_commit_precedes_publication_and_first_writer_wins(self):
        calls = []

        def backend(_path, data=None):
            calls.append("context" if data is None else "cache")
            if data is None:
                return {"envelope": self.job, "cached_result": None, "mappings": {}}
            return self.result

        sqs = Mock()
        sqs.send_message.side_effect = lambda **_kwargs: calls.append("send")
        with (
            patch.object(handler, "backend", backend),
            patch.object(handler, "recognize", return_value=self.result["payload"]["body"]),
            patch.object(handler, "client", return_value=sqs),
        ):
            handler.process(self.job)
        self.assertEqual(calls, ["context", "cache", "send"])

    def test_tampered_owner_rejected_before_provider(self):
        altered = copy.deepcopy(self.job)
        altered["payload"]["ownerScopeId"] = "99999999-9999-4999-8999-999999999999"
        with self.assertRaises(ValueError):
            handler.validate_job(altered, {"envelope": self.job})

    def test_collection_prefix_env_validation(self):
        for prefix in (
            "camerai-s4-dev-owner-",
            "argusai-staging-owner-",
            "argusai-production-owner-",
        ):
            job = copy.deepcopy(self.job)
            job["payload"]["collectionId"] = prefix + job["payload"]["ownerScopeId"]
            with patch.dict(os.environ, {"REKOGNITION_COLLECTION_PREFIX": prefix}):
                handler.validate_job(job, {"envelope": job})

        with (
            patch.dict(os.environ, {"REKOGNITION_COLLECTION_PREFIX": "argusai-staging-owner-"}),
            self.assertRaises(ValueError),
        ):
            handler.validate_job(self.job, {"envelope": self.job})

        for invalid in ("", "   ", "custom-owner-", "argusai-staging-"):
            with (
                patch.dict(os.environ, {"REKOGNITION_COLLECTION_PREFIX": invalid}),
                self.assertRaises(ValueError),
            ):
                handler.validate_job(self.job, {"envelope": self.job})

    def test_partial_failure_retries_failed_record_only(self):
        event = {
            "Records": [
                {"messageId": "a", "body": "{}"},
                {"messageId": "b", "body": "{}"},
            ]
        }
        with patch.object(handler, "process", side_effect=[ValueError(), None]):
            self.assertEqual(
                handler.lambda_handler(event, None),
                {"batchItemFailures": [{"itemIdentifier": "a"}]},
            )

    def test_known_unknown_no_face_multiple_empty_and_missing_mapping(self):
        rek = Mock()
        rek.detect_faces.return_value = {"FaceDetails": [{}]}
        rek.describe_collection.return_value = {
            "FaceCount": 1,
            "FaceModelVersion": "7.0",
        }
        rek.search_faces_by_image.return_value = {
            "FaceMatches": [{"Similarity": 95, "Face": {"FaceId": "face"}}]
        }
        with patch.object(handler, "client", return_value=rek):
            known = handler.recognize(
                self.job["payload"], {"face": "00000000-0000-4000-8000-000000000001"}
            )
            self.assertEqual(known["personStatus"], "KNOWN")
            with self.assertRaises(ValueError):
                handler.recognize(self.job["payload"], {})
            rek.search_faces_by_image.return_value["FaceMatches"][0]["Similarity"] = 60
            unknown = handler.recognize(self.job["payload"], {})
            self.assertEqual(unknown["personStatus"], "UNKNOWN")
            self.assertAlmostEqual(unknown["results"][0]["confidence"], 0.4)
            rek.describe_collection.return_value["FaceCount"] = 0
            self.assertEqual(
                handler.recognize(self.job["payload"], {})["results"][0]["confidence"],
                1,
            )
            for faces in [[], [{}, {}]]:
                rek.detect_faces.return_value = {"FaceDetails": faces}
                body = handler.recognize(self.job["payload"], {})
                self.assertEqual(body["personStatus"], "UNDETERMINED")
                self.assertIsNone(body["results"][0]["confidence"])

    def test_client_caches_boto3_client_per_service(self):
        mock_client = Mock()
        with (
            patch.dict(os.environ, {"AWS_REGION": "ap-southeast-1"}),
            patch.dict(handler._CLIENTS, {}, clear=True),
            patch.object(handler.boto3, "client", return_value=mock_client) as boto_client,
        ):
            first = handler.client("rekognition")
            second = handler.client("rekognition")
        self.assertIs(first, mock_client)
        self.assertIs(second, mock_client)
        boto_client.assert_called_once()
        self.assertEqual(boto_client.call_args.args[0], "rekognition")
        self.assertEqual(boto_client.call_args.kwargs["region_name"], "ap-southeast-1")

    def test_no_redirect_rejects_redirects(self):
        with self.assertRaises(ValueError):
            handler.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other")

    def test_backend_validates_https_token_and_executes_get_and_put(self):
        with (
            patch.dict(
                os.environ,
                {
                    "INTERNAL_API_BASE_URL": "http://api.example.com",
                    "INTERNAL_SERVICE_TOKEN": "t" * 32,
                },
            ),
            self.assertRaises(ValueError),
        ):
            handler.backend("/internal/health")

        with (
            patch.dict(
                os.environ,
                {
                    "INTERNAL_API_BASE_URL": "https://api.example.com",
                    "INTERNAL_SERVICE_TOKEN": "short",
                },
            ),
            self.assertRaises(ValueError),
        ):
            handler.backend("/internal/health")

        response_cm = Mock()
        response_cm.__enter__ = Mock(return_value=response_cm)
        response_cm.__exit__ = Mock(return_value=False)
        response_cm.read.return_value = b'{"ok": true}'
        opener = Mock()
        opener.open.return_value = response_cm

        with (
            patch.dict(
                os.environ,
                {
                    "INTERNAL_API_BASE_URL": "https://api.example.com/",
                    "INTERNAL_SERVICE_TOKEN": "t" * 32,
                },
            ),
            patch.object(handler, "build_opener", return_value=opener),
        ):
            get_res = handler.backend("/internal/cloud/face-jobs/1")
            put_res = handler.backend("/internal/cloud/face-jobs/1/result", {"ok": True})

        self.assertEqual(get_res, {"ok": True})
        self.assertEqual(put_res, {"ok": True})
        first_req = opener.open.call_args_list[0].args[0]
        second_req = opener.open.call_args_list[1].args[0]
        self.assertEqual(first_req.get_method(), "GET")
        self.assertIsNone(first_req.data)
        self.assertEqual(first_req.full_url, "https://api.example.com/internal/cloud/face-jobs/1")
        self.assertEqual(second_req.get_method(), "PUT")
        self.assertEqual(json.loads(second_req.data.decode()), {"ok": True})

    def test_recognize_rejects_invalid_threshold_and_handles_no_similarity_matches(
        self,
    ):
        rek = Mock()
        rek.detect_faces.return_value = {"FaceDetails": [{}]}
        rek.describe_collection.return_value = {
            "FaceCount": 1,
            "FaceModelVersion": "7.0",
        }
        rek.search_faces_by_image.return_value = {"FaceMatches": []}
        with patch.object(handler, "client", return_value=rek):
            for bad in ("0", "-0.5", "1.1"):
                with (
                    patch.dict(os.environ, {"REKOGNITION_MATCH_THRESHOLD": bad}),
                    self.assertRaises(ValueError),
                ):
                    handler.recognize(self.job["payload"], {})

            body = handler.recognize(self.job["payload"], {})
        self.assertEqual(body["personStatus"], "UNDETERMINED")
        self.assertIsNone(body["results"][0]["confidence"])
        self.assertEqual(body["results"][0]["metadata"]["qualityReason"], "NO_SIMILARITY_SCORE")

    def test_process_rejects_non_face_job_envelope(self):
        with self.assertRaises(ValueError):
            handler.process(self.result)

    def test_logs_ids_status_cache_and_safe_error_type_without_exception_secrets(self):
        context = {"envelope": self.job, "cached_result": self.result, "mappings": {}}
        with (
            patch.object(handler, "backend", return_value=context),
            patch.object(handler, "client", return_value=Mock()),
            self.assertLogs(handler.LOGGER, level="INFO") as captured,
        ):
            handler.process(self.job)
        self.assertIn("cacheHit=True", captured.output[0])
        self.assertIn(self.job["payload"]["jobId"], captured.output[0])
        event = {"Records": [{"messageId": "safe-id", "body": "{}"}]}
        with (
            patch.object(handler, "process", side_effect=ValueError("secret-token-test")),
            self.assertLogs(handler.LOGGER, level="WARNING") as captured,
        ):
            result = handler.lambda_handler(event, None)
        self.assertEqual(result, {"batchItemFailures": [{"itemIdentifier": "safe-id"}]})
        self.assertIn("errorType=ValueError", captured.output[0])
        self.assertNotIn("secret-token-test", captured.output[0])


if __name__ == "__main__":
    unittest.main()
