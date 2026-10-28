# US-18 fire/smoke runtime

The supplied trained YOLO26n model is an integration candidate. Training and the
user's offline evaluation already exist; this workflow integrates their artifact.
It does not retrain at startup. The original plan's YOLO11 decoder assumptions are
superseded by the verified YOLO26 head described in
[export status](US-18_YOLO26_EXPORT_STATUS.md).

## Stage the local model

The registered integration candidate now preserves the checkpoint prediction
mode and has passed its own local RTSP/browser gate. See the
[integration evidence](US-18_YOLO26_EXPORT_STATUS.md#checkpoint-model-integration) and historical
[mode comparison](US-18_YOLO26_EXPORT_STATUS.md#model-quality-and-known-limitations). Model-quality limitations remain
recorded; deployment flags stay disabled by default.

Use Python 3.11.13 with the shared runtime/dev hash lock. The local export
environment remains separate because Ultralytics requires a different OpenCV
distribution. No runtime dependency was added for training.

From the repository root:

```powershell
& artifacts/m3/runtime-dev/Scripts/python.exe services/ai-service/scripts/prepare_fire_model.py `
  --source artifacts/m3/exported/yolo26n-checkpoint-head-v1/fire-smoke-yolo26n.onnx
```

The script checks size/SHA-256 against `services/ai-service/model-manifest.json`
and stages `services/ai-service/models/fire-smoke-yolo26n-checkpoint-nms.onnx`
with its `.contract.json` sidecar. A different
existing model is rejected. Model binaries, videos, environments and local test
artifacts remain ignored by Git. On another machine, supply the same verified
ONNX as `--source`; the service never downloads weights on demand.

At runtime the detector additionally checks FP32 `[1,3,640,640]` input,
`[1,300,6]` output and `0=fire,1=smoke` metadata. Preprocessing uses RGB letterbox
padding 114; output restores normalized boxes to the full source image. This is
the checkpoint-preserving one-to-many graph with embedded class-aware NMS,
without extra objectness multiplication or a second runtime NMS.

The sidecar is required for embedded-NMS models and binds the graph checksum,
prediction mode and confidence floor. Keep `FIRE_OUTPUT_CONFIDENCE_FLOOR` at
least 0.10 and no higher than `FIRE_CONFIDENCE_THRESHOLD` (currently 0.50).
The loader rejects mismatches instead of silently dropping potentially qualifying
scores. The exporter writes this contract after successful parity verification.

For a deliberate rollback, preserve the current registry record and verify/stage
the recorded historical bytes:

```powershell
& artifacts/m3/runtime-dev/Scripts/python.exe services/ai-service/scripts/prepare_fire_model.py --source artifacts/m3/exported/yolo26n-cpu-v1/fire-smoke-yolo26n.onnx --artifact-version fire-smoke-yolo26n-v1
```

Then consistently configure AI and backend with `FIRE_MODEL_VERSION=fire-smoke-yolo26n-v1`,
`FIRE_MODEL_PATH=models/fire-smoke-yolo26n.onnx` and
`FIRE_MODEL_SHA256=1bd4ef98ef14f714b60474dd0bd87696bd0e4118efe1ae36c1a55c26bc92d6ed`.
Compose honors the configured model path; the old file is not overwritten by the
new staging operation. Do not change model identity in only one service.

## Runtime flow

1. Frigate bridge copies full camera frames independently of person detections.
2. Separate MQTT admission validates identity, dimensions, size and freshness.
   Queues keep at most two recent frames per camera; inference concurrency is bounded.
3. `/fire/detect` verifies the internal token and runs ONNX CPU inference. Technical
   model/decode/inference failures return HTTP 200 with a typed error; authentication,
   oversize and malformed requests use 401/413/422.
4. Three distinct, ordered qualifying frames within five seconds confirm an episode.
   Each adjacent gap must be at most one second. A negative, error or gap resets
   unconfirmed evidence. Mixed fire/smoke labels may qualify; boxes within one frame
   count once. `incidentConfidence` is the minimum of the per-frame maximum scores.
5. Backend revalidates evidence it actually observed, locks the enabled camera and
   atomically inserts a separate P0 fire event plus an immutable pending AI result.
   Existing AI result receipts/outbox/escalation handle notifications and SSE.
6. The exact confirming JPEG becomes the snapshot. A background worker obtains a
   camera recording clip around confirmation and retries unavailable recordings.
   UI shows normalized fire/smoke boxes, confidence and the three-frame evidence.

Repeated detections and application restarts reuse the DB active incident,
including after the user resolves the alert. Only ten continuous seconds of
fresh negative observations clear that detector latch. Silence and model errors
do not prove that the hazard has ended. Consumer restarts request fresh AI
evidence; lost/unusable responses rotate the AI evidence session and require a
fresh qualifying sequence. Duplicate callback delivery reuses the persisted result ID.

An upload failure cannot undo a committed incident. The media worker can recover
an uploaded snapshot whose DB record was lost; it cannot recreate the exact
confirmation image if those bytes were lost before upload. The UI reports missing
media and the recording clip remains independently recoverable.

## Isolated verification

For the physical webcam and existing room cameras, use
[main application acceptance](US-18_HUONG_DAN_NGHIEM_THU.md) with the local
`infra/dev/compose.us18-webcam.yml` override. The isolated checks below use
different databases/events and are not synchronized with earlier Telegram tests.

Docker Desktop must be running. These commands never load the application `.env`,
reset the application database, or send messages to external recipients.

```powershell
pnpm test:fire:db
pnpm test:fire:video "D:/studies/Hk1-Nam4/model/video/bucket11.mp4"
```

The DB gate applies the real migrations to disposable PostgreSQL and verifies
concurrent dedup, immutable pending payloads, receipt replay after a crash,
observed-negative rearming, disabled cameras and media reservations.

The video gate builds the pinned AI runtime and starts a separate Compose project
with Frigate 0.18, a Node 22 backend, MQTT, PostgreSQL and MinIO on loopback
ephemeral ports. AI, Frigate and the backend share the Docker kernel's clock.
A local raw video is read by Frigate's FFmpeg capture at real-time speed. Real MQTT, AI
HTTP, ONNX, storage, DB, receipts, outbox, escalation, event API and SSE service
are exercised. It checks three unique frames, one P0 event, exact JPEG checksum,
recording clip, a pending Telegram notification intent and dashboard confirmation.
External Telegram delivery is disabled. This harness imports the real FireModule
and its dependencies; it does not test unrelated M1/M2 runtime concurrency.

Reports, hashes, image identities and container logs are saved under
`artifacts/m3/evaluation/camerai-us18-video-<pid>/`; the runner removes only its own
Compose project/volumes afterward. It loops the input to allow service warmup;
looping one clip does not create independent quality samples. The file-input
Frigate check does not certify RTSP reconnection behavior.

For RTSP and actual browser interaction:

For operator-driven inspection, follow the
[runtime walkthrough below](#isolated-verification):

```powershell
pnpm test:fire:video "D:/studies/Hk1-Nam4/model/video/bucket11.mp4" --rtsp --manual-review
```

This mode defaults to a 20-minute review window and waits for an authoritative
dashboard confirmation by the isolated test user. It does not require an automated
browser driver or a synthetic completion marker. `--review-minutes 30` adjusts
the review window (1–60 minutes); the event's normal escalation deadline is unchanged.
The runner records the confirmation separately from the operator's visual checks,
then cleans up after the final action. Inspect and capture the page before confirming.

For the automated browser driver:

```powershell
pnpm test:fire:video "D:/studies/Hk1-Nam4/model/video/bucket11.mp4" --rtsp --review
```

This adds a digest-pinned MediaMTX publisher and the real Next.js app. RTSP input
plays once to avoid creating additional episodes during a long browser review.
The runner prints a report directory and loopback web URL after startup. It
creates an isolated test login in that directory's `browser-review.json`; these
credentials grant access only to disposable test data. Once evidence is ready,
the gate waits five minutes for the browser to confirm the exact incident.

The optional browser driver uses installed Google Chrome with a new temporary
profile. Its pinned QA package is installed only under ignored artifacts; it
does not modify the application dependency graph or lockfile:

```powershell
npm install --prefix artifacts/m3/browser-qa --save-exact playwright@1.64.1 --ignore-scripts --no-audit --no-fund
# In a second terminal, use the report directory printed by the running gate:
pnpm test:fire:browser "artifacts/m3/evaluation/camerai-us18-video-<pid>"
```

The browser driver logs in, selects the exact incident using its snapshot object
key, checks fire/smoke evidence, decodes/plays the clip, checks a 360 px viewport
and clicks the real confirmation or emergency-close button. The backend gate
then verifies the same event's terminal state. Screenshots and
`browser-result.json` remain for visual review; the browser driver must not
manufacture a completion marker for an unreviewed incident.

Clock diagnosis, after the video runner has built the local AI/backend images:

```powershell
pnpm test:fire:clock 30 "artifacts/m3/evaluation/clock-offset-new.json"
```

This measures Windows-to-Docker and same-kernel Node/Python offsets without
changing either system's time. The optional third argument (after duration and report path) selects
the backend image; the default is `camerai-us18-orchestrator:local`. Preserve the
existing future/age guards when diagnosing a mixed-runtime development setup.

For supplementary offline FIRESENSE flame-video screening, extract the user's
verified archive into `datasets/m3/evaluation/firesense-v1` with its `pos` and
`neg` directories, then run from `services/ai-service`:

```powershell
& ../../artifacts/m3/runtime-dev/Scripts/python.exe -m scripts.evaluate_fire_videos --input-dir ../../datasets/m3/evaluation/firesense-v1 --archive D:/studies/Hk1-Nam4/model/fire_videos.1406.zip --output-dir ../../artifacts/m3/evaluation/firesense-v1/new-screen
& ../../artifacts/m3/runtime-dev/Scripts/python.exe -m scripts.sweep_fire_thresholds --input-dir ../../artifacts/m3/evaluation/firesense-v1/new-screen --threshold 0.50 --threshold 0.60 --threshold 0.65 --threshold 0.70 --output ../../artifacts/m3/evaluation/firesense-v1/new-sweep.json
```

The first command checks the official archive MD5 and each clip's SHA-256 before
inference. Both commands refuse to overwrite their report destination. Saved
predictions have a confidence floor of 0.10; sweep thresholds cannot go below it.
These video-level diagnostics do not prove independent holdout status, event
onset latency or deployment FAR, and never change live thresholds. See
[27/10 findings](US-18_YOLO26_EXPORT_STATUS.md#model-quality-and-known-limitations) before interpreting them.

Additional KMU threshold validation:

The additional KMU comparison uses the frozen manifest
`services/ai-service/evaluation/manifests/kmu-2012-followup-v1.json`. The official
[KMU source page](https://cvpr.kmu.ac.kr/Dataset/Dataset.htm) grants free download
for academic research only. Download its flame and smoke/flame-like-object ZIPs
into `datasets/m3/evaluation/kmu-2012/archives`, naming them `flame.zip` and
`hard-negatives.zip`. Source archive SHA-256 values are pinned in the manifest;
video binaries are not distributed in Git.

Run from `services/ai-service`:

```powershell
& ../../artifacts/m3/runtime-dev/Scripts/python.exe -m scripts.prepare_kmu_manifest --manifest evaluation/manifests/kmu-2012-followup-v1.json --archives-dir ../../datasets/m3/evaluation/kmu-2012/archives
& ../../artifacts/m3/runtime-dev/Scripts/python.exe -m scripts.evaluate_fire_manifest --manifest evaluation/manifests/kmu-2012-followup-v1.json --output-dir ../../artifacts/m3/evaluation/kmu-2012/new-followup
```

Staging verifies archive and clip checksums and refuses to replace different
existing files. The evaluator requires both classes, unique clip identities,
matching source-folder labels and dataset paths confined to the repository.
Its baseline/candidate thresholds and temporal policy are fixed by the manifest
before inference; the run refuses a changed manifest or implementation. It
stores baseline predictions once and replays exactly the predeclared candidate,
without changing deployment configuration. The output directory must be new.

The manifest excludes three source sequences visually matched in available local
train/validation images. Partial pHash screening cannot prove complete training
independence. Video-level ratios, correlated scene groups, unavailable onset/box
ground truth and short negative exposure remain explicit limitations. This
offline recognition check does not run the deferred CPU/RAM soak.

The completed 27/10 comparison retains 0.50: fire-only confirmation was 18/19
at baseline versus 16/19 at 0.65, with 0/10 false-confirmed negatives at both.
See [the recorded results and limitations](US-18_YOLO26_EXPORT_STATUS.md#model-quality-and-known-limitations).
Do not treat this follow-up set as fresh calibration data after inspecting its
results or promote 0.65 based solely on the earlier FIRESENSE sweep.

Error review and checkpoint-mode comparison:

Saved-error review, from `services/ai-service` (use a new output directory):

```powershell
& ../../artifacts/m3/runtime-dev/Scripts/python.exe -m scripts.analyze_fire_errors --input-dir ../../artifacts/m3/evaluation/firesense-v1/baseline-050-20261027 --dataset-dir ../../datasets/m3/evaluation/firesense-v1 --output-dir ../../artifacts/m3/evaluation/new-fire-error-review
```

The analyzer uses saved predictions and source frames, with no new inference or
deployment change. It refuses missing/duplicate/out-of-order evidence and changed
source videos. Source candidates and suggested boxes require annotation review;
no YOLO training labels are automatically generated.

Separately exported checkpoint-preserving candidate evaluation:

```powershell
& ../../artifacts/m3/runtime-dev/Scripts/python.exe -m scripts.evaluate_fire_candidate --manifest evaluation/manifests/checkpoint-head-recheck-v1.json --export-report ../../artifacts/m3/exported/yolo26n-checkpoint-head-v1/export-report.json --model-version fire-smoke-yolo26n-checkpoint-nms-v1 --output-dir ../../artifacts/m3/evaluation/new-checkpoint-head-recheck
```

The frozen manifest binds the model, export report and videos. The evaluator
requires a successful checkpoint-preserving parity report, an embedded graph
floor covering saved predictions, unchanged implementation and unchanged source
bytes. This fixed 0.50 recheck does not stage the candidate or run the deferred
CPU/RAM soak. The inspected videos are not independent release holdout data.
The completed comparison improves fire confirmation from 27/30 to 29/30 but
increases false-confirmed negative videos from 5/26 to 7/26. After the user's
indoor-scope decision, this model was selected for integration and passed its own
[RTSP/Frigate/backend/browser gate](US-18_YOLO26_EXPORT_STATUS.md#checkpoint-model-integration). Its earlier
AI-route probe alone was not treated as that full-chain acceptance.

Offline commands that read `model-manifest.json` use the currently registered
model. Historical FIRESENSE/KMU threshold numbers apply to the earlier NMS-free
artifact and must not be attributed to a new export or rerun without checking
the recorded model hash.

Regular regression commands:

```powershell
pnpm --filter @cam/orchestrator test -- --runInBand
pnpm --filter @cam/web test
pnpm typecheck
pnpm lint
pnpm api:lint
pnpm test:tools
& artifacts/m3/runtime-dev/Scripts/python.exe -m pytest -c services/ai-service/pyproject.toml services/ai-service/tests
& artifacts/m3/runtime-dev/Scripts/python.exe -m unittest discover -s infra/frigate/frame-metadata -p "test_*.py"
```

## Runtime diagnostics and recovery verification

`GET /health` remains a liveness check. M3 diagnostics use separate authenticated
endpoints; they do not load a model, run a new inference or create an incident:

- AI: `GET /fire/health`, authenticated with `AI_INTERNAL_TOKEN`.
- Backend: `GET /api/v1/internal/fire/health`, authenticated with
  `INTERNAL_SERVICE_TOKEN`. A user JWT does not replace this token.

The backend response is `DISABLED`, `READY` or `DEGRADED`. `READY` requires MQTT
subscription, a successful enabled-camera database query, matching loaded AI
model readiness, and fresh successful processing for every listed enabled
camera. Unknown, never-observed cameras are `NO_FRAMES`; received but not yet
processed cameras are `STARTING`. A processing failure produces `ERROR`, and
silence after successful processing produces `STALE`. Capacity overflow makes
the overall status degraded instead of silently reporting a partial camera list.

`FIRE_HEALTH_STALE_SECONDS=5` controls diagnostic freshness. It does not relax the
one-second detector admission budget. Diagnostic ages use a monotonic clock;
capture and processing timestamps remain available for inspection. AI readiness
is `STARTING` before any successful inference, even while generic liveness is OK.

Per-camera counters and process totals record received/processed frames,
malformed messages, stale frames, queue/camera-capacity drops, processing errors
and validated confirmed episodes (`confirmedEpisodes`). A confirmed episode
counter is not an incident count: the durable camera latch can suppress another
AI confirmation after recovery. AI diagnostics additionally show model loading,
in-flight requests, errors/capacity rejections and the last request duration.
`lastErrorCode` is historical and is retained after recovery; use current status
and timestamps to assess readiness. Counters reset on process restart; each
response includes a new process `instanceId` so resets are distinguishable.

From the project root, with the application's existing `.env` configured:

```powershell
pnpm fire:health
pnpm fire:health --watch
```

The client reads the existing internal token without printing it.
`FIRE_HEALTH_URL` selects the backend diagnostics URL;
`FIRE_HEALTH_CLIENT_TIMEOUT_MS=10000` and `FIRE_HEALTH_POLL_MS=5000` control the
client. A single check exits 0 only for `READY`, 2 for disabled/degraded, or 1
when the request fails. No database write or notification is triggered.

The disposable recovery gate exercises actual process/network interruptions:

```powershell
pnpm test:fire:video "D:/studies/Hk1-Nam4/model/video/bucket11.mp4" --recovery
```

This mode is separate from `--review`. It derives a loop of source seconds
40–60, with both hashes and purpose recorded in `fire-loop.json`. Continuous
positive input avoids manufacturing a new episode from a clip's negative intro.
It is a stability fixture, not a new quality sample. No source video is modified.

The gate checks unauthenticated/wrong-token rejection, cold readiness, actual
malformed/stale MQTT admission counters, RTSP interruption, MQTT outage and
AI/Frigate/backend process restarts. Each outage is held at least 12 seconds;
silence must not clear the ten-second observed-negative latch. After recovery,
fresh three-frame confirmations must resume while the same event/result/payload
and one result receipt remain unchanged. Duplicate notification intents are
checked separately from legitimate escalation. The saved snapshot and clip are
downloaded again and verified against their SHA-256 values.

The runner discovers the backend's current host port after restart: Docker may
reassign loopback ephemeral ports when a stopped container starts again. This
affects the test client, not internal service-to-service URLs. Partial failures
retain logs and completed checkpoints; only the runner's own Compose project is
removed. Fault timings include the intentional outage hold and are not recovery
SLA measurements. `FIRE_RECOVERY_TIMEOUT_MS` (default 120000) and
`FIRE_RECOVERY_HOLD_MS` (default 12000, minimum 11000) configure the test runner.

These checks do not replace a 30–60 minute load/soak run on the local machine
(Docker containers plus host CPU/RAM), combined M1/M2/M3 load, or measurements on
the eventual deployment machine. No long load/soak run is implied by this gate.

## Opt-in live Telegram verification

The separately approved one-photo test is recorded in
[live Telegram verification](US-18_YOLO26_EXPORT_STATUS.md#main-webcam-and-telegram-acceptance). Its runner is
`tools/scripts/fire-telegram-gate.mjs`; it uses an isolated PostgreSQL/MinIO/MQTT/AI
stack and the real NotificationsModule. It requires an existing, verified private
chat association obtained through a read-only application lookup. Credentials and
the association live only in ignored private files, never Compose or public evidence.

The runner prepares an ngrok callback endpoint, checks for pre-existing queued
updates, preserves the webhook configuration and waits for a separate send-control
file. Create that file only for an explicitly authorized bot/chat and single photo.
The live wrapper counts the request before contacting Telegram, prevents retries
after an uncertain result, disables text fallback and scopes subsequent edits to
the returned message. Do not restart the test to resend a potentially delivered photo.

After Telegram accepts the photo, the user must press `Tôi ổn` on the message for
**US18 TEST bucket11**. Only a real Telegram webhook producing an authoritative
`TELEGRAM`/`IM_OK` confirmation, final `RESOLVED`, caption edit and callback answer
completes this check. Neither a synthetic callback nor dashboard confirmation is
a substitute. The test database alone uses a 600-second human-response window.

The runner removes only its named disposable project and private credential files,
stops its own ngrok process and restores the previous webhook URL/update settings
if changed. Check `cleanup.json`; a `webhook-restore-required.json` file requires
restoration before another bot operation. Preserve the application database volume.
This focused Telegram test replays source JPEGs and does not repeat the separate
RTSP/Frigate/recording/browser gate.

## Enable and observe

All new settings are documented in `.env.example`. Both admission flags default
to false. After staging the verified candidate and accepting the deployment run,
set `M3_ENABLED=true`, `FRIGATE_FIRE_FRAMES_ENABLED=true` and the registered
`FIRE_MODEL_SHA256` in the deployment environment. Keep the model version,
threshold/window/gap/clear settings equal in AI and orchestrator. Restart those
services after changing a model or rule so partial evidence cannot span versions.
Synchronize host/container clocks: the default future tolerance is 500 ms, and
frames must remain within the one-second age budget through processing.
Recreate Frigate when bridge/service mounts change.

Apply repository migrations normally before starting this implementation; it uses
existing migration `0014_fire_incidents.sql` and does not rewrite historical SQL.
Look for `Fire episode confirmed` in AI logs, `Fire incident persisted` in backend
logs, `delivery_status=APPLIED` in `fire_incidents`, and existing escalation/outbox
history. Never log frames, request tokens or RTSP credentials.

For rollback, turn both admission flags off and restart the affected services.
Keep the durable delivery/outbox/escalation workers running to drain committed
work. Preserve incidents and user confirmations. Disabling detection or resolving
an alert does not manufacture negative evidence or rearm a still-active hazard.

## Remaining release acceptance

An implementation/integration pass is separate from the full release gate:
verify dataset distribution permissions and train/calibration/holdout independence;
run smoke-only, mixed, fire, hard-negative and long negative videos; record event
precision/recall/FAR and latency/load with M1/M2 active; validate RTSP and restarts
in the target deployment; repeat UI checks when behavior changes. The local
RTSP/browser gate and real Telegram photo delivery plus `Tôi ổn` confirmation
already passed. Target deployment remains separate; repeat external-delivery
checks if the bot, linked recipient or webhook configuration changes.
Keep unmeasured results explicit. No repeat training is required just
because these system checks are pending.

Pinned Frigate interfaces: [frame manager](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/util/image.py),
[service working directory](https://github.com/blakeblackshear/frigate/blob/v0.18.0/docker/main/rootfs/etc/s6-overlay/s6-rc.d/frigate/run),
and [camera recording API](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/api/media.py).
