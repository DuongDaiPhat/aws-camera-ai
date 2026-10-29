/** Opt-in one-photo live Telegram gate. Private bot/recipient data never enters evidence. */
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';
import YAML from 'yaml';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const project = `camerai-us18-telegram-${process.pid}`;
const output = join(root, 'artifacts/m3/evaluation', project);
const privateDir = join(root, 'artifacts/m3/private', project);
const control = join(privateDir, 'control');
const assets = join(root, 'artifacts/m3/telegram-source-frames-v1');
await mkdir(output, { recursive: true });
await mkdir(control, { recursive: true, mode: 0o700 });
const env = parseEnv(await readFile(join(root, '.env'), 'utf8'));
const recipient = JSON.parse(
  await readFile(join(root, 'artifacts/m3/private/telegram-verified-recipient.json'), 'utf8'),
);
if (!recipient.telegram_linked_at || recipient.telegram_chat_id !== recipient.telegram_user_id)
  throw new Error('Existing verified private-chat association required');
const privateConfig = {
  source: 'existing-verified-application-association',
  token: env.TELEGRAM_BOT_TOKEN,
  secret: env.TELEGRAM_WEBHOOK_SECRET,
  userId: recipient.id,
  fullName: recipient.full_name,
  actorId: recipient.telegram_user_id,
  chatId: recipient.telegram_chat_id,
  linkedAt: recipient.telegram_linked_at,
  jwtSecret: randomBytes(32).toString('hex'),
  internalToken: randomBytes(32).toString('hex'),
};
if (!privateConfig.token || !privateConfig.secret)
  throw new Error('Local Telegram credentials are missing');
function redact(text) {
  for (const value of [
    privateConfig.token,
    privateConfig.secret,
    privateConfig.actorId,
    privateConfig.chatId,
    privateConfig.jwtSecret,
    privateConfig.internalToken,
  ])
    if (value) text = text.split(value).join('[REDACTED]');
  return text;
}
async function api(method, body) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${privateConfig.token}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`HTTP_${response.status}`);
    return data.result;
  } catch (error) {
    throw new Error(
      `Telegram ${method} failed: ${error.cause?.code ?? error.message?.match(/^HTTP_\d+$/)?.[0] ?? error.name}`,
    );
  }
}
const identity = await api('getMe');
if (identity.username?.toLowerCase() !== 'camerai_test_bot')
  throw new Error('Configured bot mismatch');
const chat = await api('getChat', { chat_id: privateConfig.chatId });
if (chat.type !== 'private' || String(chat.id) !== privateConfig.chatId)
  throw new Error('Existing private chat cannot be verified');
const previous = await api('getWebhookInfo');
if (previous.pending_update_count !== 0)
  throw new Error('Existing pending updates require review before changing the webhook');
await writeFile(join(privateDir, 'webhook-backup.json'), JSON.stringify(previous), { mode: 0o600 });
const model = JSON.parse(
  await readFile(join(root, 'services/ai-service/model-manifest.json'), 'utf8'),
).fire.artifact;
const source = JSON.parse(await readFile(join(assets, 'source.json'), 'utf8'));
for (const frame of source.frames)
  if (
    createHash('sha256')
      .update(await readFile(join(assets, frame.file)))
      .digest('hex') !== frame.sha256
  )
    throw new Error('Source frame bytes changed');
