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


if __name__ == "__main__":
    unittest.main()
