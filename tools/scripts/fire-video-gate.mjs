/** Isolated raw-video integration gate. No application .env, data, or outgoing notifications. */
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import pg from 'pg';
import { initialFireHealth, verifyFireRecovery } from './fire-recovery-check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = process.argv[2];
if (!source) throw new Error('Usage: node tools/scripts/fire-video-gate.mjs <raw-video.mp4>');
const manualReview = process.argv.includes('--manual-review');
const review = manualReview || process.argv.includes('--review');
const recovery = process.argv.includes('--recovery');
const rtsp = recovery || process.argv.includes('--rtsp');
if (review && recovery) throw new Error('Run browser review and recovery gates separately');
const reviewMinutesIndex = process.argv.indexOf('--review-minutes');
const reviewMinutes =
  reviewMinutesIndex < 0 ? (manualReview ? 20 : 5) : Number(process.argv[reviewMinutesIndex + 1]);
if (!Number.isSafeInteger(reviewMinutes) || reviewMinutes < 1 || reviewMinutes > 60)
  throw new Error('--review-minutes must be an integer between 1 and 60');
if (reviewMinutesIndex >= 0 && !review)
  throw new Error('--review-minutes requires --review or --manual-review');
const reviewWaitMs = reviewMinutes * 60_000;
const video = resolve(source);
const project = `camerai-us18-video-${process.pid}`;
const output = join(root, 'artifacts/m3/evaluation', project);
await mkdir(output, { recursive: true });
const composeFile = join(output, 'compose.yml');
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const compose = (...args) => docker('compose', '-p', project, '-f', composeFile, ...args);
const bind = (sourcePath, target, readOnly = true) => ({
  type: 'bind',
  source: sourcePath,
  target,
  read_only: readOnly,
});
const port = (service, internal) => compose('port', service, String(internal)).split(':').at(-1);
async function ready(url, attempts = 150, expectedStatus = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok || response.status === expectedStatus) return;
    } catch {
      /* Services are still starting; bounded retries below. */
    }
    await setTimeout(1000);
  }
  throw new Error(`Service did not become ready: ${url}`);
}

const config = YAML.parse(await readFile(join(root, 'infra/frigate/config.example.yml'), 'utf8'));
config.auth = { enabled: false };
config.database.path = '/config/frigate.db';
config.mqtt.host = 'mqtt';
config.logger = { default: 'warning' };
config.ffmpeg.input_args = rtsp ? 'preset-rtsp-restream' : '-re -stream_loop -1';
config.record.continuous.days = 1;
config.cameras = {
  cam_fire: {
    enabled: true,
    detect: { width: 1280, height: 720, fps: 5 },
    ffmpeg: {
      inputs: [
        {
          path: rtsp ? 'rtsp://mediamtx:8554/cam_fire' : '/test-input/bucket11.mp4',
          roles: ['detect', 'record'],
        },
      ],
    },
  },
};
await writeFile(join(output, 'frigate.yml'), YAML.stringify(config));
await writeFile(
  join(output, 'mediamtx.yml'),
  YAML.stringify({
    logLevel: 'warn',
    rtspAddress: ':8554',
    paths: { cam_fire: { source: 'publisher' } },
  }),
);
await writeFile(
  join(output, 'mosquitto.conf'),
  'listener 1883\nallow_anonymous true\nmax_packet_size 1100000\n',
);
const manifest = JSON.parse(
  await readFile(join(root, 'services/ai-service/model-manifest.json'), 'utf8'),
);
const model = manifest.fire.artifact;
const modelBytes = await readFile(join(root, 'services/ai-service/models', model.filename));
if (createHash('sha256').update(modelBytes).digest('hex') !== model.sha256)
  throw new Error('Staged model differs from the registered integration candidate');
const contractBytes = await readFile(
  join(root, 'services/ai-service/models', model.filename.replace(/\.onnx$/u, '.contract.json')),
);
const contract = JSON.parse(contractBytes);
if (
  contract.modelSha256 !== model.sha256 ||
  contract.predictionMode !== model.predictionMode ||
  contract.outputConfidenceFloor !== model.outputConfidenceFloor
)
  throw new Error('Staged deployment contract differs from the registered model');
