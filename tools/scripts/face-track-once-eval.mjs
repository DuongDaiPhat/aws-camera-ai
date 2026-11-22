/** Real-video dev acceptance runner. Secrets and runtime backups stay in ignored artifacts/. */
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
const req = createRequire(resolve('apps/orchestrator/package.json'));
const root = process.cwd();
const out = resolve('docs/test/FACE_TRACK_ONCE_2026-11-22');
const priv = resolve('artifacts/face-track-once-2026-11-22');
for (const d of [out, priv, `${out}/data`, `${out}/evidence`, `${out}/screenshots`])
  mkdirSync(d, { recursive: true });
const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));
const log = (type, data) =>
  appendFileSync(
    `${out}/evidence/pipeline.jsonl`,
    JSON.stringify({ at: new Date().toISOString(), type, ...data }) + '\n',
  );
const fixturePath = `${priv}/fixture.json`;
const fixture = existsSync(fixturePath)
  ? JSON.parse(readFileSync(fixturePath))
  : {
      owner: randomUUID(),
      device: randomUUID(),
      camera: randomUUID(),
      slug: 'face_track_once_20261122',
      email: `track-once-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('base64url'),
      jwtSecret: randomBytes(48).toString('base64url'),
    };
save(fixturePath, fixture);
const action = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { Pool } = req('pg');
const pool = () => new Pool({ connectionString: process.env.DATABASE_URL });
const { ConfigService } = req('@nestjs/config');
const cfg = () => new ConfigService(process.env);
const dbService = (p) => new (req('./dist/database/database.service.js').DatabaseService)(p);
function aws(args) {
  const r = spawnSync('aws', [...args, '--output', 'json', '--no-cli-pager'], {
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout || '{}');
}
function safeTrack(r) {
  if (!r) return null;
  const keys = [
    'trackId',
    'canonicalTrackId',
    'eventId',
    'state',
    'collectionVersion',
    'currentRevision',
    'pendingRevision',
    'firstSeenAt',
    'bestShotWindowStartedAt',
    'lastUpdatedAt',
    'samplesCollected',
    'dispatchedQualityScore',
    'dispatchedAt',
    'lastResultAt',
    'unknownRecheckUsed',
    'undeterminedRetriesUsed',
    'matchedKnownFaceId',
    'matchedPersonName',
    'endedAt',
  ];
  return Object.fromEntries(keys.map((k) => [k, r[k]]));
}
if (action === 'setup') {
  if (!existsSync(`${priv}/background-empty.jpg`)) {
    const extracted = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        '15',
        '-i',
        'local_image/Dataset_2/Videos/known_face_vid5.mp4',
        '-frames:v',
        '1',
        '-update',
        '1',
        `${priv}/background-empty.jpg`,
      ],
      { windowsHide: true },
    );
    if (extracted.status !== 0) throw new Error('Could not extract replay background');
  }
  const p = pool();
  const { hash } = req('argon2');
  await p.query(
    `INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,$2,$3,'Face Track Once QA','CAREGIVER') ON CONFLICT(id) DO NOTHING`,
    [fixture.owner, fixture.email, await hash(fixture.password)],
  );
  await p.query(
    `INSERT INTO devices(id,owner_user_id,name,status) VALUES($1,$2,'Track Once QA','ONLINE') ON CONFLICT(id) DO NOTHING`,
    [fixture.device, fixture.owner],
  );
  await p.query(
    `INSERT INTO cameras(id,device_id,name,slug,rtsp_url,is_enabled) VALUES($1,$2,'Recognize Once QA',$3,$4,true) ON CONFLICT(id) DO UPDATE SET is_enabled=true`,
    [fixture.camera, fixture.device, fixture.slug, `rtsp://mediamtx:8554/${fixture.slug}`],
  );
  await p.query(
    `INSERT INTO camera_sources(camera_id,source_type,rtsp_url,status) VALUES($1,'RTSP',$2,'ONLINE') ON CONFLICT(camera_id) DO UPDATE SET status='ONLINE'`,
    [fixture.camera, `rtsp://mediamtx:8554/${fixture.slug}`],
  );
  await p.query(
    `INSERT INTO camera_frigate_settings(camera_id,max_disappeared_frames,min_initialized_frames) VALUES($1,75,2) ON CONFLICT(camera_id) DO UPDATE SET max_disappeared_frames=75,min_initialized_frames=2`,
    [fixture.camera],
  );
  const prefix = process.env.REKOGNITION_COLLECTION_PREFIX;
  await p.query(
    `INSERT INTO cloud_face_collections(owner_user_id,collection_id,version) VALUES($1,$2,1) ON CONFLICT(owner_user_id) DO NOTHING`,
    [fixture.owner, prefix + fixture.owner],
  );
  const YAML = req('yaml');
  const original = 'infra/frigate/config.yml';
  if (!existsSync(`${priv}/frigate-before.yml`))
    writeFileSync(`${priv}/frigate-before.yml`, readFileSync(original));
  const base = YAML.parse(readFileSync('infra/frigate/config.example.yml', 'utf8'));
  base.ffmpeg.retry_interval = 10;
  base.cameras = {};
  const gen = new (req('./dist/frigate/frigate-config.service.js').FrigateConfigService)(cfg());
  const camera = (await p.query('SELECT * FROM cameras WHERE id=$1', [fixture.camera])).rows[0];
  camera.source_type_val = 'RTSP';
  camera.source_rtsp_url = camera.rtsp_url;
  const generated = gen.generateUpdatedConfig(YAML.stringify(base), {
    camera,
    settings: { max_disappeared_frames: 75, min_initialized_frames: 2 },
  });
  writeFileSync(original, generated);
  const safe = YAML.parse(generated);
  safe.cameras[fixture.slug].ffmpeg.inputs[0].path =
    `rtsp://<internal>@mediamtx:8554/${fixture.slug}`;
  writeFileSync(`${out}/data/frigate-test-config.yml`, YAML.stringify(safe));
  save(`${out}/data/fixture.json`, {
    owner: fixture.owner,
    camera: fixture.camera,
    slug: fixture.slug,
    collection: prefix + fixture.owner,
  });
  await p.end();
  console.log('Created isolated QA owner/camera and generated Frigate 75-frame configuration.');
} else if (action === 'profile') {
  const width = Number(process.argv[3] || 1920),
    height = Number(process.argv[4] || 1080);
  if (
    ![
      [1280, 720],
      [1920, 1080],
    ].some(([w, h]) => width === w && height === h)
  )
    throw Error('Unsupported QA profile');
  const YAML = req('yaml'),
    file = 'infra/frigate/config.yml';
  const c = YAML.parse(readFileSync(file, 'utf8'));
  c.ffmpeg.retry_interval = 10;
  Object.assign(c.cameras[fixture.slug].detect, { width, height });
  writeFileSync(file, YAML.stringify(c));
  c.cameras[fixture.slug].ffmpeg.inputs[0].path = `rtsp://<internal>@mediamtx:8554/${fixture.slug}`;
  writeFileSync(`${out}/data/frigate-test-config.yml`, YAML.stringify(c));
  save(`${priv}/replay-profile.json`, { width, height });
  const p = pool();
  await p.query('UPDATE cameras SET detect_width=$2,detect_height=$3 WHERE id=$1', [
    fixture.camera,
    width,
    height,
  ]);
  await p.query(
    'UPDATE camera_frigate_settings SET detect_width=$2,detect_height=$3 WHERE camera_id=$1',
    [fixture.camera, width, height],
  );
  await p.end();
  log('profile-changed', { width, height });
  console.log(`Configured native replay ${width}x${height}; restart QA Frigate before replay.`);
} else if (action === 'review') {
  // Keep the dev callback available after testing without changing delivered logs.
  Object.assign(process.env, {
    AUTH_PROVIDER: 'jwt',
    JWT_SECRET: fixture.jwtSecret,
    PORT: '3001',
    MQTT_CLIENT_ID: 'face-track-once-qa',
    M2A_ENABLED: 'false',
    M3_ENABLED: 'false',
    FACE_QUALITY_GATE_FAIL_OPEN: 'false',
  });
  req('./dist/main.js');
} else if (action === 'runtime') {
  Object.assign(process.env, {
    AUTH_PROVIDER: 'jwt',
    JWT_SECRET: fixture.jwtSecret,
    PORT: '3001',
    MQTT_CLIENT_ID: 'face-track-once-qa',
    M2A_ENABLED: 'false',
    M3_ENABLED: 'false',
    FACE_QUALITY_GATE_FAIL_OPEN: 'false',
  });
  log('runtime-start', {
    sourceHashes: Object.fromEntries(
      [
        'face-recognition/face-recognition-coordinator.service',
        'face-recognition/track-identity-state.service',
        'frigate/frigate-config.service',
        'media/frigate-media.adapter',
        'events/events.repository',
      ].map((n) => [
        n,
        createHash('sha256')
          .update(readFileSync(`apps/orchestrator/dist/${n}.js`))
          .digest('hex'),
      ]),
    ),
    failOpen: false,
    configuration: req(
      './dist/face-recognition/face-track-optimization.config.js',
    ).readFaceTrackOptimizationConfig(cfg()),
  });
  const mqttEvidence = req('mqtt').connect(process.env.MQTT_URL, {
    clientId: 'face-track-once-evidence',
  });
  mqttEvidence.on('connect', () => mqttEvidence.subscribe('frigate/events'));
  mqttEvidence.on('message', (topic, bytes) => {
    try {
      const message = JSON.parse(bytes.toString());
      if (message.after?.camera === fixture.slug)
        appendFileSync(
          `${out}/evidence/frigate-events.jsonl`,
          JSON.stringify({ at: new Date().toISOString(), topic, message }) + '\n',
        );
    } catch {
      /* Ignore unrelated or malformed telemetry in this evidence-only subscriber. */
    }
  });
  function observeAws(Client, scope) {
    const send = Client.prototype.send;
    Client.prototype.send = function (command, ...args) {
      const input = scope(command.input);
      const result = send.call(this, command, ...args);
      if (!input || !result?.then) return result;
      return result.then(
        (response) => {
          log('aws-sdk', {
            operation: command.constructor.name,
            ...input,
            requestId: response.$metadata?.requestId,
            httpStatus: response.$metadata?.httpStatusCode,
            attempts: response.$metadata?.attempts,
          });
          return response;
        },
        (error) => {
          log('aws-sdk', {
            operation: command.constructor.name,
            ...input,
            error: error.name,
            requestId: error.$metadata?.requestId,
          });
          throw error;
        },
      );
    };
  }
  observeAws(req('@aws-sdk/client-s3').S3Client, (input) =>
    typeof input.Key === 'string' && input.Key.startsWith(`owners/${fixture.owner}/`)
      ? { bucket: input.Bucket, key: input.Key }
      : null,
  );
  observeAws(req('@aws-sdk/client-sqs').SQSClient, (input) => {
    try {
      const message = JSON.parse(input.MessageBody);
      return message.payload?.ownerScopeId === fixture.owner
        ? {
            queue: input.QueueUrl,
            messageType: message.type,
            jobId: message.payload?.jobId,
            eventId: message.correlationId,
          }
        : null;
    } catch {
      return null;
    }
  });
  const { FaceQualityGateClient } = req('./dist/face-recognition/face-quality-gate.client.js');
  const { FaceRecognitionCoordinatorService: C } = req(
    './dist/face-recognition/face-recognition-coordinator.service.js',
  );
  const { TrackIdentityStateService: S } = req(
    './dist/face-recognition/track-identity-state.service.js',
  );
  const { FaceSessionCacheService: Cache } = req(
    './dist/face-recognition/face-session-cache.service.js',
  );
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const context = new AsyncLocalStorage();
  const { FrigateMediaAdapter } = req('./dist/media/frigate-media.adapter.js');
  const pairedCrop = FrigateMediaAdapter.prototype.getTimestampedPersonCrop;
  FrigateMediaAdapter.prototype.getTimestampedPersonCrop = async function (...args) {
    const buffer = await pairedCrop.apply(this, args);
    if (context.getStore())
      log('timestamped-crop', {
        ...context.getStore(),
        available: Boolean(buffer),
        imageSha256: buffer ? createHash('sha256').update(buffer).digest('hex') : null,
      });
    return buffer;
  };
  let state,
    cache,
    coordinator,
    currentCase = 'setup';
  const handle = C.prototype.handleTrackEvent;
  C.prototype.handleTrackEvent = async function (input) {
    if (input.after.camera !== fixture.slug) return handle.call(this, input);
    state = this.stateService;
    cache = this.sessionCache;
    coordinator = this;
    return context.run({ case: currentCase, trackId: input.after.id }, async () => {
      const before = safeTrack(state.get(input.after.camera, input.after.id));
      await handle.call(this, input);
      log('track', {
        case: currentCase,
        messageType: input.messageType,
        box: input.after.box,
        before,
        after: safeTrack(state.get(input.after.camera, input.after.id)),
        metrics: state.getMetrics(),
      });
    });
  };
  const assess = FaceQualityGateClient.prototype.assess;
  FaceQualityGateClient.prototype.assess = async function (buffer) {
    const result = await assess.call(this, buffer);
    const { embeddingBase64, ...safe } = result;
    log('assess', {
      ...context.getStore(),
      ...safe,
      imageBytes: buffer.length,
      imageSha256: createHash('sha256').update(buffer).digest('hex'),
    });
    if (context.getStore()) {
      const id = `${context.getStore().trackId}-${Date.now()}`;
      writeFileSync(`${priv}/${id}.jpg`, buffer);
      log('crop', {
        ...context.getStore(),
        path: `artifacts/face-track-once-2026-11-22/${id}.jpg`,
      });
    }
    return result;
  };
  const result = C.prototype.onRecognitionResult;
  C.prototype.onRecognitionResult = async function (r) {
    await result.call(this, r);
    log('result', { case: currentCase, ...r });
  };
  const dispatch = C.prototype.dispatchBestShot;
  C.prototype.dispatchBestShot = async function (r, c, retry, now) {
    log('dispatch', {
      case: currentCase,
      trackId: r.trackId,
      eventId: r.eventId,
      qualityScore: c.qualityScore,
      capturedAt: c.capturedAt,
      firstSeenAt: r.firstSeenAt,
      retry,
    });
    return dispatch.call(this, r, c, retry, now);
  };
  createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    let data = '';
    for await (const c of request) data += c;
    const command = JSON.parse(data || '{}');
    if (command.case) currentCase = command.case;
    if (command.reset && state) {
      state.tracks.clear();
      state.eventIdToKey.clear();
      cache.clear();
    }
    if (typeof command.spatialReidEnabled === 'boolean' && coordinator && cache) {
      coordinator.optConfig.spatialReidEnabled = command.spatialReidEnabled;
      cache.optConfig.spatialReidEnabled = command.spatialReidEnabled;
      log('qa-flag', { spatialReidEnabled: command.spatialReidEnabled });
    }
    const snapshots = state ? [...state.tracks.values()].map(safeTrack) : [];
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({ case: currentCase, metrics: state?.getMetrics(), tracks: snapshots }),
    );
  }).listen(18081, '127.0.0.1');
  req('./dist/main.js');
} else if (action === 'web') {
  Object.assign(process.env, {
    NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001/api/v1',
    FACE_EVAL_NEXT_DIST_DIR: '.next-face-eval',
  });
  const child = spawn(
    process.execPath,
    ['apps/web/node_modules/next/dist/bin/next', 'dev', 'apps/web', '-p', '3002'],
    { env: process.env, stdio: 'inherit', windowsHide: true },
  );
  child.on('exit', (code) => process.exit(code ?? 1));
} else if (action === 'enroll' || action === 'delete') {
  while (existsSync(`${priv}/hold`) && process.env.FACE_EVAL_IGNORE_HOLD !== 'true')
    await sleep(1000);
  const p = pool(),
    db = dbService(p),
    { KnownFacesRepository } = req('./dist/known-faces/known-faces.repository.js');
  const { KnownFacesService } = req('./dist/known-faces/known-faces.service.js');
  const { RekognitionFaceEnrollmentService } = req(
    './dist/known-faces/rekognition-face-enrollment.service.js',
  );
  const rek = new RekognitionFaceEnrollmentService(cfg()),
    repo = new KnownFacesRepository(db),
    svc = new KnownFacesService(repo, {}, {}, cfg(), rek);
  const who = process.argv[3] || 'A';
  if (action === 'delete') {
    const item = (await repo.list(fixture.owner)).find((x) => x.personName === `Person ${who} QA`);
    if (item) await svc.remove(fixture.owner, item.id, null, null);
    log('enrollment-delete', { who, id: item?.id });
  } else {
    const names =
      who === 'A'
        ? [
            'known_face.jpg',
            'known_face_left.jpg',
            'known_face_right.jpg',
            'known_face_tilt_down.jpg',
            'known_face_with_glass.jpg',
          ]
        : [
            'stranger_face.jpg',
            'stranger_face_left.jpg',
            'stranger_face_right.jpg',
            'stranger_face_tilt_down.jpg',
          ];
    const files = names.map((n) => {
      const buffer = readFileSync(`local_image/Dataset_2/Faces/${n}`);
      return { buffer, size: buffer.length };
    });
    const item = await svc.create(
      fixture.owner,
      { personName: `Person ${who} QA`, relationship: 'Dataset 2 acceptance test' },
      files,
    );
    log('enrollment', { who, result: item });
    console.log(JSON.stringify(item));
  }
  save(
    `${out}/data/collection.json`,
    (await p.query('SELECT * FROM cloud_face_collections WHERE owner_user_id=$1', [fixture.owner]))
      .rows,
  );
  rek.onModuleDestroy();
  await p.end();
} else if (action === 'play') {
  while (existsSync(`${priv}/hold-retest`)) await sleep(1000);
  while (existsSync(`${priv}/hold`) && process.env.FACE_EVAL_IGNORE_HOLD !== 'true')
    await sleep(1000);
  const name = process.argv[3],
    label = process.argv[4] || name;
  const video = resolve('local_image/Dataset_2/Videos', name);
  if (!existsSync(video)) throw Error('Video missing');
  const reset = process.argv[5] !== 'keep-cache';
  const before = await fetch('http://127.0.0.1:18081', {
    method: 'POST',
    body: JSON.stringify({ case: label, reset }),
  }).then((r) => r.json());
  const started = new Date().toISOString();
  const profile = existsSync(`${priv}/replay-profile.json`)
    ? JSON.parse(readFileSync(`${priv}/replay-profile.json`))
    : { width: 1280, height: 720 };
  const preRollSeconds = Number(process.env.FACE_EVAL_PREROLL_SECONDS || 10);
  if (![10, 30].includes(preRollSeconds)) throw Error('Unsupported replay pre-roll');
  log('video-start', {
    case: label,
    video: name,
    reset,
    background: 'known_face_vid5.mp4 @ 15s',
    preRollSeconds,
    postRollSeconds: 20,
    replayResolution: profile,
  });
  const rtsp = new URL(`rtsp://127.0.0.1:8554/${fixture.slug}`);
  rtsp.username = process.env.MEDIAMTX_PUBLISH_USERNAME || 'cam-internal';
  rtsp.password = process.env.MEDIAMTX_PUBLISH_PASSWORD || 'local-dev-password';
  const background = resolve(priv, 'background-empty.jpg');
  const normalize = `scale=${profile.width}:${profile.height},setsar=1,fps=15,format=yuv420p,setpts=PTS-STARTPTS`;
  const graph = `[0:v]${normalize}[pre];[1:v]${normalize}[video];[2:v]${normalize}[post];[pre][video][post]concat=n=3:v=1:a=0,realtime[replay]`;
  const child = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-loop',
      '1',
      '-framerate',
      '15',
      '-t',
      String(preRollSeconds),
      '-i',
      background,
      '-i',
      video,
      '-loop',
      '1',
      '-framerate',
      '15',
      '-t',
      '20',
      '-i',
      background,
      '-filter_complex_threads',
      '1',
      '-filter_complex',
      graph,
      '-map',
      '[replay]',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '18',
      '-tune',
      'zerolatency',
      '-threads',
      '2',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '15',
      '-f',
      'rtsp',
      '-rtsp_transport',
      'tcp',
      rtsp.toString(),
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  child.stderr.on('data', (b) =>
    appendFileSync(
      `${out}/evidence/ffmpeg.txt`,
      b.toString().replaceAll(rtsp.toString(), '<qa-rtsp>'),
    ),
  );
  const code = await new Promise((r) => child.on('exit', r));
  // A real room background avoids black-to-scene motion recalibration at clip boundaries.
  await sleep(3000);
  const after = await fetch('http://127.0.0.1:18081', { method: 'POST', body: '{}' }).then((r) =>
    r.json(),
  );
  const p = pool();
  const events = (
    await p.query(
      `SELECT e.*,k.person_name FROM events e LEFT JOIN known_faces k ON k.id=e.matched_known_face_id WHERE e.camera_id=$1 AND e.detected_at >= $2 ORDER BY e.detected_at`,
      [fixture.camera, started],
    )
  ).rows;
  const jobs = (
    await p.query(
      `SELECT j.id,j.event_id,j.revision,j.status,j.attempts,j.last_error,j.cached_result,j.envelope FROM cloud_jobs j JOIN events e ON e.id=j.event_id WHERE e.camera_id=$1 AND e.detected_at >= $2 ORDER BY j.created_at`,
      [fixture.camera, started],
    )
  ).rows;
  const record = {
    case: label,
    video: name,
    startedAt: started,
    endedAt: new Date().toISOString(),
    ffmpegExitCode: code,
    before,
    after,
    events,
    jobs,
  };
  save(`${out}/data/${label.replace(/[^\w-]/g, '_')}.json`, record);
  await p.end();
  console.log(
    JSON.stringify({
      case: label,
      events: events.map((e) => ({
        id: e.id,
        status: e.person_status,
        type: e.event_type,
        name: e.person_name,
      })),
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, revision: j.revision })),
    }),
  );
} else if (action === 'aws-config') {
  const name = 'camerai-s4-dev-face',
    config = aws(['lambda', 'get-function-configuration', '--function-name', name]);
  if (!existsSync(`${priv}/lambda-config-before.json`))
    save(`${priv}/lambda-config-before.json`, config);
  const cloudlog = readFileSync(`${out}/evidence/cloudflared.txt`, 'utf8');
  const url = cloudlog.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)[0] + '/api/v1';
  const vars = {
    ...config.Environment.Variables,
    INTERNAL_API_BASE_URL: url,
    REKOGNITION_SKIP_DETECT_FACES: 'true',
  };
  if (vars.INTERNAL_SERVICE_TOKEN !== process.env.INTERNAL_SERVICE_TOKEN)
    throw Error('Dev internal service token mismatch');
  save(`${priv}/lambda-update.json`, {
    FunctionName: name,
    RevisionId: config.RevisionId,
    Environment: { Variables: vars },
  });
  aws([
    'lambda',
    'update-function-configuration',
    '--cli-input-json',
    `file://${priv}/lambda-update.json`,
  ]);
  aws(['lambda', 'wait', 'function-updated-v2', '--function-name', name]);
  save(`${out}/data/lambda-config.json`, {
    name,
    previousUrl: config.Environment.Variables.INTERNAL_API_BASE_URL,
    url,
    skipDetect: true,
    at: new Date().toISOString(),
  });
  const code = aws(['lambda', 'get-function', '--function-name', name]);
  writeFileSync(
    `${priv}/lambda-before.zip`,
    Buffer.from(await (await fetch(code.Code.Location)).arrayBuffer()),
  );
  console.log(
    'Preserved Lambda configuration/package and updated HTTPS callback (all other variables retained).',
  );
} else if (action === 'aws-deploy') {
  const name = 'camerai-s4-dev-face';
  const r = aws([
    'lambda',
    'update-function-code',
    '--function-name',
    name,
    '--zip-file',
    `fileb://${priv}/lambda-test.zip`,
  ]);
  aws(['lambda', 'wait', 'function-updated-v2', '--function-name', name]);
  save(`${out}/data/lambda-deploy.json`, {
    functionName: name,
    codeSha256: r.CodeSha256,
    lastModified: r.LastModified,
  });
  console.log('Deployed branch handler to dev Lambda.');
} else if (action === 'diagnose-local') {
  const label = process.argv[3];
  const trace = readFileSync(`${out}/evidence/pipeline.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const rows = trace.filter((row) => label.split(',').includes(row.case));
  const { FaceQualityGateClient } = req('./dist/face-recognition/face-quality-gate.client.js');
  const { decodeEmbeddingBase64, cosineSimilarity, computeAppearanceSignature } = req(
    './dist/face-recognition/face-session-cache.service.js',
  );
  const gate = new FaceQualityGateClient(cfg());
  const samples = [];
  for (const dispatched of rows.filter((row) => row.type === 'dispatch')) {
    const index = rows.findIndex(
      (row) =>
        row.type === 'assess' &&
        row.trackId === dispatched.trackId &&
        row.passed &&
        row.qualityScore === dispatched.qualityScore,
    );
    const assessed = rows[index];
    const crop = rows
      .slice(index + 1)
      .find((row) => row.type === 'crop' && row.trackId === dispatched.trackId);
    if (!assessed || !crop) continue;
    const buffer = readFileSync(crop.path);
    if (createHash('sha256').update(buffer).digest('hex') !== assessed.imageSha256)
      throw Error('Crop digest mismatch');
    const current = await gate.assess(buffer);
    samples.push({
      trackId: dispatched.trackId,
      imageSha256: assessed.imageSha256,
      qualityScore: current.qualityScore,
      embedding: current.embeddingBase64
        ? decodeEmbeddingBase64(current.embeddingBase64, current.embeddingDim)
        : null,
      appearance: await computeAppearanceSignature(buffer),
    });
  }
  const pairs = [];
  for (let i = 0; i < samples.length; i++)
    for (let j = i + 1; j < samples.length; j++) {
      const a = samples[i],
        b = samples[j];
      pairs.push({
        firstTrackId: a.trackId,
        secondTrackId: b.trackId,
        sfaceCosine: a.embedding && b.embedding ? cosineSimilarity(a.embedding, b.embedding) : null,
        appearanceCosine:
          a.appearance && b.appearance ? cosineSimilarity(a.appearance, b.appearance) : null,
      });
    }
  const data = {
    case: label,
    analysisAt: new Date().toISOString(),
    method: 'Re-assess the exact dispatch crop on the same local AI service; no AWS request',
    samples: samples.map(({ embedding, appearance, ...safe }) => safe),
    pairs,
  };
  save(`${out}/data/${label}-local-analysis.json`, data);
  console.log(JSON.stringify(data));
} else if (action === 'export') {
  const p = pool();
  const result = await p.query(
    `SELECT e.id,e.track_id,e.event_type,e.person_status,e.matched_known_face_id,e.ai_model_version,e.ai_processed_at,e.ai_results,e.detected_at,e.status FROM events e WHERE e.camera_id=$1 ORDER BY e.detected_at`,
    [fixture.camera],
  );
  save(`${out}/data/events-current.json`, result.rows);
  const tables = await p.query(
    `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('cloud_result_receipts','cloud_jobs','cloud_face_collections') ORDER BY table_name,ordinal_position`,
  );
  save(`${out}/data/cloud-schema.json`, tables.rows);
  const faces = await p.query(
    'SELECT id,person_name,created_at,updated_at FROM known_faces WHERE owner_user_id=$1 ORDER BY created_at',
    [fixture.owner],
  );
  save(`${out}/data/known-faces-current.json`, faces.rows);
  save(
    `${out}/data/collection-current.json`,
    (await p.query('SELECT * FROM cloud_face_collections WHERE owner_user_id=$1', [fixture.owner]))
      .rows,
  );
  await p.end();
  console.log(`Exported ${result.rows.length} scoped event records and active fixture enrollment.`);
} else if (action === 'cloudwatch') {
  const since = process.argv[3] || '2026-11-22T00:00:00+07:00';
  const data = aws([
    'logs',
    'filter-log-events',
    '--log-group-name',
    '/aws/lambda/camerai-s4-dev-face',
    '--start-time',
    String(Date.parse(since)),
  ]);
  save(`${out}/evidence/cloudwatch.json`, data);
  writeFileSync(
    `${out}/evidence/cloudwatch.txt`,
    data.events.map((e) => `${new Date(e.timestamp).toISOString()} ${e.message}`).join('\n'),
  );
  console.log(
    `Saved ${data.events.length} CloudWatch log records; CLI automatic pagination enabled.`,
  );
} else
  throw Error(
    'setup | runtime | web | enroll [A|B] | delete [A|B] | play <video> [label] [keep-cache] | aws-config | aws-deploy | cloudwatch [since]',
  );
