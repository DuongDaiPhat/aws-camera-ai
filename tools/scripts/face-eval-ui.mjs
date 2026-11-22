/** Starts a separate authenticated local fixture UI; leaves Cognito dev config intact. */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const fixture = JSON.parse(readFileSync('artifacts/rekognition-eval-2026-11-22/fixture.json'));
const mode = process.argv[2];
const env = { ...process.env };
let args;
if (mode === 'backend') {
  Object.assign(env, {
    AUTH_PROVIDER: 'jwt',
    JWT_SECRET: fixture.jwtSecret,
    JWT_ACCESS_TTL: '3600',
    JWT_REFRESH_TTL: '604800',
    PORT: '3003',
    MQTT_CLIENT_ID: 'face-eval-ui',
    APPLICATION_RESULTS_CONSUMER_ENABLED: 'false',
  });
  args = ['apps/orchestrator/dist/main.js'];
} else if (mode === 'web') {
  Object.assign(env, {
    NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3003/api/v1',
    FACE_EVAL_NEXT_DIST_DIR: '.next-face-eval',
  });
  args = ['apps/web/node_modules/next/dist/bin/next', 'dev', 'apps/web', '-p', '3002'];
} else throw new Error('Expected backend or web');
const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
