/** Real AWS collection/version and embedding-cache controls; run through face-eval-run.mjs. */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const actions = [];
async function run(args, control = false) {
  const child = spawn(process.execPath, ['tools/scripts/face-reacceptance-run.mjs', ...args], {
    windowsHide: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      FACE_EVAL_VIDEO_DIR: control
        ? 'artifacts/face-reacceptance-2026-11-23/controls'
        : 'local_image/Dataset_2/Videos',
    },
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  actions.push({ args, code, at: new Date().toISOString() });
  writeFileSync(
    'docs/test/FACE_REACCEPTANCE_2026-11-23/data/cache-control-actions.json',
    JSON.stringify(actions, null, 2),
  );
  if (code !== 0) throw Error(`Control failed: ${args[0]}`);
}
const config = (body) =>
  fetch('http://127.0.0.1:18081', { method: 'POST', body: JSON.stringify(body) }).then((r) => {
    if (!r.ok) throw Error('QA control unavailable');
  });
await run(['enroll', 'B']); // Keep the collection nonempty after removing A.
try {
  await config({ spatialReidEnabled: false, reset: true });
  const video = 'TC02-known-lock-no-glasses.mp4';
  await run(['play', video, 'TC10-cache-prime'], true);
  await run(['play', video, 'TC10-cache-hit', 'keep-cache'], true);
  await run(['delete', 'A']);
  await run(['play', video, 'TC10-after-delete', 'keep-cache'], true);
  await run(['play', 'TC09-unknown-cap.mp4', 'TC09-unknown-cap'], true);
} finally {
  await run(['enroll', 'A']);
  await run(['delete', 'B']);
  await config({ spatialReidEnabled: true, aiUnavailable: false, imageUnavailable: false });
}