await writeFile(
  join(output, 'input.json'),
  JSON.stringify(
    {
      model,
      source,
      bot: identity.username,
      recipientVerifiedFromApplication: true,
      maxPhotoRequests: 1,
      scope:
        'Telegram stage on isolated DB with raw-file frame replay; source application data is read only',
      testConfirmationWaitSeconds: 600,
    },
    null,
    2,
  ),
);
const bind = (sourcePath, target, readOnly = true) => ({
  type: 'bind',
  source: sourcePath,
  target,
  read_only: readOnly,
});
const composeFile = join(output, 'compose.yml');
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const compose = (...args) => docker('compose', '-p', project, '-f', composeFile, ...args);
const port = (service, internal) => compose('port', service, String(internal)).split(':').at(-1);
const stack = {
  services: {
    postgres: {
      image:
        'postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea',
      environment: { POSTGRES_PASSWORD: 'us18-test-only' },
      ports: ['127.0.0.1::5432'],
    },
    mqtt: {
      image: 'eclipse-mosquitto:2',
      volumes: [bind(join(output, 'mosquitto.conf'), '/mosquitto/config/mosquitto.conf')],
    },
    minio: {
      image: 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z',
      command: ['server', '/data'],
      ports: ['127.0.0.1::9000'],
      environment: { MINIO_ROOT_USER: 'us18-test', MINIO_ROOT_PASSWORD: 'us18-test-only-password' },
    },
    ai: {
      image: 'camerai-us18-ai:local',
      build: { context: join(root, 'services/ai-service') },
      ports: ['127.0.0.1::8000'],
      environment: {
        M3_ENABLED: 'true',
        AI_INTERNAL_TOKEN: 'us18-isolated-ai-token-32-characters',
        FIRE_MODEL_PATH: `/app/models/${model.filename}`,
        FIRE_MODEL_SHA256: model.sha256,
        FIRE_MODEL_VERSION: model.modelVersion,
      },
      volumes: [bind(join(root, 'services/ai-service/models'), '/app/models')],
    },
    host: {
      image: 'camerai-us18-orchestrator:local',
      build: { context: root, dockerfile: 'apps/orchestrator/Dockerfile', target: 'development' },
      working_dir: '/workspace',
      entrypoint: ['node'],
      command: [
        '-r',
        './apps/orchestrator/node_modules/ts-node/register',
        'apps/orchestrator/test/fire-telegram-live-host.ts',
      ],
      ports: ['127.0.0.1::3001'],
      environment: {
        FIRE_TELEGRAM_LIVE_GATE: 'isolated',
        TS_NODE_PROJECT: '/workspace/apps/orchestrator/tsconfig.json',
      },
      volumes: [
        bind(join(privateDir, 'config.json'), '/run/us18/private.json'),
        bind(control, '/test-control'),
        bind(assets, '/test-assets'),
        bind(output, '/test-report', false),
      ],
    },
  },
};
await writeFile(
  join(output, 'mosquitto.conf'),
  'listener 1883\nallow_anonymous true\nmax_packet_size 1100000\n',
);
await writeFile(composeFile, YAML.stringify(stack));
async function ready(url, status = 200, timeout = 120000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    try {
      await readFile(join(output, 'failure.json'));
      throw new Error('Isolated Telegram host failed before readiness; inspect sanitized report');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).status === status) return;
    } catch {}
    await delay(500);
  }
  throw new Error('Local gate service did not become ready');
}
let pool,
  tunnel,
  changedWebhook = false,
  restored = false,
  ngrokLog;
