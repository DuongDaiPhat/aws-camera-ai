/** Sequential real-time camera replay. Run through face-eval-run.mjs. */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const log = 'docs/test/FACE_TRACK_ONCE_2026-11-22/evidence/suite.txt';
const suffix = process.env.FACE_EVAL_RUN_SUFFIX || 'native';
async function run(...args) {
  console.log(new Date().toISOString(), ...args);
  const c = spawn(process.execPath, ['tools/scripts/face-track-once-eval.mjs', ...args], {
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const s of [c.stdout, c.stderr])
    s.on('data', (b) => {
      process.stdout.write(b);
      appendFileSync(log, b);
    });
  const code = await new Promise((r) => c.on('exit', r));
  if (code !== 0) throw Error(`${args.join(' ')} failed: ${code}`);
}
const cases = [
  ['known_face_head_tilt_down.mp4', 'TC01-head-down-retest'],
  ['known_face_turning_back.mp4', 'TC01-back'],
  ['known_face_vid_2.mp4', 'TC02-no-glasses'],
  ['known_face_vid2_with_glass.mp4', 'TC02-glasses-retest'],
  ['known_face_vid3.mp4', 'TC03-no-glasses'],
  ['known_face_vid3_with_glass.mp4', 'TC03-glasses'],
  ['known_face_vid4.mp4', 'TC04-no-glasses'],
  ['known_face_vid4_with_glass.mp4', 'TC04-glasses'],
  ['known_face_vid5.mp4', 'TC05-no-glasses'],
  ['known_face_vid5_with_glass.mp4', 'TC05-glasses'],
  ['known_face_vid6.mp4', 'TC06-no-glasses'],
  ['known_face_vid6_with_glass.mp4', 'TC06-glasses'],
  ['known_face_vid8.mp4', 'TC08-no-glasses'],
  ['known_face_vid8_with_glass.mp4', 'TC08-glasses'],
  ['known_face_vid9.mp4', 'TC09-known-filename'],
  ['stranger_face_vid9.mp4', 'TC09-stranger'],
  ['known_face_and_stranger.mp4', 'TC08-extra-no-glasses'],
  ['known_face_with_glass_and_stranger.mp4', 'TC08-extra-glasses'],
];
for (const [video, label] of cases) await run('play', video, `${label}-${suffix}`);
await run('enroll', 'B');
for (const [video, label] of [
  ['known_face_vid7.mp4', 'TC07-close'],
  ['known_face_vid7_with_glass.mp4', 'TC07-close-glasses'],
  ['known_face_vid7_separated.mp4', 'TC07-separated'],
  ['known_face_vid7_with_glass_separted.mp4', 'TC07-separated-glasses'],
])
  await run('play', video, `${label}-${suffix}`);
// Refresh A's cache, delete A with B still registered, then replay within the 5-minute TTL.
await run('play', 'known_face_vid_2.mp4', `TC10-before-delete-${suffix}`);
// Video 3 already passed the native-resolution gate. Keep a separate positive
// control so invalidation remains testable if the shorter video 2 misses a face.
await run('play', 'known_face_vid3.mp4', 'TC10-before-delete-control-supplement');
await run('delete', 'A');
await run('play', 'known_face_vid_2.mp4', `TC10-after-delete-${suffix}`, 'keep-cache');
await run('play', 'known_face_vid3.mp4', 'TC10-after-delete-control-supplement', 'keep-cache');
await run('enroll', 'A');
await run('cloudwatch', '2026-11-22T14:23:00Z');
console.log('Completed requested video suite.');
