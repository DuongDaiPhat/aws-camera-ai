"""Frigate 0.18 per-frame metadata only; never copies or encodes video."""

import json
import os
import signal
import time


MAX_OBJECT_AGE_SECONDS = float(os.getenv("FRIGATE_FRAME_OBJECT_MAX_AGE_SECONDS", "0.25"))


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
    if age < 0 or age > max_age:
        return False
    return True


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
                if time.time() - result["frameTime"] > 1:
                    continue
                client.publish(
                    os.getenv("MQTT_TOPIC_CAMERA_FRAMES", "frigate/camerai/frames"),
                    json.dumps(result, separators=(",", ":")), qos=0, retain=False,
                )
            except (ValueError, TypeError, KeyError):
                print("Invalid Frigate frame metadata skipped", flush=True)
    finally:
        socket.close(linger=0)
        context.term()
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
