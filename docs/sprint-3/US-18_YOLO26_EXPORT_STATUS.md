# US-18: model, integration and acceptance status

> Fire-only scope update, 29/10/2026: per lead direction, US-18 now detects and alerts on fire only. Class 1 smoke from the existing verified two-class checkpoint is discarded before scoring, temporal confirmation, evidence rendering and notification. Three consecutive fire frames are still required; smoke-only input is negative and cannot bridge fire frames. New evidence uses `fire-only-temporal-min-v1`. The model artifact name/checksum and legacy `FIRE_SMOKE_DETECTED` storage identifier remain for compatibility; all current web/Telegram labels say fire. Historical smoke metrics and mixed-class acceptance below are superseded for the active feature. Existing records are retained, not relabeled as newly verified fire.

Consolidated on **28/10/2026**. Historical export measurements are retained below;
the current model, quality limits, webcam/Telegram results and UI verification are
summarized in the final sections. Operator steps are in the
[manual acceptance guide](US-18_HUONG_DAN_NGHIEM_THU.md).

Verified locally on **26/10/2026**. Scope: the user-supplied checkpoint's Windows
CPU export environment, model loading, ONNX validity, local-image parity and a
small inference timing check, followed by the runtime integration below.
**Local RTSP and browser integration passed on 27/10/2026; full G2/G5 release acceptance remains incomplete.**

## Current priority after the user's indoor-scope decision

On 27/10, the user clarified that the project targets indoor cameras and accepts
the observed limitations as non-blocking for the next integration step. Broad
dataset expansion and fine-tuning are therefore deferred. The TV-content false
confirmation remains an indoor-relevant known limitation; no indoor deployment
false-alarm rate or complete G2/G5 acceptance is inferred from this decision.

