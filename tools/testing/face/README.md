# Face branch verification

Scope: Face Track Once, real YuNet/R50 quality assessment and backward-compatible
SFace embedding. Local tests do not replace the AWS replay evidence or staging tests.

Use Node 22, pnpm **9.12.0**, Python 3.11 with the AI dev dependencies plus
`boto3` and `jsonschema`, Newman and k6. Fetch the pinned models with the AI
service's `scripts/fetch_models.py`. Docker is needed for DB/MQTT integration.
Use a disposable environment; the integration suites create their own containers.

Run from the repository root (PowerShell). Set `CAMERAI_VENV` to a virtualenv
with the project's dependencies; the path below is the environment used for this run.

```powershell
$env:CAMERAI_VENV='artifacts/ai-gate-windows'
pnpm --filter @cam/orchestrator test:cov --runInBand
pnpm --filter @cam/orchestrator test:integration
pnpm test:ai
python -m unittest discover -s services/aws-workers/face -p 'test_*.py'
python -m pytest infra/frigate/frame-metadata/test_bridge.py
python -m pytest tools/testing/face/test_runtime.py
pnpm check:all
pnpm --filter @cam/orchestrator build
```

Use the virtualenv's Python executable for `python` commands. The real-model tests
use an existing crop in the Test 6 evidence; there is no generated identity result.

Start the isolated HTTP target in a separate terminal:

```powershell
python tools/testing/face/serve.py
```

This target listens only on `127.0.0.1:18082`, uses a public test-only token,
sets the local provider to exercise SFace, and disables Pose/Fire. It uses the
real checked R50 model for `/face/assess`. It does not access AWS or application DB.

```powershell
$env:FACE_IMAGE=(Resolve-Path 'docs/test/FACE_TEST6_2026-11-23/evidence/crops/TC02-no-glasses-final-1795410461.084077-hx9jgm-r1.png').Path
$env:AI_INTERNAL_TOKEN='face-branch-loopback-test-only'
newman run tools/testing/face/collection.json --env-var "token=$env:AI_INTERNAL_TOKEN" --env-var "imagePath=$env:FACE_IMAGE" --reporters cli,junit --reporter-junit-export newman.xml
k6 run --summary-export k6-summary.json --out json=k6-raw.json tools/testing/face/assess.k6.js
```

Import `collection.json` directly into Postman, set `token` and `imagePath`, then
run the collection. `build-collection.mjs` regenerates the same requests/assertions;
format its output with the repository's Prettier before committing changes.

k6 declares gates before execution: 2 arrivals/s for 60 seconds, 2 preallocated
VUs (maximum 4), p95 <2000 ms, HTTP errors =0, valid R50 assessments =100%,
no dropped iterations and at least 120 requests. A real-model warm-up request
runs before the scenario. These are local QA gates, not approved staging SLAs.
The summary includes warm-up; scenario completion and warm-up are reported separately.

Stop the server with Ctrl+C. No production token belongs in the collection or reports.
The current execution report is `docs/test/FACE_BRANCH_2026-11-23/REPORT.md`.
