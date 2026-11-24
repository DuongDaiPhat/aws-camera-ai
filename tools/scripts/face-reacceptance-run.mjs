/** Isolated real-AWS reacceptance, excluding Video 6. Run through face-eval-run.mjs. */
process.env.FACE_EVAL_OUTPUT_DIR ||= 'docs/test/FACE_REACCEPTANCE_2026-11-23';
process.env.FACE_EVAL_PRIVATE_DIR ||= 'artifacts/face-reacceptance-2026-11-23';
process.env.FACE_EVAL_CAMERA_SLUG ||= 'face_reacceptance_20261123';
process.env.FACE_EVAL_PACED = 'true';
process.env.FACE_EVAL_IGNORE_HOLD = 'true';
await import('./face-track-once-eval.mjs');
