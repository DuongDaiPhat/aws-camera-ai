/** Sequential real video/AWS cases. Video 6 is deliberately excluded. */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
const directory = 'docs/test/FACE_REACCEPTANCE_2026-11-23/evidence';
mkdirSync(directory, { recursive: true });
const stage = process.argv[2] || 'baseline';
let cases = ['baseline', 'final', 'candidate'].includes(stage)
  ? [
      ['known_face_vid2_with_glass.mp4', 'TC02-glasses-initial'],
      ['known_face_vid5.mp4', 'TC05-no-glasses-initial'],
      ['known_face_vid5_with_glass.mp4', 'TC05-glasses-initial'],
      ['known_face_vid8.mp4', 'TC08-no-glasses-initial'],
      ['known_face_vid8_with_glass.mp4', 'TC08-glasses-initial'],
      ['known_face_and_stranger.mp4', 'TC08-extra-no-glasses-initial'],
      ['known_face_with_glass_and_stranger.mp4', 'TC08-extra-glasses-initial'],
      ['known_face_vid9.mp4', 'TC09-known-filename-initial'],
      ['stranger_face_vid9.mp4', 'TC09-stranger-initial'],
    ]
  : [];
if (['final', 'candidate'].includes(stage))
  cases = [
    ['known_face_vid_2.mp4', `TC02-no-glasses-${stage}`],
    ...cases.map(([video, label]) => [video, label.replace('-initial', `-${stage}`)]),
  ];
if (stage === 'candidate')
  cases.sort((a, b) => {
    const rank = (label) => (label.startsWith('TC05') ? 0 : label.startsWith('TC08-extra') ? 1 : 2);
    return rank(a[1]) - rank(b[1]);
  });
if (stage === 'verified')
  cases = [
    ['known_face_vid5.mp4', 'TC05-no-glasses-verified'],
    ['known_face_vid5_with_glass.mp4', 'TC05-glasses-verified'],
    ['known_face_vid_2.mp4', 'TC02-no-glasses-verified'],
    ['known_face_vid2_with_glass.mp4', 'TC02-glasses-verified'],
    ['known_face_vid8.mp4', 'TC08-no-glasses-verified'],
    ['known_face_vid8_with_glass.mp4', 'TC08-glasses-verified'],
    ['TC02-known-lock-no-glasses.mp4', 'TC02-lock-no-glasses-verified', { controls: true }],
    ['TC02-known-lock-glasses.mp4', 'TC02-lock-glasses-verified', { controls: true }],
    [
      'TC09-undetermined-retry.mp4',
      'TC09-undetermined-retry-verified',
      { controls: true, fault: 12 },
    ],
    [
      'TC09-undetermined-cap.mp4',
      'TC09-undetermined-cap-verified',
      { controls: true, fault: 14, image: true },
    ],
  ];
if (stage === 'finish')
  cases = [
    ['known_face_vid5.mp4', 'TC05-no-glasses-continuity'],
    ['known_face_vid5_with_glass.mp4', 'TC05-glasses-continuity'],
    ['known_face_vid2_with_glass.mp4', 'TC02-glasses-replay'],
  ];
if (stage === 'final-unknown')
  cases = [
    ['known_face_vid9.mp4', 'TC09-known-filename-verified'],
    ['stranger_face_vid9.mp4', 'TC09-stranger-verified'],
  ];
if (!cases.length) throw Error('Unknown suite stage');
for (const [video, label, options = {}] of cases) {
  console.log(new Date().toISOString(), label);
  const child = spawn(
    process.execPath,
    ['tools/scripts/face-reacceptance-run.mjs', 'play', video, label],
    {
      env: {
        ...process.env,
        FACE_EVAL_VIDEO_DIR: options.controls
          ? 'artifacts/face-reacceptance-2026-11-23/controls'
          : 'local_image/Dataset_2/Videos',
        FACE_EVAL_AI_FAULT_SECONDS: String(options.fault || 0),
        FACE_EVAL_IMAGE_UNAVAILABLE: String(options.image || false),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (bytes) => {
      process.stdout.write(bytes);
      appendFileSync(`${directory}/${stage}-suite.txt`, bytes);
    });
  const code = await new Promise((done, reject) => {
    child.once('exit', done);
    child.once('error', reject);
  });
  if (code !== 0) throw Error(`${label} failed (${code})`);
}
