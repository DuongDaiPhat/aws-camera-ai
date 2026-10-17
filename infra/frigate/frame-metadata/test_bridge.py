import unittest

from bridge import frame_payload


class FramePayloadTest(unittest.TestCase):
    def test_publishes_current_person_box_within_max_age(self):
        person = {
            "id": "p1",
            "label": "person",
            "score": 0.95,
            "box": [10, 20, 100, 200],
            "false_positive": False,
            "frame_time": 123.4,
        }
        result = frame_payload(["cam_test", "frame", 123.5, [person], [], []])
        self.assertEqual(
            result,
            {
                "camera": "cam_test",
                "frameTime": 123.5,
                "objects": [
                    {
                        "id": "p1",
                        "label": "person",
                        "score": 0.95,
                        "box": [10, 20, 100, 200],
                        "observedAt": 123.4,
                    }
                ],
            },
        )

    def test_filters_out_stale_person_older_than_max_age(self):
        stale_person = {
            "id": "p_stale",
            "label": "person",
            "score": 0.9,
            "box": [10, 20, 100, 200],
            "false_positive": False,
            "frame_time": 123.1,  # age = 123.5 - 123.1 = 0.4s > 0.25s
        }
        fresh_person = {
            "id": "p_fresh",
            "label": "person",
            "score": 0.92,
            "box": [30, 40, 150, 250],
            "false_positive": False,
            "frame_time": 123.35,  # age = 123.5 - 123.35 = 0.15s <= 0.25s
        }
        result = frame_payload(["cam_test", "frame", 123.5, [stale_person, fresh_person], [], []])
        self.assertEqual(len(result["objects"]), 1)
        self.assertEqual(result["objects"][0]["id"], "p_fresh")
        self.assertEqual(result["objects"][0]["observedAt"], 123.35)

    def test_filters_out_person_missing_frame_time(self):
        missing_time = {
            "id": "p_no_time",
            "label": "person",
            "score": 0.9,
            "box": [10, 20, 100, 200],
            "false_positive": False,
        }
        result = frame_payload(["cam_test", "frame", 123.5, [missing_time], [], []])
        self.assertEqual(result["objects"], [])

    def test_filters_out_future_timestamp(self):
        future_person = {
            "id": "p_future",
            "label": "person",
            "score": 0.9,
            "box": [10, 20, 100, 200],
            "false_positive": False,
            "frame_time": 124.0,  # in the future
        }
        result = frame_payload(["cam_test", "frame", 123.5, [future_person], [], []])
        self.assertEqual(result["objects"], [])

    def test_filters_out_false_positive_ended_other_labels_or_null_box(self):
        base = {
            "id": "p1",
            "label": "person",
            "score": 0.9,
            "box": [1, 2, 3, 4],
            "false_positive": False,
            "frame_time": 123.5,
        }
        objects = [
            {**base, "false_positive": True},
            {**base, "end_time": 123.0},
            {**base, "label": "car"},
            {**base, "box": None},
        ]
        self.assertEqual(frame_payload(["cam_test", "frame", 123.5, objects, [], []])["objects"], [])

    def test_same_observed_at_retained_across_newer_frames(self):
        person = {
            "id": "p1",
            "label": "person",
            "score": 0.95,
            "box": [10, 20, 100, 200],
            "false_positive": False,
            "frame_time": 123.4,
        }
        # First frame: frameTime = 123.45, observedAt = 123.4
        res1 = frame_payload(["cam_test", "frame", 123.45, [person], [], []])
        self.assertEqual(res1["objects"][0]["observedAt"], 123.4)

        # Subsequent frame: frameTime advances to 123.55, but person object still has observedAt = 123.4
        res2 = frame_payload(["cam_test", "frame", 123.55, [person], [], []])
        self.assertEqual(res2["frameTime"], 123.55)
        self.assertEqual(res2["objects"][0]["observedAt"], 123.4)

    def test_normalize_box_pixel_and_normalized(self):
        from bridge import normalize_box

        # Pixel coordinates on 1280x720
        box = [72, 128, 360, 640]  # ymin=72, xmin=128, ymax=360, xmax=640
        norm = normalize_box(box, 1280, 720)
        self.assertAlmostEqual(norm["x"], 0.1, places=2)
        self.assertAlmostEqual(norm["y"], 0.1, places=2)
        self.assertAlmostEqual(norm["width"], 0.4, places=2)
        self.assertAlmostEqual(norm["height"], 0.4, places=2)

        # Already normalized
        norm_box = [0.2, 0.3, 0.8, 0.9]
        res = normalize_box(norm_box, 1280, 720)
        self.assertAlmostEqual(res["x"], 0.3, places=2)
        self.assertAlmostEqual(res["y"], 0.2, places=2)
        self.assertAlmostEqual(res["width"], 0.6, places=2)
        self.assertAlmostEqual(res["height"], 0.6, places=2)

    def test_pose_envelope_pack_unpack_roundtrip(self):
        from bridge import build_pose_frame_header, pack_pose_frame_envelope, unpack_pose_frame_envelope

        people = [
            {"id": "track-1", "score": 0.9, "box": [10, 20, 100, 200], "observedAt": 123.4}
        ]
        header = build_pose_frame_header("cam_living_room", 123.5, people)
        self.assertEqual(header["schemaVersion"], 1)
        self.assertEqual(header["cameraSlug"], "cam_living_room")
        self.assertEqual(len(header["persons"]), 1)
        self.assertEqual(header["persons"][0]["trackId"], "track-1")

        fake_jpeg = b"\xff\xd8\xff\xd9"
        envelope = pack_pose_frame_envelope(header, fake_jpeg)
        self.assertGreater(len(envelope), 4)

        unpacked_header, unpacked_jpeg = unpack_pose_frame_envelope(envelope)
        self.assertEqual(unpacked_header["cameraSlug"], "cam_living_room")
        self.assertEqual(unpacked_jpeg, fake_jpeg)


if __name__ == "__main__":
    unittest.main()
