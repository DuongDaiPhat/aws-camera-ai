/** Targeted real-AWS replays after timestamp-bound multi-person crop fix. */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
process.env.FACE_EVAL_IGNORE_HOLD = 'true';
async function run(...args) {
  console.log(new Date().toISOString(), ...args);
  const child = spawn(process.execPath, ['tools/scripts/face-track-once-eval.mjs', ...args], {
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b) => {
      process.stdout.write(b);
      appendFileSync('docs/test/FACE_TRACK_ONCE_2026-11-22/evidence/aligned-suite.txt', b);
    });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  if (code !== 0) throw Error(`${args.join(' ')} failed: ${code}`);
}
for (const [video, label] of [
  ['known_face_and_stranger.mp4', 'TC08-extra-no-glasses-aligned'],
  ['known_face_vid8.mp4', 'TC08-no-glasses-aligned'],
  ['known_face_vid8_with_glass.mp4', 'TC08-glasses-aligned'],
  ['known_face_with_glass_and_stranger.mp4', 'TC08-extra-glasses-aligned'],
])
  await run('play', video, label);
await run('enroll', 'B');
for (const [video, label] of [
  ['known_face_vid7.mp4', 'TC07-close-aligned'],
  ['known_face_vid7_with_glass.mp4', 'TC07-close-glasses-aligned'],
  ['known_face_vid7_separated.mp4', 'TC07-separated-aligned'],
  ['known_face_vid7_with_glass_separted.mp4', 'TC07-separated-glasses-aligned'],
])
  await run('play', video, label);
await fetch('http://127.0.0.1:18081', {
  method: 'POST',
  body: JSON.stringify({ spatialReidEnabled: false }),
});
try {
  await run('play', 'known_face_vid3.mp4', 'TC06-embedding-first-supplement');
  await run('play', 'known_face_vid3.mp4', 'TC06-embedding-return-supplement', 'keep-cache');
  await run('play', 'known_face_vid_2.mp4', 'TC10-before-delete-aligned', 'keep-cache');
  await run('delete', 'A');
  await run('play', 'known_face_vid_2.mp4', 'TC10-after-delete-aligned', 'keep-cache');
  await run('play', 'known_face_vid3.mp4', 'TC10-after-delete-control-supplement', 'keep-cache');
  await run('enroll', 'A');
} finally {
  await fetch('http://127.0.0.1:18081', {
    method: 'POST',
    body: JSON.stringify({ spatialReidEnabled: true }),
  });
}
process.env.FACE_EVAL_PREROLL_SECONDS = '30';
await run('play', 'known_face_head_tilt_down.mp4', 'TC01-head-down-warmup-supplement');
delete process.env.FACE_EVAL_PREROLL_SECONDS;
await run('diagnose-local', 'TC06-no-glasses-acceptance');
await run('diagnose-local', 'TC06-glasses-acceptance');
await run('export');
await run('cloudwatch', '2026-11-22T14:23:00Z');
console.log('Completed timestamp-aligned and cache/version controls.');
