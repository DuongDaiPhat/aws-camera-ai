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
        self.result = json.loads(
            (FIXTURES / "face-result-unknown.valid.json").read_text()
        )
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
        self.assertEqual(
            json.loads(sqs.send_message.call_args.kwargs["MessageBody"]), self.result
        )

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
            patch.object(
                handler, "recognize", return_value=self.result["payload"]["body"]
            ),
            patch.object(handler, "client", return_value=sqs),
        ):
            handler.process(self.job)
        self.assertEqual(calls, ["context", "cache", "send"])

    def test_tampered_owner_rejected_before_provider(self):
        altered = copy.deepcopy(self.job)
        altered["payload"]["ownerScopeId"] = "99999999-9999-4999-8999-999999999999"
        with self.assertRaises(ValueError):
            handler.validate_job(altered, {"envelope": self.job})

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


if __name__ == "__main__":
    unittest.main()