await writeFile(
  join(output, 'input.json'),
  JSON.stringify(
    {
      video,
      videoSha256: createHash('sha256')
        .update(await readFile(video))
        .digest('hex'),
      model,
      modelContract: contract,
      modelContractSha256: createHash('sha256').update(contractBytes).digest('hex'),
      transport: rtsp ? 'RTSP via MediaMTX' : 'Frigate file input',
      browserReview: review,
      manualBrowserReview: manualReview,
      reviewMinutes: review ? reviewMinutes : null,
      recoveryGate: recovery,
      limitations: [
        'Single user-provided clip; source URL/holdout independence not verified',
        'No external notification delivery',
      ],
    },
    null,
    2,
  ),
);
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
      ports: ['127.0.0.1::1883'],
      volumes: [bind(join(output, 'mosquitto.conf'), '/mosquitto/config/mosquitto.conf')],
    },
    minio: {
      image: 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z',
      command: ['server', '/data'],
      ports: ['127.0.0.1::9000'],
      environment: {
        MINIO_ROOT_USER: 'us18-test',
        MINIO_ROOT_PASSWORD: 'us18-test-only-password',
      },
    },
    ai: {
      build: { context: join(root, 'services/ai-service') },
      image: 'camerai-us18-ai:local',
      ports: ['127.0.0.1::8000'],
      environment: {
        M3_ENABLED: 'true',
        AI_INTERNAL_TOKEN: 'us18-isolated-ai-token-32-characters',
        FIRE_MODEL_PATH: `/app/models/${model.filename}`,
        FIRE_MODEL_SHA256: model.sha256,
        FIRE_MODEL_VERSION: model.modelVersion,
        FIRE_CPU_THREADS: '2',
      },
      volumes: [bind(join(root, 'services/ai-service/models'), '/app/models')],
    },
    frigate: {
      image: 'ghcr.io/blakeblackshear/frigate:0.18.0',
      shm_size: '256mb',
      ports: ['127.0.0.1::5000'],
      depends_on: ['mqtt'],
      environment: { FRIGATE_FIRE_FRAMES_ENABLED: 'true', FIRE_SAMPLE_FPS: '5' },
      volumes: [
        bind(join(output, 'frigate.yml'), '/config/config.yml', false),
        bind(video, '/test-input/bucket11.mp4'),
        bind(
          join(root, 'infra/frigate/frame-metadata/bridge.py'),
          '/opt/camerai-frame-metadata/bridge.py',
        ),
        bind(
          join(root, 'infra/frigate/frame-metadata/fire_publisher.py'),
          '/opt/camerai-frame-metadata/fire_publisher.py',
        ),
        bind(
          join(root, 'infra/frigate/frame-metadata/service'),
          '/etc/s6-overlay/s6-rc.d/camerai-frames',
        ),
        bind(
          join(root, 'infra/frigate/frame-metadata/enabled'),
          '/etc/s6-overlay/s6-rc.d/user/contents.d/camerai-frames',
        ),
      ],
    },
    gate: {
      build: { context: root, dockerfile: 'apps/orchestrator/Dockerfile', target: 'development' },
      image: 'camerai-us18-orchestrator:local',
      working_dir: '/workspace',
      entrypoint: ['node'],
      command: [
        'apps/orchestrator/node_modules/jest/bin/jest.js',
        '--config',
        'apps/orchestrator/jest.config.js',
        '--runInBand',
        '--testRegex',
        'fire-video\\.integration\\.spec\\.ts$',
      ],
      environment: {
        FIRE_VIDEO_DATABASE_URL: 'postgresql://postgres:us18-test-only@postgres:5432/postgres',
        FIRE_VIDEO_AI_URL: 'http://ai:8000',
        FIRE_VIDEO_MQTT_URL: 'mqtt://mqtt:1883',
        FIRE_VIDEO_MINIO_URL: 'http://minio:9000',
        FIRE_VIDEO_FRIGATE_URL: 'http://frigate:5000',
        FIRE_VIDEO_REPORT_DIR: '/test-report',
      },
      volumes: [bind(output, '/test-report', false)],
    },
  },
};
if (rtsp) {
  stack.services.mediamtx = {
    image:
      'bluenviron/mediamtx@sha256:19fddade8d6110a3d718ac0045681fbeba344ae563a066205fe5929a87f7582f',
    volumes: [bind(join(output, 'mediamtx.yml'), '/mediamtx.yml')],
  };
  stack.services.publisher = {
    image: 'camerai-us18-orchestrator:local',
    entrypoint: ['ffmpeg'],
    command: [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'warning',
      '-re',
      '-i',
      '/test-input/bucket11.mp4',
      '-an',
      '-c:v',
      'copy',
      '-f',
      'rtsp',
      '-rtsp_transport',
      'tcp',
      'rtsp://mediamtx:8554/cam_fire',
    ],
    depends_on: ['mediamtx'],
    restart: 'on-failure',
    volumes: [bind(recovery ? join(output, 'fire-loop.mp4') : video, '/test-input/bucket11.mp4')],
  };
  if (recovery) stack.services.publisher.command.splice(5, 0, '-stream_loop', '-1');
}
if (recovery) {
  stack.services.gate.command = [
    '-r',
    './apps/orchestrator/node_modules/ts-node/register',
    'apps/orchestrator/test/fire-runtime-host.ts',
  ];
  Object.assign(stack.services.gate.environment, {
    FIRE_RUNTIME_GATE: 'isolated',
    TS_NODE_PROJECT: '/workspace/apps/orchestrator/tsconfig.json',
  });
}
if (review || recovery) stack.services.gate.ports = ['127.0.0.1::3001'];
if (review) {
  Object.assign(stack.services.gate.environment, {
    FIRE_VIDEO_REVIEW: 'true',
    FIRE_VIDEO_MANUAL_REVIEW: String(manualReview),
    FIRE_VIDEO_REVIEW_WAIT_MS: String(reviewWaitMs),
  });
  stack.services.web = {
    build: { context: root, dockerfile: 'apps/web/Dockerfile', target: 'development' },
    image: 'camerai-us18-web:local',
    ports: ['127.0.0.1::3000'],
    environment: { NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' },
  };
}
await writeFile(composeFile, YAML.stringify(stack));

async function reviewGate() {
  const gateId = compose('ps', '-q', 'gate');
  const logs = spawn('docker', ['logs', '--follow', gateId], { stdio: 'inherit' });
  const deadline = performance.now() + reviewWaitMs + 240000;
  let evidenceAnnounced = false;
  try {
    while (performance.now() < deadline) {
      if (manualReview && !evidenceAnnounced) {
        try {
          const { eventId } = JSON.parse(await readFile(join(output, 'review-ready.json'), 'utf8'));
          console.log(
            `Manual review evidence ready: ${eventId}. Inspect the web page before confirming.`,
          );
          evidenceAnnounced = true;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      const state = docker('inspect', '--format', '{{.State.Status}} {{.State.ExitCode}}', gateId);
      if (!state.startsWith('running')) {
        if (state !== 'exited 0') throw new Error(`Browser integration gate ${state}`);
        return;
      }
      await setTimeout(1000);
    }
    throw new Error('Browser integration gate timed out');
  } finally {
    logs.kill();
  }
}

let pool;
try {
  console.log(`Starting isolated US-18 stack: ${project}`);
  compose('build', 'gate');
  if (recovery) {
    docker(
      'run',
      '--rm',
      '--entrypoint',
      'ffmpeg',
      '--mount',
      `type=bind,source=${video},target=/input.mp4,readonly`,
      '--mount',
      `type=bind,source=${output},target=/output`,
      'camerai-us18-orchestrator:local',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      '40',
      '-i',
      '/input.mp4',
      '-t',
      '20',
      '-an',
      '-c:v',
      'copy',
      '/output/fire-loop.mp4',
    );
    await writeFile(
      join(output, 'fire-loop.json'),
      JSON.stringify(
        {
          sourceSha256: createHash('sha256')
            .update(await readFile(video))
            .digest('hex'),
          derivedSha256: createHash('sha256')
            .update(await readFile(join(output, 'fire-loop.mp4')))
            .digest('hex'),
          startSeconds: 40,
          durationSeconds: 20,
          purpose:
            'Continuous positive input for restart/dedup checks, not an independent quality sample',
        },
        null,
        2,
      ),
    );
  }
  if (review) compose('build', 'web');
  compose('up', '-d', '--build', 'postgres', 'mqtt', 'minio', 'ai');
  const databaseUrl = `postgresql://postgres:us18-test-only@127.0.0.1:${port('postgres', 5432)}/postgres`;
  pool = new pg.Pool({ connectionString: databaseUrl });
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (error) {
      if (attempt >= 40) throw error;
      await setTimeout(1000);
    }
  }
  execFileSync(process.execPath, [join(root, 'tools/scripts/migrate.mjs'), 'up'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  const aiUrl = `http://127.0.0.1:${port('ai', 8000)}`;
  const minioUrl = `http://127.0.0.1:${port('minio', 9000)}`;
  await Promise.all([ready(`${aiUrl}/health`), ready(`${minioUrl}/minio/health/live`)]);
  if (review || recovery) {
    stack.services.gate.environment.FIRE_VIDEO_PUBLIC_MINIO_URL = minioUrl;
    await writeFile(composeFile, YAML.stringify(stack));
    compose('up', '-d', 'gate');
    const api = `http://127.0.0.1:${port('gate', 3001)}`;
    await ready(`${api}/api/v1/events`, 150, 401);
    if (recovery) await initialFireHealth(api, output);
    if (review) {
      stack.services.web.environment.NEXT_PUBLIC_API_BASE_URL = `${api}/api/v1`;
      await writeFile(composeFile, YAML.stringify(stack));
      compose('up', '-d', 'web');
      const web = `http://127.0.0.1:${port('web', 3000)}`;
      await ready(`${web}/login`);
      await writeFile(
        join(output, 'browser-review.json'),
        JSON.stringify(
          {
            web,
            api,
            email: 'us18-review@example.test',
            password: 'US18-local-review-only!',
            reportDir: output,
            mode: manualReview ? 'manual' : 'automated',
            reviewMinutes,
          },
          null,
          2,
        ),
      );
      console.log(`Browser review: ${web} (isolated test account in browser-review.json)`);
      console.log(`Review details: ${join(output, 'browser-review.json')}`);
      if (manualReview)
        console.log(
          `Manual review: inspect the snapshot/boxes/clip, then confirm or close the event on the dashboard. The review window is ${reviewMinutes} minutes after evidence is ready; cleanup follows confirmation.`,
        );
    }
  }
  if (rtsp) compose('up', '-d', 'mediamtx', 'publisher');
  compose('up', '-d', 'frigate');
  const frigateUrl = `http://127.0.0.1:${port('frigate', 5000)}`;
  await ready(`${frigateUrl}/api/version`);
  await writeFile(join(output, 'images.json'), compose('images', '--format', 'json'));
  console.log(
    'Frigate and ONNX ready; running real MQTT/HTTP/DB/storage/escalation/API/SSE checks.',
  );
  if (recovery)
    await verifyFireRecovery({
      api: () => `http://127.0.0.1:${port('gate', 3001)}`,
      output,
      compose,
      pool,
      root,
      mqttPort: port('mqtt', 1883),
      minioPort: port('minio', 9000),
    });
  else if (review) await reviewGate();
  else
    await new Promise((resolveTest, reject) => {
      const child = spawn(
        'docker',
        ['compose', '-p', project, '-f', composeFile, 'run', '--rm', '--no-deps', 'gate'],
        { cwd: root, stdio: 'inherit' },
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolveTest() : reject(new Error(`Video gate exited ${code}`)),
      );
    });
} finally {
  if (pool) await pool.end();
  try {
    await writeFile(join(output, 'containers.log'), compose('logs', '--no-color', '--tail', '300'));
  } finally {
    compose('down', '-v', '--remove-orphans');
  }
  console.log(`US-18 evidence: ${output}`);
}
