import copy
import json
import os
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import handler
from botocore.errorfactory import ClientExceptionsFactory
from botocore.exceptions import ClientError
from botocore.session import get_session

FIXTURES = Path(__file__).resolve().parents[3] / "aws/sprint4/contracts/fixtures"
REK_EXCEPTIONS = ClientExceptionsFactory().create_client_exceptions(
    get_session().get_service_model("rekognition")
)


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

    def _wrap_result(self, body):
        payload = self.job["payload"]
        return {
            "schemaVersion": 1,
            "type": "face.result",
            "messageId": payload["resultId"],
            "correlationId": payload["eventId"],
            "occurredAt": body["processedAt"],
            "payload": {
                "jobId": payload["jobId"],
                "ownerScopeId": payload["ownerScopeId"],
                "cameraId": payload["cameraId"],
                "body": body,
            },
        }

    def test_skip_detect_faces_flag_parsing(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("REKOGNITION_SKIP_DETECT_FACES", None)
            self.assertTrue(handler.skip_detect_faces())
        for truthy in ("", "   ", "true", "TRUE", " 1 ", "yes", "YeS"):
            with patch.dict(os.environ, {"REKOGNITION_SKIP_DETECT_FACES": truthy}):
                self.assertTrue(handler.skip_detect_faces())
        for falsy in ("false", "FALSE", " 0 ", "no", "No"):
            with patch.dict(os.environ, {"REKOGNITION_SKIP_DETECT_FACES": falsy}):
                self.assertFalse(handler.skip_detect_faces())
        for invalid in ("maybe", "2", "off"):
            with (
                patch.dict(os.environ, {"REKOGNITION_SKIP_DETECT_FACES": invalid}),
                self.assertRaises(ValueError),
            ):
                handler.skip_detect_faces()

    def test_fast_path_calls_search_once_for_known_and_unknown_without_detect_or_describe(
        self,
    ):
        rek = Mock(exceptions=REK_EXCEPTIONS)
        rek.search_faces_by_image.return_value = {
            "FaceModelVersion": "7.0",
            "FaceMatches": [{"Similarity": 95, "Face": {"FaceId": "face"}}],
        }
        mappings = {"face": "00000000-0000-4000-8000-000000000001"}
        with patch.object(handler, "client", return_value=rek):
            known = handler.recognize(self.job["payload"], mappings)
            self.assertEqual(known["personStatus"], "KNOWN")
            self.assertEqual(known["modelVersion"], "rekognition-7.0")
            self.assertEqual(known["matchedKnownFaceId"], mappings["face"])
            self.assertAlmostEqual(known["results"][0]["confidence"], 0.95)
            handler.VALIDATOR.validate(self._wrap_result(known))
            rek.search_faces_by_image.assert_called_once_with(
                CollectionId=self.job["payload"]["collectionId"],
                Image={
                    "S3Object": {
                        "Bucket": self.job["payload"]["image"]["bucket"],
                        "Name": self.job["payload"]["image"]["key"],
                    }
                },
                FaceMatchThreshold=0,
                MaxFaces=1,
                QualityFilter="NONE",
            )
            rek.detect_faces.assert_not_called()
            rek.describe_collection.assert_not_called()

            with self.assertRaises(ValueError):
                handler.recognize(self.job["payload"], {}, collection_face_count=2)

            rek.reset_mock()
            rek.search_faces_by_image.return_value = {
                "FaceMatches": [{"Similarity": 60, "Face": {"FaceId": "face"}}]
            }
            with patch.dict(os.environ, {"REKOGNITION_SKIP_DETECT_FACES": "yes"}):
                unknown = handler.recognize(self.job["payload"], {}, collection_face_count=2)
            self.assertEqual(unknown["personStatus"], "UNKNOWN")
            self.assertEqual(unknown["modelVersion"], "rekognition")
            self.assertIsNone(unknown["matchedKnownFaceId"])
            self.assertAlmostEqual(unknown["results"][0]["confidence"], 0.4)
            handler.VALIDATOR.validate(self._wrap_result(unknown))
            rek.search_faces_by_image.assert_called_once()
            rek.detect_faces.assert_not_called()
            rek.describe_collection.assert_not_called()

    def test_fast_path_empty_collection_makes_zero_rekognition_calls(self):
        with patch.object(handler, "client") as client_factory:
            body = handler.recognize(self.job["payload"], {}, collection_face_count=0)
        client_factory.assert_not_called()
        self.assertEqual(body["personStatus"], "UNKNOWN")
        self.assertEqual(body["modelVersion"], "rekognition")
        self.assertIsNone(body["matchedKnownFaceId"])
        self.assertIsNone(body["error"])
        self.assertEqual(body["results"][0]["confidence"], 1.0)
        self.assertIsNone(body["results"][0]["metadata"]["similarity"])
        self.assertEqual(
            body["results"][0]["metadata"]["confidencePolicyVersion"],
            "empty-collection-v1",
        )
        self.assertIsNone(body["results"][0]["metadata"]["qualityReason"])
        handler.VALIDATOR.validate(self._wrap_result(body))

    def test_fast_path_invalid_parameter_exception_maps_to_undetermined_without_retry(
        self,
    ):
        rek = Mock(exceptions=REK_EXCEPTIONS)
        rek.search_faces_by_image.side_effect = REK_EXCEPTIONS.InvalidParameterException(
            {
                "Error": {
                    "Code": "InvalidParameterException",
                    "Message": "No face in image",
                }
            },
            "SearchFacesByImage",
        )
        with patch.object(handler, "client", return_value=rek):
            body = handler.recognize(self.job["payload"], {}, collection_face_count=1)
        self.assertEqual(body["personStatus"], "UNDETERMINED")
        self.assertEqual(body["modelVersion"], "rekognition")
        self.assertIsNone(body["error"])
        self.assertIsNone(body["results"][0]["confidence"])
        self.assertIsNone(body["results"][0]["metadata"]["similarity"])
        self.assertEqual(body["results"][0]["metadata"]["qualityReason"], "NO_FACE_DETECTED")
        handler.VALIDATOR.validate(self._wrap_result(body))

        sqs = Mock()
        stored = []

        def fake_backend(_path, data=None):
            if data is None:
                return {
                    "envelope": self.job,
                    "cached_result": None,
                    "mappings": {},
                    "collection_face_count": 1,
                }
            stored.append(data)
            return data

        def fake_client(service):
            return rek if service == "rekognition" else sqs

        event = {"Records": [{"messageId": "no-face-msg", "body": json.dumps(self.job)}]}
        with (
            patch.object(handler, "backend", side_effect=fake_backend),
            patch.object(handler, "client", side_effect=fake_client),
        ):
            response = handler.lambda_handler(event, None)
        self.assertEqual(response, {"batchItemFailures": []})
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["payload"]["body"]["personStatus"], "UNDETERMINED")
        self.assertEqual(
            stored[0]["payload"]["body"]["results"][0]["metadata"]["qualityReason"],
            "NO_FACE_DETECTED",
        )
        sqs.send_message.assert_called_once()

    def test_fast_path_other_client_error_reraises_for_sqs_retry(self):
        rek = Mock(exceptions=REK_EXCEPTIONS)
        rek.search_faces_by_image.side_effect = ClientError(
            {"Error": {"Code": "ThrottlingException", "Message": "Rate exceeded"}},
            "SearchFacesByImage",
        )
        with (
            patch.object(handler, "client", return_value=rek),
            self.assertRaises(ClientError),
        ):
            handler.recognize(self.job["payload"], {}, collection_face_count=1)

        sqs = Mock()
        event = {"Records": [{"messageId": "retry-msg", "body": json.dumps(self.job)}]}
        with (
            patch.object(
                handler,
                "backend",
                return_value={
                    "envelope": self.job,
                    "cached_result": None,
                    "mappings": {},
                    "collection_face_count": 1,
                },
            ),
            patch.object(
                handler,
                "client",
                side_effect=lambda service: rek if service == "rekognition" else sqs,
            ),
            self.assertLogs(handler.LOGGER, level="WARNING") as captured,
        ):
            response = handler.lambda_handler(event, None)
        self.assertEqual(response, {"batchItemFailures": [{"itemIdentifier": "retry-msg"}]})
        self.assertIn("errorType=ClientError", captured.output[0])
        sqs.send_message.assert_not_called()

    def test_unavailable_s3_image_is_undetermined_without_turning_it_into_unknown(self):
        rek = Mock(exceptions=REK_EXCEPTIONS)
        rek.search_faces_by_image.side_effect = REK_EXCEPTIONS.InvalidS3ObjectException(
            {
                "Error": {
                    "Code": "InvalidS3ObjectException",
                    "Message": "Image unavailable",
                },
                "ResponseMetadata": {"RequestId": "s3-image-request"},
            },
            "SearchFacesByImage",
        )
        with patch.object(handler, "client", return_value=rek):
            result = handler.recognize(self.job["payload"], {}, collection_face_count=1)
        self.assertEqual(result["personStatus"], "UNDETERMINED")
        self.assertIsNone(result["matchedKnownFaceId"])
        self.assertEqual(result["results"][0]["metadata"]["qualityReason"], "IMAGE_UNAVAILABLE")
        handler.VALIDATOR.validate(self._wrap_result(result))

    def test_process_forwards_collection_face_count_and_handles_missing_count(self):
        sqs = Mock()
        backend = Mock(
            side_effect=[
                {
                    "envelope": self.job,
                    "cached_result": None,
                    "mappings": {},
                    "collection_face_count": 0,
                },
                self.result,
            ]
        )
        with (
            patch.object(handler, "backend", backend),
            patch.object(
                handler,
                "client",
                side_effect=lambda service: sqs if service == "sqs" else AssertionError(service),
            ),
        ):
            handler.process(self.job)
        put_payload = backend.call_args_list[1].args[1]
        self.assertEqual(put_payload["payload"]["body"]["personStatus"], "UNKNOWN")
        self.assertEqual(
            put_payload["payload"]["body"]["results"][0]["metadata"]["confidencePolicyVersion"],
            "empty-collection-v1",
        )
        sqs.send_message.assert_called_once()

        rek = Mock(exceptions=REK_EXCEPTIONS)
        rek.search_faces_by_image.return_value = {
            "FaceModelVersion": "7.0",
            "FaceMatches": [{"Similarity": 60, "Face": {"FaceId": "face"}}],
        }
        backend_no_count = Mock(
            side_effect=[
                {"envelope": self.job, "cached_result": None, "mappings": {}},
                self.result,
            ]
        )
        with (
            patch.object(handler, "backend", backend_no_count),
            patch.object(
                handler,
                "client",
                side_effect=lambda service: rek if service == "rekognition" else sqs,
            ),
        ):
            handler.process(self.job)
        rek.search_faces_by_image.assert_called_once()
        rek.detect_faces.assert_not_called()
        rek.describe_collection.assert_not_called()

    def test_legacy_mode_known_unknown_no_face_multiple_empty_and_collection_count(
        self,
    ):
        rek = Mock(exceptions=REK_EXCEPTIONS)
        rek.detect_faces.return_value = {"FaceDetails": [{}]}
        rek.describe_collection.return_value = {
            "FaceCount": 1,
            "FaceModelVersion": "7.0",
        }
        rek.search_faces_by_image.return_value = {
            "FaceMatches": [{"Similarity": 95, "Face": {"FaceId": "face"}}]
        }
        with (
            patch.dict(os.environ, {"REKOGNITION_SKIP_DETECT_FACES": "false"}),
            patch.object(handler, "client", return_value=rek),
        ):
            known = handler.recognize(
                self.job["payload"], {"face": "00000000-0000-4000-8000-000000000001"}
            )
            self.assertEqual(known["personStatus"], "KNOWN")
            self.assertEqual(known["modelVersion"], "rekognition-7.0")
            rek.detect_faces.assert_called_once()
            rek.describe_collection.assert_called_once()
            rek.search_faces_by_image.assert_called_once()

            with self.assertRaises(ValueError):
                handler.recognize(self.job["payload"], {})

            rek.search_faces_by_image.return_value["FaceMatches"][0]["Similarity"] = 60
            unknown = handler.recognize(self.job["payload"], {})
            self.assertEqual(unknown["personStatus"], "UNKNOWN")
            self.assertAlmostEqual(unknown["results"][0]["confidence"], 0.4)

            rek.describe_collection.return_value["FaceCount"] = 0
            rek.search_faces_by_image.reset_mock()
            empty_legacy = handler.recognize(self.job["payload"], {})
            self.assertEqual(empty_legacy["results"][0]["confidence"], 1.0)
            self.assertEqual(
                empty_legacy["results"][0]["metadata"]["confidencePolicyVersion"],
                "empty-collection-v1",
            )
            rek.search_faces_by_image.assert_not_called()

            rek.reset_mock()
            empty_known_count = handler.recognize(self.job["payload"], {}, collection_face_count=0)
            self.assertEqual(empty_known_count["personStatus"], "UNKNOWN")
            self.assertEqual(empty_known_count["results"][0]["confidence"], 1.0)
            rek.detect_faces.assert_called_once()
            rek.describe_collection.assert_not_called()
            rek.search_faces_by_image.assert_not_called()

            rek.reset_mock()
            rek.search_faces_by_image.return_value = {
                "FaceModelVersion": "7.0",
                "FaceMatches": [{"Similarity": 95, "Face": {"FaceId": "face"}}],
            }
            known_count = handler.recognize(
                self.job["payload"],
                {"face": "00000000-0000-4000-8000-000000000001"},
                collection_face_count=3,
            )
            self.assertEqual(known_count["personStatus"], "KNOWN")
            self.assertEqual(known_count["modelVersion"], "rekognition-7.0")
            rek.detect_faces.assert_called_once()
            rek.describe_collection.assert_not_called()
            rek.search_faces_by_image.assert_called_once()

            for faces, expected_reason in [
                ([], "NO_FACE_DETECTED"),
                ([{}, {}], "MULTIPLE_FACES"),
            ]:
                rek.reset_mock()
                rek.detect_faces.return_value = {"FaceDetails": faces}
                body = handler.recognize(self.job["payload"], {})
                self.assertEqual(body["personStatus"], "UNDETERMINED")
                self.assertIsNone(body["results"][0]["confidence"])
                self.assertEqual(body["results"][0]["metadata"]["qualityReason"], expected_reason)
                rek.describe_collection.assert_not_called()
                rek.search_faces_by_image.assert_not_called()

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
        rek = Mock(exceptions=REK_EXCEPTIONS)
        rek.search_faces_by_image.return_value = {"FaceMatches": []}
        with patch.object(handler, "client", return_value=rek) as client_factory:
            for bad in ("0", "-0.5", "1.1"):
                with (
                    patch.dict(os.environ, {"REKOGNITION_MATCH_THRESHOLD": bad}),
                    self.assertRaises(ValueError),
                ):
                    handler.recognize(self.job["payload"], {})
            client_factory.assert_not_called()

            body = handler.recognize(self.job["payload"], {})
        rek.detect_faces.assert_not_called()
        rek.describe_collection.assert_not_called()
        rek.search_faces_by_image.assert_called_once()
        self.assertEqual(body["personStatus"], "UNDETERMINED")
        self.assertIsNone(body["results"][0]["confidence"])
        self.assertEqual(body["results"][0]["metadata"]["qualityReason"], "NO_SIMILARITY_SCORE")
        handler.VALIDATOR.validate(self._wrap_result(body))

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
