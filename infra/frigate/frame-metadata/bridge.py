"""Frigate 0.18 per-frame metadata only; never copies or encodes video."""

import json
import os
import signal
import time

MAX_OBJECT_AGE_SECONDS = float(
    os.getenv("FRIGATE_FRAME_OBJECT_MAX_AGE_SECONDS", "30.0")
)
FRIGATE_POSE_FRAMES_ENABLED = os.getenv("FRIGATE_POSE_FRAMES_ENABLED", "false").lower() in ("true", "1")
MQTT_TOPIC_POSE_FRAMES = os.getenv("MQTT_TOPIC_POSE_FRAMES", "frigate/camerai/pose/frames")
MAX_POSE_FPS = float(os.getenv("FRIGATE_POSE_MAX_FPS", "5.0"))
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
    # Nguoi bat dong (stationary) van la nguoi hop le dang co mat trong khung hinh (US-16, US-17)
    if obj.get("stationary", False) or obj.get("motionless_count", 0) > 0:
        return True
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
                    "isMoving": obj.get("motionless_count") == 0
                    and obj.get("stationary") is False,
                    "sourceSessionId": f"{camera}:{float(obj['start_time']):.6f}"
                    if isinstance(obj.get("start_time"), (int, float))
                    else None,
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
            age_ms = (
                (frame_time - obj_time) * 1000
                if isinstance(obj_time, (int, float))
                else -1
            )
            print(
                f"[PERSON_DEBUG][BRIDGE] camera={camera} objectId={obj.get('id')} "
                f"frameTime={frame_time:.3f} observedAt={obj_time} "
                f"ageMs={age_ms:.1f} box={obj.get('box')} action=DROP",
                flush=True,
            )
    return {"camera": camera, "frameTime": frame_time, "objects": people}


def main():
    import paho.mqtt.client as mqtt
    import yaml
    import zmq

    with open("/config/config.yml", encoding="utf-8") as config_file:
        config = yaml.safe_load(os.path.expandvars(config_file.read()))["mqtt"]
    client = mqtt.Client(client_id="camerai-frame-metadata")
    if config.get("user"):
        client.username_pw_set(config["user"], config.get("password"))
    client.max_queued_messages_set(2)
    client.connect(config["host"], config.get("port", 1883))
    client.loop_start()
    context = zmq.Context()
    socket = context.socket(zmq.SUB)
    socket.setsockopt(zmq.RCVHWM, 32)
    socket.setsockopt_string(zmq.SUBSCRIBE, "detection/video ")
    socket.connect("ipc:///tmp/cache/proxy_sub")
    running = True

    def stop(_signum, _frame):
        nonlocal running
        running = False

    last_pose_time = {}
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print("CameraAI frame metadata bridge ready (Frigate 0.18)", flush=True)
    try:
        while running:
            if not socket.poll(500):
                continue
            try:
                message = socket.recv_string().split(" ", 1)[1]
                result = frame_payload(json.loads(message))
                frame_time = result["frameTime"]
                if time.time() - frame_time > 1:
                    continue
                client.publish(
                    os.getenv("MQTT_TOPIC_CAMERA_FRAMES", "frigate/camerai/frames"),
                    json.dumps(result, separators=(",", ":")),
                    qos=0,
                    retain=False,
                )

                # M2a Pose Frames Publisher (US-16)
                if FRIGATE_POSE_FRAMES_ENABLED and result.get("objects"):
                    camera = result["camera"]
                    min_interval = 1.0 / MAX_POSE_FPS if MAX_POSE_FPS > 0 else 0.2
                    if frame_time - last_pose_time.get(camera, 0.0) >= min_interval:
                        header = build_pose_frame_header(camera, frame_time, result["objects"])
                        # Doc frame anh thuc te tu Frigate local HTTP API
                        jpeg_bytes = b""
                        try:
                            import urllib.request
                            with urllib.request.urlopen(
                                f"http://127.0.0.1:5000/api/{camera}/latest.jpg", timeout=0.5
                            ) as resp:
                                jpeg_bytes = resp.read()
                        except Exception as fetch_err:
                            pass

                        if not jpeg_bytes:
                            continue
                        try:
                            envelope = pack_pose_frame_envelope(header, jpeg_bytes)
                            client.publish(MQTT_TOPIC_POSE_FRAMES, envelope, qos=0, retain=False)
                            last_pose_time[camera] = frame_time
                        except (ValueError, OSError) as e:
                            print(f"[POSE_FRAME_ERROR] Failed to pack/publish envelope: {e}", flush=True)
            except (ValueError, TypeError, KeyError):
                print("Invalid Frigate frame metadata skipped", flush=True)
    finally:
        socket.close(linger=0)
        context.term()
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