**Steps 1 and 2 are complete locally:** the registry, staged model, AI/backend
defaults, `.env.example` and Compose now select
`fire-smoke-yolo26n-checkpoint-nms-v1` at threshold 0.50. Its checksum-bound graph
contract guards the embedded 0.10 confidence floor. The exact new artifact passed
RTSP/Frigate/AI/backend/P0/media/dashboard and real browser confirmation in
`camerai-us18-video-25468`: one P0, three frames spanning 591 ms, confidence
0.7888656, playable clip and final `RESOLVED`. The old artifact remains available
for rollback. See [the current integration evidence](#checkpoint-model-integration).

The user approved one alert to the existing linked private chat of
`@camerai_test_bot`. Telegram accepted the photo for **US18 TEST bucket11** in
`camerai-us18-telegram-24628`; the real `Tôi ổn` callback produced `TELEGRAM` /
`IM_OK`, final `RESOLVED`, a caption edit and callback acknowledgment. See the
[live Telegram evidence](#main-webcam-and-telegram-acceptance). Hosted CI/reviewer/
release checks remain open. The long local CPU/RAM soak stays deferred. The
application `.env` was not edited and admission flags remain disabled by default.

The user reported missing fire highlighting and inaccessible playback. The
[fire alert UX follow-up](#fire-alert-ux-and-evidence) now records repaired detail/media
recovery, snapshot/video controls, prominent red cards, mandatory P0 review and
the moderate manual 114 link. The follow-up makes attention fit without scrolling,
requires a detection less than three hours old, and persists one display per
camera/time episode across reload and escalation. The worker paints a separate
Telegram delivery image. In a subsequently authorized bounded main-webcam test,
the provider accepted the new 20:28 photo and the operator confirmed seeing its
red flame rectangle. Previously sent photos remain unchanged. Main-web MP4
playback also passed.
An isolated raw-video walkthrough is available through `--manual-review`, with a
configurable 20-minute default window and verification of an actual dashboard
confirmation; commands are in the [runbook](US-18_RUNTIME_RUNBOOK.md).
For the existing application and webcam, use the
[operator guide](US-18_HUONG_DAN_NGHIEM_THU.md). Visual acceptance is separate from
automated browser evidence.

The user subsequently required acceptance through the existing room cameras and
a real webcam. The isolated 23944 session was cancelled; it was not an operator
acceptance pass. The main application now runs on `http://localhost:3000`, reusing
the original cameras/account after a private backup and normal additive migrations.
The operator published the physical webcam; M3 processed 217 frames with no errors
at the first check, with `cam_test` and AI `READY`. The user also authorized a new
bounded Telegram session against the same main backend. Physical webcam fire
detection and real same-event Telegram/web confirmation subsequently passed:
event `fa0c194a-c5b4-4a91-a2bc-8a4b8fd2e826`, three frames over 600 ms,
authoritative `TELEGRAM` / `IM_OK` after 19.64 seconds, final `RESOLVED`, webhook
and caption work processed, with the operator reporting the web's safe state.
An earlier test episode expired unconfirmed and was subsequently closed by the operator.
The Telegram session ended with sending disabled and application data retained. See
[main webcam acceptance](#main-webcam-and-telegram-acceptance). This local override
enables M3 for acceptance; deployment defaults and `.env` remain unchanged.

## Recorded verification

Earlier quality follow-up: [fire error and checkpoint-mode analysis](#model-quality-and-known-limitations).
The tiling probe increased false alarms and is not adopted. The exporter now
preserves the loaded checkpoint prediction mode by default. A separate export
passed eight-image parity, all 56-video checks and a bounded real-ONNX AI-route
probe on raw `bucket11.mp4`. At 0.50 it confirms **29/30 fire videos versus 27/30**,
but falsely confirms **7/26 negatives versus 5/26**. Improved recall does not
close quality acceptance. After the user's indoor-scope decision, that export
was selected for local integration and passed its own full-chain gate above.
No new training was performed.

Latest quality follow-up: [additional KMU threshold validation](#model-quality-and-known-limitations)
completed on 29 videos, after excluding three source sequences matched in the
available train/validation images. Fire-only confirmation is **18/19 at 0.50**
versus **16/19 at 0.65**, with **0/10 false-confirmed negative videos** at either
threshold. Keep **0.50**: the earlier exploratory 0.65 candidate loses two more
fire videos on this set. This does not close the remaining quality gate.

The earlier [27-video FIRESENSE screening, clock diagnosis and RTSP/browser
evidence](#model-quality-and-known-limitations) remain recorded, including unresolved
fire misses and false confirmations. The subsequent Telegram delivery is recorded
above, including successful real callback verification. The user deferred the 30–60 minute
local CPU/RAM soak on 27/10/2026; it remains deferred after this recognition check.

Runtime follow-up on 27/10: **local recovery and M3 diagnostics are now verified**.
The disposable `camerai-us18-video-18880` run passed RTSP/MQTT interruption and
AI/Frigate/backend process restarts, retained one incident/result without duplicate
notification intents, and downloaded both media objects with matching SHA-256.
Use `pnpm fire:health --watch` for authenticated runtime diagnostics; see the
[runbook](US-18_RUNTIME_RUNBOOK.md#runtime-diagnostics-and-recovery-verification).

| Follow-up step                                        | Current status                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Clock diagnosis / container-aligned runtime           | Complete locally; mixed host/container clocks still need verification                               |
| Fire-positive / negative screening                    | 27 clips processed; misses and false confirmations remain                                           |
| Additional predefined 0.50 / 0.65 comparison          | 29 KMU clips processed; retain 0.50 because 0.65 misses two additional fire videos                  |
| Fire-error / checkpoint-mode comparison               | Complete on 56 clips; limitations accepted for indoor integration; independent quality remains open |
| Checkpoint-preserving model staging/configuration     | Complete; version/hash/graph-floor contract synchronized; historical artifact retained for rollback |
| RTSP → Frigate → AI → P0 → dashboard confirmation     | New model passed locally in 25468, including playable clip, real user action and 360 px viewport    |
| Local RTSP/MQTT and process recovery / M3 diagnostics | Passed locally; five actual interruption/restart cases and seven total checkpoints                  |
| External Telegram delivery and real confirmation      | Passed in 24628: one photo, real `TELEGRAM` / `IM_OK`, `RESOLVED`, caption edit and callback answer |
| Local 30–60 minute CPU/RAM soak                       | Deferred by the user on 27/10; not run                                                              |
| Combined M1/M2 load / target-camera recovery          | Pending; pose/fall runtime is not present in this checkout                                          |
| Hosted CI / independent review / release              | Pending; deployment flags remain off by default                                                     |

Update after the user supplied prior test outputs: **training and offline
fire/smoke evaluation evidence are available**. The missing-evidence assessment
based only on the first six local samples is superseded by the supplied evidence
described below. The local system integration is now verified separately from
release-quality acceptance.

## Environment and reproducibility

Setup and export tools are in
[services/ai-service/training/yolo26](../../services/ai-service/training/yolo26/README.md).
The full Windows dependency graph is hash-locked. Portable Python, virtual
environments, packages, caches and outputs are under Git-ignored `artifacts/m3`.
The system Python/PATH/registry and the shared AI runtime baseline were unchanged.

| Component           | Verified version                 |
| ------------------- | -------------------------------- |
| Python              | 3.11.13                          |
| Ultralytics         | 8.4.184                          |
| Torch / torchvision | 2.5.1+cpu / 0.20.1+cpu           |
| NumPy / OpenCV      | 1.26.4 / opencv-python 4.10.0.84 |
| ONNX / ONNX Runtime | 1.17.0 / 1.20.1                  |

The bootstrap uv wheel was checked against its pinned PyPI SHA-256; Python was
installed locally with `--no-bin --no-registry`. pip-tools 7.4.1 generated the
export lock using the existing shared lock toolchain. Installing that lock with
hash verification succeeded; `uv pip check` found all 47 packages compatible.
Only the training OpenCV flavor is present in this environment.

## Checkpoint and export

Original checkpoint: `artifacts/m3/trained/best.pt`, 5,388,997 bytes.

SHA-256: `4661f34e0f506c2cde97f2d42d43803d5ca8c5f53f92ad499e0237e49f7532b9`.
The original file remained unchanged after export.

The checkpoint records YOLO26n, classes **0=fire, 1=smoke**, Ultralytics 8.4.184 and
50 training epochs. These differ from the original plan's YOLO11n, reversed
class order and Ultralytics 8.3.59. This is a separate export candidate, not a
silent replacement of the frozen shared/runtime or model-quality baseline.

Historical NMS-free output: `artifacts/m3/exported/yolo26n-cpu-v1/fire-smoke-yolo26n.onnx`, 9,757,960 bytes.

SHA-256: `1bd4ef98ef14f714b60474dd0bd87696bd0e4118efe1ae36c1a55c26bc92d6ed`.

- Static FP32, batch 1, 640 pixels, opset 17; no graph simplification.
- NMS-free one-to-one head selected explicitly with `nms=False`.
- Input: `images`, float32 `[1,3,640,640]`.
- Output: `output0`, float32 `[1,300,6]`.
- Row: `x1,y1,x2,y2,confidence,classId` in letterboxed input pixels.
- ONNX checker and CPUExecutionProvider session load/inference passed.

Do not use the original YOLO11 raw `[1,6,8400]` decoder for this output. Selecting
the one-to-one head also means the stored training validation metrics do not
automatically establish the exported head's quality.

## Local-image parity and timing

Six deterministic samples were selected from the existing D-Fire `val.txt`:
two smoke-only, two fire-only, one smoke+fire and one negative according to local
annotations. Source annotation classes are `0=smoke, 1=fire`; model class IDs were
read independently from checkpoint/ONNX metadata. These samples are technical
checks, not certified independent holdout/calibration material.

| Image        | Annotation group | PyTorch / ONNX detections at confidence >0.25 | Parity |
| ------------ | ---------------- | --------------------------------------------- | ------ |
| AoF06978.jpg | Smoke-only       | 0 / 0                                         | Pass   |
| AoF07618.jpg | Smoke-only       | 0 / 0                                         | Pass   |
| AoF07738.jpg | Fire-only        | 1 fire / 1 fire                               | Pass   |
| AoF07739.jpg | Fire-only        | 1 fire / 1 fire                               | Pass   |
| AoF07718.jpg | Smoke + fire     | 1 fire / 1 fire                               | Pass   |
| AoF06723.jpg | Negative         | 0 / 0                                         | Pass   |

All six samples were 1280x720. The three matched detections had minimum IoU
**0.9999989** and maximum score difference **0.000001997**. Empty-output agreement
is included, so these results do **not** verify positive smoke detection parity.
Both paths failed to produce smoke detections on these smoke-labelled samples.
Review annotations/content and run broader per-class evaluation before release;
six images cannot establish model recall or explain the failure mechanism.

On the local Intel Core i5-1145G7, ONNX CPU with two intra-op threads measured
**p50 48.48 ms / p95 61.21 ms**, after five warmups and 20 timed iterations on the
last sample. Timing covers `session.run` only, excludes preprocessing/queue/other
modules, and does not certify concurrent camera capacity or production latency.

Detailed local evidence:

- `artifacts/m3/trained/checkpoint-inspection.json`
- `artifacts/m3/evaluation/technical-samples.json` (image/annotation SHA-256 values)
- `artifacts/m3/exported/yolo26n-cpu-v1/export-report.json`

Ruff lint and format checks passed for the export tooling. Model binaries and
local environments are not committed. The model manifest now registers this
artifact as `INTEGRATION_CANDIDATE`, without approving production enablement.

## User-supplied evaluation results reviewed on 26/10/2026

The supplied report directory is:

`datasets/m3/raw/Model4_finetune_best_on_Indoor_Fire_Smoke_test-20261026T044136Z-1-001/Model4_finetune_best_on_Indoor_Fire_Smoke_test/`

It contains 12 PNG/JPG artifacts: per-class curves, raw/normalized confusion
matrices, and three pairs of labelled/predicted image batches. These are outputs
of the user's existing evaluation, not a new local evaluation run.

| Reading from supplied plot | Value                    |
| -------------------------- | ------------------------ |
| Fire AP@0.5                | 0.885                    |
| Smoke AP@0.5               | 0.838                    |
| Mean AP@0.5                | 0.862                    |
| Best mean F1 shown         | 0.82 at confidence 0.399 |

Values above were read from plot legends; numeric evaluation logs were not
included. AP is an area-under-curve metric, not event recall, overall accuracy or
a guarantee at one confidence threshold. The F1 operating point from this test
plot has not been adopted as a calibrated production threshold.

The report plots use fire/smoke names matching the checkpoint's semantic classes.
They provide evidence that smoke testing has already been performed. The earlier
two smoke-labelled image misses remain limited observations; they do not by
themselves establish that the trained model lacks smoke detection or needs retraining.

### Supplied video result

`datasets/m3/raw/bucket11.avi`: 174,201,310 bytes, 1280x720, 25 FPS, 1,888 frames,
75.52 seconds. SHA-256:
`81ec9499526696b1798161f188942a004530053b979c7a1b2186737b14915f15`.

Visual review at 20, 40 and 60 seconds confirms this is an **already annotated
inference-result video**. At 40 and 60 seconds it contains a blue box over visible
fire, with burned-in `ID0 0.84` and `ID0 0.80` labels respectively. This records the
user's prior video test; it is not raw camera input for an independent replay.

An exploratory ONNX replay sampled 151 frames from this annotated file at 2 FPS
and confidence 0.5, without positive detections. Since its input already includes
rendered results, it is not used as model-quality, recall or raw-video parity
evidence. That interpretation is recorded alongside the exploratory output in
`artifacts/m3/evaluation/bucket11-onnx-v1/INPUT_REVIEW.md`.

SHA-256 values for all 12 supplied plot files, the clip and checkpoint, plus the
review findings, are stored locally in
`artifacts/m3/evaluation/supplied-evaluation-review.json`. The user attributes the
results to the supplied checkpoint; the directory does not include machine-readable
run metadata binding its plot files to a checkpoint hash.

### Auxiliary dataset configuration

`datasets/m3/raw/Model4_eval_ready` contains 3,900 train, 1,300 validation and 1,300
test image/label pairs. Its YAML/README declare **0=smoke, 1=fire**, while `best.pt`
records **0=fire, 1=smoke**. This auxiliary dataset must use an explicitly verified
mapping in any subsequent evaluation. No labels were modified, and this mismatch
alone does not establish that the separately supplied evaluation plots are wrong.

## Runtime implementation and raw-video integration, 26/10/2026

The user subsequently supplied the original video at
`D:/studies/Hk1-Nam4/model/video/bucket11.mp4`: 28,987,569 bytes, 1280x720, 25 FPS,
1,889 frames, 75.56 seconds. SHA-256:
`be7aff53c1dc03dbd5cdad1da9ed270620a68ab1dd899d73605cdb928fd89286`.
Visual inspection at 40 seconds confirmed an unannotated source image. The local
archive has no source/license text; public dataset attribution and holdout
independence have not been independently verified.

Implemented components:

- Independent Frigate full-frame JPEG publisher and bounded MQTT consumer, without
  a person/track/zone prerequisite; pinned shared-memory ownership is preserved.
- Authenticated `/fire/detect`, checksum/layout validation, full-frame box mapping,
  bounded ONNX inference, three-frame confirmation and observed-negative rearming.
- Backend validation of its own frame evidence; separate P0 event/camera latch;
  immutable durable result submission through existing receipts/outbox/escalation.
- Retry of transient confirmation/receipt failures; fresh AI sessions after a lost
  or unusable response so an unpersisted AI latch cannot suppress future evidence.
- Exact JPEG snapshot/checksum, independent camera clip recovery, SSE updates and
  Vietnamese dashboard labels/confidence/boxes/confirmation-frame count.
- Default-off flags, environment documentation, model staging and isolated DB/video
  gates. The CI workflow includes durable fire DB checks and bridge regressions.

The isolated raw-video gate passed in
`artifacts/m3/evaluation/camerai-us18-video-19716/` using real Frigate 0.18, MQTT,
the registered ONNX, PostgreSQL and MinIO, and the real FireModule plus its
receipts/outbox/escalation/event services. No application database or `.env` was
used. Test containers/volumes were removed afterward.

| Observed result     | Value                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Fire incident       | Exactly one P0 `FIRE_SMOKE_DETECTED`                                                 |
| Confirming evidence | Three unique ordered frames, spanning 1,438 ms                                       |
| Incident confidence | 0.7877104282, `fire-temporal-min-v1`                                                 |
| Result delivery     | `APPLIED`, no stored delivery error                                                  |
| Media               | Exact confirming JPEG checksum verified from MinIO; camera recording MP4 attached    |
| Escalation          | `NOTIFIED`; TELEGRAM and SNS_SMS notification intents persisted as `PENDING`         |
| Event updates       | Four observed SSE-service updates                                                    |
| User action         | Authenticated event API confirmation reached `RESOLVED`; no extra incident afterward |
| AI HTTP calls       | 74; p50 119.57 ms, p95 258.53 ms                                                     |

HTTP timing includes local transport and inference work during this one run,
including rejected/stale responses. It is not a session-only benchmark, event
recall metric, alert delivery latency or concurrent camera capacity result.
The harness loops the clip for warmup, reads it through Frigate FFmpeg rather
than RTSP, and observes SSE through the real service rather than a browser.
External Telegram/SNS delivery was disabled; persisted notification intent does
not demonstrate delivery to a real recipient.

The run also exposed host/container clock lead ranging from -670 to +743 ms at
HTTP response receipt. The default 500 ms future tolerance and one-second
freshness rules rejected affected frames; they were not widened to make the test
pass. Fresh evidence recovery allowed confirmation afterward. Synchronize clocks
and repeat deployment latency/freshness checks before enabling M3.

Local verification includes 48 AI tests (92% shared-app coverage), nine bridge
tests, 340 backend unit tests including 15 fire tests (81.33% fire line coverage), five disposable
PostgreSQL integration tests, the raw-video integration above, 109 tooling tests and 193 web tests.
Python mypy/Ruff, TypeScript checks and OpenAPI lint were also run. Existing
OpenAPI warnings and the pre-existing modal function-length warning remain.
Local JS checks used installed Node 24.15.0; CI is configured for baseline Node 22.
No hosted CI run or independent reviewer approval is claimed.

## Remaining release work

Use the supplied checkpoint, ONNX, evaluation plots and annotated clip as the
existing model/testing evidence. The camera-to-detector/temporal/P0 path now has
a local real-video integration pass. No repeat training is requested as a
consequence of this review. Keep both admission flags off until release acceptance.

The 27/10 follow-up completed clock diagnosis, aligned the backend with the Docker
runtime, screened 27 public flame-positive/negative videos, and passed RTSP replay
plus actual dashboard interaction on Node 22.23.4. The final isolated run is
`artifacts/m3/evaluation/camerai-us18-video-24176/`: exact evidence, playable clip,
three frames spanning 594 ms, P0 notification intents, and browser confirmation
to `RESOLVED`. Subsequent runtime recovery passed in
`artifacts/m3/evaluation/camerai-us18-video-18880/`. Latest regressions passed:
69 AI tests (92.38% shared-app coverage), 20 targeted backend M3 unit tests,
109 tooling tests and the new model's RTSP/browser gate on Node 22.23.4. The
earlier 345 backend tests and 193 web tests remain recorded separately. TypeScript,
Ruff/mypy and OpenAPI checks passed; five existing API lint warnings remain.
The subsequent frozen KMU comparison completed on 29 eligible videos. Threshold
0.65 reduced fire-only recall from 18/19 to 16/19 without reducing false fire
confirmations (0/10 at both); the 0.50 baseline is retained. These are video-level
diagnostic ratios, with partial training-overlap screening and only 17.72 negative
minutes. The unchanged combined fire-or-smoke policy still confirms six
flame-negative clips at 0.50; smoke labels are unverified. See the linked reports
for limits and error examples.

Remaining checks are independent holdout/calibration and long-negative evidence,
acceptable fire precision/recall, source/distribution review, target load with
M1/M2 active, deployment latency and actual camera reconnect/restart behavior,
hosted baseline CI and independent reviewer acceptance. Local RTSP replay,
browser review and real Telegram photo delivery/confirmation are no longer
missing. Local recovery and runtime diagnostics are also complete;
the local CPU/RAM soak is explicitly deferred by the user, and physical
target-camera validation remains separate.
The selected checkpoint-preserving model's own full-chain evidence is now in
`artifacts/m3/evaluation/camerai-us18-video-25468/`; this supersedes the earlier
statement that only its AI route had been tested. G2 release-quality acceptance
and full G5 release remain open.
See [the runbook](US-18_RUNTIME_RUNBOOK.md) for repeatable verification and rollback.

## Checkpoint model integration

The selected integration artifact preserves the checkpoint's default one-to-many
prediction mode, using embedded class-aware NMS rather than the earlier explicit
NMS-free head. No new training was required for this change.

| Property                                  | Current artifact                                                    |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Model version                             | `fire-smoke-yolo26n-checkpoint-nms-v1`                              |
| Staged file                               | `services/ai-service/models/fire-smoke-yolo26n-checkpoint-nms.onnx` |
| SHA-256                                   | `773e23d1896d82787819f665694bfbc33825081f7f7a0f5fa5b1c6a22cb54650`  |
| Size                                      | 9,779,406 bytes                                                     |
| Layout                                    | FP32 `[1,3,640,640]` → `[1,300,6]`                                  |
| Class map                                 | `0=fire`, `1=smoke`                                                 |
| Runtime threshold / graph floor / NMS IoU | 0.50 / 0.10 / 0.70                                                  |
| Deployment contract SHA-256               | `a20d33b109be5aaae022577a3823b0d0feb627d25c466b736edf1e0a74e231ef`  |

The checksum-bound sidecar is mandatory for the embedded-NMS model. The runtime
rejects a mismatched model, mode or graph floor. Original weights and the previous
artifact are preserved; rollback settings remain in the runbook.

Eight reviewed error frames passed PyTorch/ONNX parity with minimum IoU
0.9999907 and maximum score difference 0.000001908. Single-sample ONNX timing was
p50 50.45 ms / p95 83.19 ms; it excludes preprocessing, transport and other modules
and does not certify capacity.

The selected artifact passed its own RTSP/MediaMTX → Frigate/MQTT → AI/backend →
PostgreSQL/MinIO → browser gate in `camerai-us18-video-25468`, on Node 22.23.4.
Event `7d7f1534-146c-400b-aa3b-8b8165625b3c` used three unique frames spanning
591 ms, confidence 0.7888656 and one independent P0 without a person track. The
confirming JPEG checksum matched; the reviewed box covered flames. Chrome played
the 14.24-second 1280×720 clip, checked a 360-pixel viewport and performed an actual
dashboard confirmation to `RESOLVED`. This gate created notification intents but
sent no external message. Its disposable stack was removed afterward.

Evidence: `artifacts/m3/evaluation/camerai-us18-video-25468/` contains input,
confirmation, result, browser report, screenshots and container logs. A separate
recovery run, `camerai-us18-video-18880`, passed five actual RTSP/MQTT and service
interruption/restart cases, retaining one incident/result and matching downloaded
media checksums. Transport freshness guards were not relaxed.

## Model quality and known limitations

The following are diagnostic video-level confirmations, not certified independent
holdout accuracy, frame mAP, ignition latency or deployment false-alarm rates.

| Fire-only protocol                                  | Positive videos confirmed | Flame-negative videos falsely confirmed |
| --------------------------------------------------- | ------------------------- | --------------------------------------- |
| Historical NMS-free, FIRESENSE at 0.50              | 9/11                      | 5/16                                    |
| Historical NMS-free, KMU at 0.50                    | 18/19                     | 0/10                                    |
| Historical NMS-free, KMU at 0.65                    | 16/19                     | 0/10                                    |
| Historical NMS-free, pooled at 0.50                 | 27/30                     | 5/26                                    |
| Selected checkpoint-preserving mode, pooled at 0.50 | 29/30                     | 7/26                                    |

Three KMU sequences matched available train/validation images and were excluded
before the 29-video comparison. Training provenance is incomplete; this screening
does not certify independent source splits. The earlier 0.65 proposal was rejected
because it lost two more KMU positives. Its metrics belong to the historical head
and cannot be transferred to the selected mode without a new evaluation.

The selected mode's pooled recall/precision proxies are 96.67% / 80.56%, below
the proposed 90% precision target. It recovered `posVideo3.872` and `kmu-pos-16`,
but still missed `posVideo7.876`. Headlights and TV content caused additional
false fire confirmations. Reviewed earlier errors included night lights,
reflections, orange equipment and colorful background sails; the red shirt was
not established as the cause of that clip's false box. A four-crop tiling probe
was rejected because it increased false confirmations and inference cost.

The actual policy accepts fire **or smoke**. On the historical KMU run it confirmed
6/10 flame-negative clips at 0.50 despite 0/10 fire-only false confirmations. The
selected mode confirmed 17/26 pooled flame-negative clips versus 13/26 for the
historical mode. Smoke ground truth is incomplete, so these combined counts are
not verified smoke false alarms. The total 27.45 negative minutes cannot establish
an hourly deployment FAR.

The user accepted these limits as non-blocking for indoor integration on 27/10;
TV-content confusion remains indoor-relevant. Independent quality, source rights,
calibration and release acceptance are still open. No further training or automatic
label curation was performed. Proposed review images remain annotation candidates,
not ground truth or a fresh holdout.

Reproducible manifests and evaluation scripts remain under
`services/ai-service/evaluation/` and `services/ai-service/scripts/`. Detailed local
evidence remains in `artifacts/m3/evaluation/firesense-v1/`,
`kmu-2012/followup-050-065-20261027/`, `fire-error-analysis-20261027/` and
`checkpoint-head-recheck-20261027/`. Removing per-session Markdown reports does
not remove those predictions, source hashes, review sheets or raw evidence.

## Main webcam and Telegram acceptance

The main application uses `http://localhost:3000`, the original account/rooms and
`cam_test`, after backup and normal additive migrations. Webcam publishing uses
the existing WHIP controls. The cancelled isolated run 23944 is not a manual pass;
its database/event must not be confused with the main application.

| Run                                                                            | Recorded outcome                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated Telegram 24628, event `c8088fc3-47de-4fae-a8c3-13babb753099`          | One original photo accepted; actual `TELEGRAM` / `IM_OK`, final `RESOLVED`, caption edit and callback answer. Its disposable database used a 600-second window; it did not test annotated delivery. |
| Main webcam, event `fa0c194a-c5b4-4a91-a2bc-8a4b8fd2e826` at 16:07:26 on 27/10 | Three confirming frames over 600 ms; real Telegram `IM_OK` after 19.64 seconds; final `RESOLVED`, webhook/caption work processed, operator confirmed the same event became safe on web.             |
| Main webcam, event `456fe106-e772-4a32-9fb7-20c51d66911d` at 20:28:38 on 27/10 | Annotated PHOTO accepted at 20:28:44; operator confirmed the red flame box. Reply window expired; this is delivery evidence, not a new successful callback test. Event was later closed.            |
| Main webcam follow-up on 28/10 at 08:40:24                                     | After restarting WHIP, event `15bf3f16-beee-4d9f-83ad-0ae4903f0f8b` was created with confidence 0.531; operator confirmed seeing the web alert.                                                     |

The later bounded Telegram session used three send attempts in total, including
retry, and recorded two SENT PHOTO notifications. It ended at 20:30:33 on 27/10,
disabled delivery and stopped its owned temporary tunnel. The retained webhook
address later returned 404 because that tunnel was inactive. A fresh active
webhook must be configured for another callback test. The operator has since been
given instructions for continuous delivery; those instructions were not executed
by the agent and do not prove that continuous mode is enabled.

All times above are Asia/Ho_Chi_Minh. Exact camera/event/time matching is required
when comparing Telegram and web. Optical input from a phone playing fire video
checks the pipeline, not independent physical-fire recall. The main rule retains
its 30-second response window. Historical test events were not auto-confirmed.

Local evidence is retained under `artifacts/m3/evaluation/` in
`camerai-us18-telegram-24628/`, `main-webcam-ui-20261027/` and
`fire-ux-compact-20261027/`. Secrets and private account identifiers are excluded
from this report. No account, camera, event, recording or local evidence was
deleted as part of documentation consolidation.

## Fire alert UX and evidence

- The original dashboard/events UI is reused. Fire cards now use the same image,
  title and action sizes as other cards, with a pale red background and moving red
  dashed border for recent active alerts. Reduced-motion preferences keep it static.
- Only unresolved P0 detections less than three hours old can interrupt. Same-camera
  detections within a five-minute gap are grouped for prompting; persisted receipts
  prevent repeated popup display across reload/escalation in that account/browser.
  Web Locks and storage events coordinate tabs. Clearing storage or using another
  device does not share those local receipts.
- One attention/detail dialog is mounted at a time, with focus trapping and inert
  background. Attention fits checked viewports; only the detail body scrolls when
  needed. Viewing an alert does not resolve it. The attention expires at its
  three-hour deadline, including while open.
- Details show absolute detection time, camera/zone, P0, status, labels/confidence,
  update information, three-frame evidence and history. Snapshot boxes use the
  immutable confirming-frame metadata; fire is red/orange and smoke yellow.
- Recording clips include pre-roll from first qualifying frame minus five seconds
  through confirmation plus five seconds. Camera synchronization enables at least
  one continuous recording day when M3/recording are enabled, preserving longer
  retention and honoring explicit recording disable. The MP4 remains original
  video without moving detector boxes. Both webcam clips were reviewed to contain
  the fire display after the preceding normal room footage.
- Transient detail/media failures retry; signed links renew without resetting video
  unnecessarily. Manual reload is an icon-only button with accessible label/tooltip.
  Missing evidence is explicit. Switching events does not leak another event's media.
- The worker renders a separate annotated Telegram JPEG with FFmpeg; originals are
  unchanged. Timeout/render failures use the original with an explicit overlay notice.
- The 114 action uses an outlined handset and explicit `tel:114` link; no automatic
  call is made. Dialog dismissal is an X with two crossing strokes. Emergency
  closure is text-only. Canonical confirmation and closure semantics are unchanged.

The compact follow-up passed 216 web tests, 364 backend unit tests and 19 PostgreSQL
Telegram integration tests. These are historical local results, not a hosted CI
claim for a later revision. The model-contract follow-up separately passed 69 AI
tests with 92.38% shared-app coverage, 20 targeted backend M3 tests and 109 tooling
tests. On 28/10, the card/control refinements passed TypeScript and targeted ESLint;
the existing 10 card tests and one emergency-link test passed in their respective
targeted runs.

Chrome fixtures checked attention without scroll at 1280×720, 1366×600, 360×640,
320×568 and 740×420; details had at most one scroll region. The final card check
verified equal 110-pixel desktop card heights, matching typography, moving dashes,
reduced-motion behavior and no horizontal overflow at 360 pixels. Final detail
checks verified reload requests, X dismissal, the unchanged call target and no
event mutation. UI fixtures did not send messages, make calls or establish model
accuracy. Actual playback, metadata/renderer checks and continuous-recording probes
are separate evidence.

Evidence directories: `artifacts/m3/evaluation/fire-ux-20261027/`,
`fire-ux-compact-20261027/`, `fire-card-compact-20261028/` and
`fire-detail-controls-20261028/`. Private recordings/backups remain in
`artifacts/m3/private/`. Follow the [manual guide](US-18_HUONG_DAN_NGHIEM_THU.md)
for lead acceptance; no automatic closure of the original plan's DoD is implied.
