"""Publish metadata immediately; encode timestamp-bound pose frames on a bounded worker."""

import json
import logging
import math
import os
import queue
import signal
import threading
import time
import uuid
from contextlib import suppress

MAX_OBJECT_AGE_SECONDS = float(os.getenv("FRIGATE_FRAME_OBJECT_MAX_AGE_SECONDS", "0.25"))
FRIGATE_POSE_FRAMES_ENABLED = os.getenv("FRIGATE_POSE_FRAMES_ENABLED", "false").lower() in (
    "true",
    "1",
)
MQTT_TOPIC_POSE_FRAMES = os.getenv("MQTT_TOPIC_POSE_FRAMES", "frigate/camerai/pose/frames")
MAX_POSE_FPS = float(os.getenv("FRIGATE_POSE_MAX_FPS", "5.0"))
POSE_SAMPLING_JITTER_RATIO = 0.1
MAX_ENVELOPE_BYTES = 1024 * 1024  # 1 MiB
MAX_HEADER_BYTES = 32 * 1024  # 32 KiB


def normalize_box(box: list[float], frame_w: int = 1280, frame_h: int = 720) -> dict[str, float]:
    """Chuyen doi Frigate box [ymin, xmin, ymax, xmax] sang NormalizedBox."""
    if not box or len(box) < 4:
        return {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
    ymin, xmin, ymax, xmax = box[:4]
    # Neu da la he toa do chuan hoa [0, 1]
    if all(0.0 <= v <= 1.0 for v in [ymin, xmin, ymax, xmax]):
        x = xmin
        y = ymin
        w = max(0.0, xmax - xmin)
        h = max(0.0, ymax - ymin)
    else:
        fw = float(frame_w) if frame_w > 0 else 1280.0
        fh = float(frame_h) if frame_h > 0 else 720.0
        x = float(xmin) / fw
        y = float(ymin) / fh
        w = float(xmax - xmin) / fw
        h = float(ymax - ymin) / fh
    x = max(0.0, min(1.0, x))
    y = max(0.0, min(1.0, y))
    w = max(0.0, min(1.0 - x, w))
    h = max(0.0, min(1.0 - y, h))
    return {"x": round(x, 4), "y": round(y, 4), "width": round(w, 4), "height": round(h, 4)}


def pack_pose_frame_envelope(header: dict, jpeg_bytes: bytes) -> bytes:
    """Dong goi binary envelope v1: [4 bytes big-endian length] + [JSON header] + [JPEG payload]."""
    import struct

    header_json = json.dumps(header, separators=(",", ":")).encode("utf-8")
    if len(header_json) > MAX_HEADER_BYTES:
        raise ValueError(f"Header vượt quá {MAX_HEADER_BYTES} bytes")
    envelope = struct.pack(">I", len(header_json)) + header_json + jpeg_bytes
    if len(envelope) > MAX_ENVELOPE_BYTES:
        raise ValueError(f"Envelope vượt quá {MAX_ENVELOPE_BYTES} bytes")
    return envelope


def unpack_pose_frame_envelope(data: bytes) -> tuple[dict, bytes]:
    """Giai ma binary envelope v1."""
    import struct

    if len(data) < 4:
        raise ValueError("Du lieu qua ngan cho envelope")
    header_len = struct.unpack(">I", data[:4])[0]
    if 4 + header_len > len(data):
        raise ValueError("Header envelope bi cat xen")
    header = json.loads(data[4 : 4 + header_len].decode("utf-8"))
    jpeg_bytes = data[4 + header_len :]
    return header, jpeg_bytes


def build_pose_frame_header(
    camera: str,
    frame_time: float,
    people: list[dict],
    frame_w: int = 1280,
    frame_h: int = 720,
    source_session_id: str = "default",
) -> dict:
    """Tao header JSON cho pose frame envelope."""
    persons = []
    for p in people[:8]:  # Gioi han toi da 8 persons/frame
        persons.append(
            {
                "trackId": str(p["id"]),
                "boundingBox": normalize_box(p["box"], frame_w, frame_h),
                "observedAt": p["observedAt"],
            }
        )
    return {
        "schemaVersion": 1,
        "sourceSessionId": source_session_id,
        "frameId": f"{camera}_{int(frame_time * 1000)}",
        "cameraSlug": camera,
        "frameTimestamp": frame_time,
        "frameWidth": frame_w,
        "frameHeight": frame_h,
        "persons": persons,
    }


def is_valid_person(obj, frame_time, max_age=MAX_OBJECT_AGE_SECONDS):
    if obj.get("label") != "person":
        return False
    if obj.get("false_positive", True):
        return False
    if obj.get("end_time") is not None:
        return False
    if obj.get("box") is None:
        return False
    obj_frame_time = obj.get("frame_time")
    if obj_frame_time is None or not isinstance(obj_frame_time, (int, float)):
        return False
    age = frame_time - obj_frame_time
    return 0 <= age <= max_age


def frame_payload(payload, max_age=MAX_OBJECT_AGE_SECONDS):
    camera, _name, frame_time, objects, _motion, _regions = payload
    people = []
    for obj in objects:
        if is_valid_person(obj, frame_time, max_age):
            obs_time = obj["frame_time"]
            people.append(
                {
                    "id": obj["id"],
                    "label": "person",
                    "score": obj["score"],
                    "box": obj["box"],
                    "observedAt": obs_time,
                }
            )
            print(
                f"[PERSON_DEBUG][BRIDGE] camera={camera} objectId={obj['id']} "
                f"frameTime={frame_time:.3f} observedAt={obs_time:.3f} "
                f"ageMs={(frame_time - obs_time) * 1000:.1f} box={obj['box']} action=PUBLISH",
                flush=True,
            )
        elif obj.get("label") == "person":
            obj_time = obj.get("frame_time")
            age_ms = (frame_time - obj_time) * 1000 if isinstance(obj_time, (int, float)) else -1
            print(
                f"[PERSON_DEBUG][BRIDGE] camera={camera} objectId={obj.get('id')} "
                f"frameTime={frame_time:.3f} observedAt={obj_time} "
                f"ageMs={age_ms:.1f} box={obj.get('box')} action=DROP",
                flush=True,
            )
    return {"camera": camera, "frameTime": frame_time, "objects": people}


def read_timestamped_frame(frame_manager, frame_name, width, height):
    """Frigate 0.18 detection/video names the exact I420 shared-memory buffer.

    Never substitute a newer frame when the named segment has already expired.
    close() releases our reference only; cleanup()/delete() would unlink Frigate's data.
    """
    if width <= 0 or height <= 0 or width % 2 or height % 2:
        return None
    try:
        frame = frame_manager.get(frame_name, (height * 3 // 2, width))
        return frame.copy() if frame is not None else None
    finally:
        frame_manager.close(frame_name)


class PoseFramePublisher:
    """One encoding worker with a two-frame queue; overload drops old work."""

    def __init__(self, client):
        self.client = client
        self.session_id = str(uuid.uuid4())
        self.queue = queue.Queue(maxsize=2)
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True, name="pose-encoder")

    def start(self):
        self.thread.start()

    def offer(self, metadata, frame, frame_name):
        packet = (metadata, frame, frame_name)
        try:
            self.queue.put_nowait(packet)
        except queue.Full:
            with suppress(queue.Empty):
                self.queue.get_nowait()
            try:
                self.queue.put_nowait(packet)
            except queue.Full:
                logging.debug("Pose queue full; frame dropped")

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=2)

    def _run(self):
        import cv2

        while not self.stopped.is_set():
            try:
                metadata, frame, frame_name = self.queue.get(timeout=0.2)
            except queue.Empty:
                continue
            age = time.time() - metadata["frameTime"]
            if age > 1.0 or age < -0.5:
                continue
            try:
                image = cv2.cvtColor(frame, cv2.COLOR_YUV2BGR_I420)
                height, width = image.shape[:2]
                # Frigate emits xyxy boxes; legacy normalize_box expects yxyx.
                people = [
                    {**p, "box": [p["box"][1], p["box"][0], p["box"][3], p["box"][2]]}
                    for p in metadata["objects"]
                ]
                header = build_pose_frame_header(
                    metadata["camera"],
                    metadata["frameTime"],
                    people,
                    width,
                    height,
                    self.session_id,
                )
                header["frameId"] = f"{frame_name}:{metadata['frameTime']}"
                ok, jpeg = cv2.imencode(".jpg", image)
                if not ok:
                    logging.warning("Pose JPEG encode failed")
                    continue
                if time.time() - metadata["frameTime"] > 1.0:
                    continue
                self.client.publish(
                    MQTT_TOPIC_POSE_FRAMES,
                    pack_pose_frame_envelope(header, jpeg.tobytes()),
                    qos=0,
                    retain=False,
                )
            except (ValueError, KeyError, OSError, cv2.error):
                logging.exception("Pose encode/publish failed")


def offer_pose_capture(publisher, frame_manager, config, metadata, frame_name, next_pose_time):
    """Copy only sampled named frames; metadata publication never waits for encoding."""
    if not metadata.get("objects"):
        return
    camera = metadata["camera"]
    frame_time = metadata["frameTime"]
    min_interval = 1.0 / MAX_POSE_FPS if MAX_POSE_FPS > 0 else 0.2
    # Preserve the sampling phase: resetting it to every accepted timestamp halves
    # a nominal 5 Hz stream whenever a capture interval is just below 200 ms.
    deadline = next_pose_time.get(camera, frame_time)
    if frame_time + min_interval * POSE_SAMPLING_JITTER_RATIO < deadline:
        return
    detect = {
        **config.get("detect", {}),
        **config.get("cameras", {}).get(camera, {}).get("detect", {}),
    }
    width, height = detect.get("width"), detect.get("height")
    if not isinstance(width, int) or not isinstance(height, int):
        logging.warning("Pose frame skipped: unknown detect shape for %s", camera)
        return
    frame = read_timestamped_frame(frame_manager, frame_name, width, height)
    if frame is not None:
        publisher.offer(metadata, frame, frame_name)
        elapsed_periods = max(1, math.floor((frame_time - deadline) / min_interval) + 1)
        next_pose_time[camera] = deadline + elapsed_periods * min_interval


def main():
    import paho.mqtt.client as mqtt
    import yaml
    import zmq

    with open("/config/config.yml", encoding="utf-8") as config_file:
        full_config = yaml.safe_load(os.path.expandvars(config_file.read()))
        config = full_config["mqtt"]
    client = mqtt.Client(client_id="camerai-frame-metadata")
    if config.get("user"):
        client.username_pw_set(config["user"], config.get("password"))
    client.max_queued_messages_set(2)
    client.connect(config["host"], config.get("port", 1883))
    client.loop_start()
    frame_manager = None
    pose_publisher = None
    if FRIGATE_POSE_FRAMES_ENABLED:
        from frigate.util.image import SharedMemoryFrameManager

        frame_manager = SharedMemoryFrameManager()
        pose_publisher = PoseFramePublisher(client)
        pose_publisher.start()
    context = zmq.Context()
    socket = context.socket(zmq.SUB)
    socket.setsockopt(zmq.RCVHWM, 32)
    socket.setsockopt_string(zmq.SUBSCRIBE, "detection/video ")
    socket.connect("ipc:///tmp/cache/proxy_sub")
    running = True

    def stop(_signum, _frame):
        nonlocal running
        running = False

    next_pose_time = {}
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print("CameraAI frame metadata bridge ready (Frigate 0.18)", flush=True)
    try:
        while running:
            if not socket.poll(500):
                continue
            try:
                message = socket.recv_string().split(" ", 1)[1]
                raw_payload = json.loads(message)
                result = frame_payload(raw_payload)
                frame_time = result["frameTime"]
                if time.time() - frame_time > 1:
                    continue
                client.publish(
                    os.getenv("MQTT_TOPIC_CAMERA_FRAMES", "frigate/camerai/frames"),
                    json.dumps(result, separators=(",", ":")),
                    qos=0,
                    retain=False,
                )

                if pose_publisher:
                    offer_pose_capture(
                        pose_publisher,
                        frame_manager,
                        full_config,
                        result,
                        raw_payload[1],
                        next_pose_time,
                    )
            except (ValueError, TypeError, KeyError):
                print("Invalid Frigate frame metadata skipped", flush=True)
    finally:
        if pose_publisher:
            pose_publisher.close()
        socket.close(linger=0)
        context.term()
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