try {
  await writeFile(join(privateDir, 'config.json'), JSON.stringify(privateConfig), { mode: 0o600 });
  console.log(`Preparing isolated Telegram gate: ${project}`);
  compose('build', 'host', 'ai');
  compose('up', '-d', 'postgres', 'mqtt', 'minio', 'ai');
  const databaseUrl = `postgresql://postgres:us18-test-only@127.0.0.1:${port('postgres', 5432)}/postgres`;
  pool = new pg.Pool({ connectionString: databaseUrl });
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch {
      if (attempt > 40) throw new Error('Test DB unavailable');
      await delay(500);
    }
  }
  execFileSync(process.execPath, [join(root, 'tools/scripts/migrate.mjs'), 'up'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  await ready(`http://127.0.0.1:${port('ai', 8000)}/health`);
  await ready(`http://127.0.0.1:${port('minio', 9000)}/minio/health/live`);
  compose('up', '-d', 'host');
  const backend = `http://127.0.0.1:${port('host', 3001)}`;
  await ready(`${backend}/api/v1/events`, 401);
  ngrokLog = openSync(join(privateDir, 'ngrok.log'), 'a', 0o600);
  tunnel = spawn(
    process.env.NGROK_BIN || 'ngrok',
    ['http', backend, '--log', 'stdout', '--log-format', 'json'],
    { cwd: root, windowsHide: true, stdio: ['ignore', ngrokLog, ngrokLog] },
  );
  let tunnelError = false;
  tunnel.on('error', () => {
    tunnelError = true;
  });
  let publicUrl;
  const tunnelEnd = performance.now() + 45000;
  while (performance.now() < tunnelEnd) {
    try {
      const response = await fetch('http://127.0.0.1:4040/api/tunnels', {
        signal: AbortSignal.timeout(1000),
      });
      const tunnels = await response.json();
      publicUrl = tunnels.tunnels?.find(
        (item) => item.proto === 'https' && item.config?.addr === backend,
      )?.public_url;
      if (publicUrl) break;
    } catch {}
    if (tunnelError || tunnel.exitCode !== null) break;
    await delay(500);
  }
  if (!publicUrl) throw new Error('Private ngrok startup failed; inspect its local private log');
  const webhookUrl = `${publicUrl}/api/v1/webhooks/telegram`;
  if (previous.url !== webhookUrl) {
    await api('setWebhook', {
      url: webhookUrl,
      secret_token: privateConfig.secret,
      allowed_updates: previous.allowed_updates ?? ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    changedWebhook = true;
  }
  await writeFile(
    join(output, 'ready.json'),
    JSON.stringify(
      {
        prepared: true,
        bot: identity.username,
        callbackHost: new URL(publicUrl).hostname,
        awaitingExplicitSendApproval: true,
        sendControl: join(control, 'send-one.json'),
      },
      null,
      2,
    ),
  );
  console.log(`Telegram gate ready; waiting for explicit one-photo control. Evidence: ${output}`);
  let announced = false;
  const end = performance.now() + 1250000;
  for (;;) {
    try {
      const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
      console.log(
        JSON.stringify({
          eventId: result.eventId,
          finalStatus: result.finalStatus,
          photoAttempts: result.photoAttempts,
          callbackAnswered: result.callbackAnswered,
          captionEdited: result.captionEdited,
        }),
      );
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await readFile(join(output, 'failure.json'));
      throw new Error('Isolated Telegram host failed; no automatic resend');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!announced)
      try {
        const sent = JSON.parse(await readFile(join(output, 'sent.json'), 'utf8'));
        console.log(
          `Photo accepted by Telegram for test event ${sent.eventId}; waiting for the user's Telegram button.`,
        );
        announced = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    if (performance.now() > end) throw new Error('Telegram live-test window expired');
    await delay(1000);
  }
} finally {
  if (changedWebhook) {
    try {
      if (previous.url)
        await api('setWebhook', {
          url: previous.url,
          secret_token: privateConfig.secret,
          allowed_updates: previous.allowed_updates ?? ['message', 'callback_query'],
          drop_pending_updates: false,
        });
      else await api('deleteWebhook', { drop_pending_updates: false });
      restored = true;
    } catch {
      await writeFile(
        join(output, 'webhook-restore-required.json'),
        JSON.stringify({ restoreRequired: true }),
      );
    }
  } else restored = true;
  if (tunnel && tunnel.exitCode === null) {
    const exited = new Promise((resolveExit) => tunnel.once('exit', resolveExit));
    tunnel.kill();
    await Promise.race([exited, delay(5000)]);
  }
  if (ngrokLog !== undefined) closeSync(ngrokLog);
  if (pool) await pool.end();
  try {
    await writeFile(
      join(output, 'containers.log'),
      redact(compose('logs', '--no-color', '--tail', '180')),
    );
  } finally {
    compose('down', '-v', '--remove-orphans');
  }
  if (restored) {
    for (const filename of ['config.json', 'webhook-backup.json', 'ngrok.log'])
      await unlink(join(privateDir, filename)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }
  await writeFile(
    join(output, 'cleanup.json'),
    JSON.stringify({
      testContainersRemoved: true,
      webhookRestored: restored,
      privateConfigurationRemoved: restored,
      tunnelStopRequested: Boolean(tunnel),
    }),
  );
  console.log(`Telegram gate evidence: ${output}`);
}
