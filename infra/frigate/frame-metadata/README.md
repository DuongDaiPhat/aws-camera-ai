# Person box metadata (Frigate 0.18)

The live player continues to use the original MediaMTX WebRTC stream. This
service subscribes to Frigate's internal `detection/video` messages and publishes
only confirmed person coordinates and their frame timestamps to MQTT. It does
not decode, resize, re-encode, or delay video.

Flow: Frigate frame processing → ZeroMQ → `frigate/camerai/frames` → the
orchestrator's bounded memory buffer → authenticated camera debug API → SVG box.
Frame messages bypass event persistence and snapshot downloads. The web client
polls every 80 ms with at most one request in flight and matches people by track
ID. Display state persists across polls; each detector frame is processed once.
Small alternating position noise and changing box sizes are filtered using
frame timestamps. Sustained movement follows quickly, and large movement is
applied immediately. Boxes do not extrapolate between observations: this avoids
the old predicted-position jump followed by a snap back on each new sample.

A missing person is held for at most 250 ms to bridge a short missed detection.
Stale person objects whose detection `frame_time` is older than `FRIGATE_FRAME_OBJECT_MAX_AGE_SECONDS` (default: 0.25s) are filtered out at the bridge level to prevent ghost boxes when a person moves away.
A transport interruption expires the whole overlay after 750 ms. Disabling the
overlay or switching cameras clears display state immediately. These short holds
avoid blinking without keeping stale boxes around for seconds.

This mode prioritizes low live latency. It reduces metadata lag but cannot
guarantee pixel-perfect synchronization during an abrupt turn: the video and
detector remain separate pipelines. Detection FPS limits how quickly a new
direction can be measured. Increasing detection FPS does not change live video
resolution or encoding.

The service is mounted through Docker Compose's Frigate s6 configuration.
Changing these mounts requires `docker compose up -d --no-deps frigate`.
`MQTT_TOPIC_CAMERA_FRAMES` must match in Frigate and the orchestrator.
Check the Frigate log for `CameraAI frame metadata bridge ready` and verify that
`detectionFrames` timestamps advance in `/api/v1/cameras/{id}/debug-stream`.
That endpoint still requires a normal access token.

The bridge depends on Frigate 0.18's internal message tuple and topic. Recheck
them before upgrading the pinned Frigate image. Run its payload tests with:

```powershell
python -m unittest discover -s infra/frigate/frame-metadata -p test_bridge.py
```
