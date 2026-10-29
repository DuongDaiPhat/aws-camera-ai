"""Full-frame transport works without persons and never owns Frigate segments."""

import json
import struct
import time
import unittest
from threading import Event
from unittest.mock import Mock

import cv2
import numpy as np
from fire_publisher import FireFramePublisher, FirePublisherSettings


class FirePublisherTests(unittest.TestCase):
    def test_empty_person_frame_publishes_matching_jpeg_identity(self) -> None:
        bgr = np.zeros((48, 64, 3), dtype=np.uint8)
        yuv = cv2.cvtColor(bgr, cv2.COLOR_BGR2YUV_I420)
        manager = Mock()
        manager.get.return_value = yuv
        published = Event()
        client = Mock()
        client.publish.side_effect = lambda *_args, **_kwargs: published.set()
        publisher = FireFramePublisher(
            FirePublisherSettings(enabled=True),
            {"camera": {"detect": {"width": 64, "height": 48}}},
            manager,
            client,
        )
        try:
            timestamp = time.time()
            publisher.enqueue(["camera", "shared-frame-1", timestamp, [], [], []])
            self.assertTrue(published.wait(2))
            args, kwargs = client.publish.call_args
            envelope = args[1]
            header_size = struct.unpack(">I", envelope[:4])[0]
            header = json.loads(envelope[4 : 4 + header_size])
            image = cv2.imdecode(
                np.frombuffer(envelope[4 + header_size :], np.uint8), cv2.IMREAD_COLOR
            )
            self.assertEqual(header["cameraSlug"], "camera")
            self.assertEqual((header["frameWidth"], header["frameHeight"]), (64, 48))
            self.assertEqual(image.shape, (48, 64, 3))
            self.assertEqual(kwargs, {"qos": 0, "retain": False})
            manager.close.assert_called_once_with("shared-frame-1")
            manager.delete.assert_not_called()
            manager.cleanup.assert_not_called()
        finally:
            publisher.close()

    def test_disabled_publisher_never_touches_shared_memory(self) -> None:
        manager = Mock()
        publisher = FireFramePublisher(FirePublisherSettings(), {}, manager, Mock())
        publisher.enqueue(["camera", "frame", time.time(), [], [], []])
        manager.get.assert_not_called()
        publisher.close()

    def test_expired_owner_segment_does_not_break_metadata_loop(self) -> None:
        manager = Mock()
        manager.get.side_effect = FileNotFoundError("Owner retired this frame")
        client = Mock()
        publisher = FireFramePublisher(
            FirePublisherSettings(enabled=True),
            {"camera": {"detect": {"width": 64, "height": 48}}},
            manager,
            client,
        )
        try:
            publisher.enqueue(["camera", "old-frame", time.time(), [], [], []])
            manager.close.assert_called_once_with("old-frame")
            client.publish.assert_not_called()
        finally:
            publisher.close()


if __name__ == "__main__":
    unittest.main()
