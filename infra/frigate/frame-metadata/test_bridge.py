import unittest

from bridge import frame_payload


class FramePayloadTest(unittest.TestCase):
    def test_publishes_current_person_box_and_frame_timestamp(self):
        person = {"id": "p1", "label": "person", "score": 0.95,
                  "box": [10, 20, 100, 200], "false_positive": False}
        result = frame_payload(["cam_test", "frame", 123.5, [person], [], []])
        self.assertEqual(result, {"camera": "cam_test", "frameTime": 123.5, "objects": [
            {"id": "p1", "label": "person", "score": 0.95, "box": [10, 20, 100, 200]}
        ]})

    def test_empty_frame_clears_boxes_instead_of_replaying_event_snapshot(self):
        base = {"id": "p1", "label": "person", "score": 0.9,
                "box": [1, 2, 3, 4], "false_positive": False}
        objects = [{**base, "false_positive": True}, {**base, "end_time": 120},
                   {**base, "label": "car"}]
        self.assertEqual(frame_payload(["cam_test", "frame", 123, objects, [], []])["objects"], [])


if __name__ == "__main__":
    unittest.main()
