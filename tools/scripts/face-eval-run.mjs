/** Run dev evaluation commands using configured credentials without printing secrets. */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';

const env = { ...process.env, ...parseEnv(readFileSync('.env', 'utf8')) };
for (const key of [
  'DATABASE_URL',
  'MQTT_URL',
  'FRIGATE_URL',
  'AI_SERVICE_URL',
  'MEDIAMTX_RTSP_URL',
]) {
  if (!env[key]) continue;
  const url = new URL(env[key]);
  if (['postgres', 'mosquitto', 'frigate', 'ai-service', 'mediamtx'].includes(url.hostname)) {
    url.hostname = '127.0.0.1';
    env[key] = url.toString();
  }
}
env.POSTGRES_HOST = '127.0.0.1';
env.REDIS_HOST = '127.0.0.1';
env.PYTHONIOENCODING = 'utf-8';
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Usage: node tools/scripts/face-eval-run.mjs <command> [...args]');
const child = spawn(command, args, { env, stdio: 'inherit', windowsHide: true });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
