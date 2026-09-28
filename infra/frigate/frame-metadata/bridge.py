"""Frigate 0.18 per-frame metadata only; never copies or encodes video."""

import json
import os
import signal
import time


def frame_payload(payload):
    camera, _name, frame_time, objects, _motion, _regions = payload
    people = [
        {"id": obj["id"], "label": "person", "score": obj["score"], "box": obj["box"]}
        for obj in objects
        if obj.get("label") == "person"
        and not obj.get("false_positive", True)
        and obj.get("end_time") is None
        and obj.get("box") is not None
    ]
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
