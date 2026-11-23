/** Real Frigate/bridge/coordinator/AI crop evaluation. Recognition sink is local: no AWS calls.
 * Run through face-eval-run.mjs. prepare -> start Frigate/restart AI -> run -> stop Frigate -> restore.
 */
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
const req = createRequire(resolve('apps/orchestrator/package.json'));
const out = resolve(
  process.env.FACE_BEST_SHOT_LIVE_OUTPUT || 'docs/test/FACE_BEST_SHOT_2026-11-23/live',
);
const priv = resolve('artifacts/face-best-shot-live');
for (const dir of [out, priv, `${out}/crops`]) mkdirSync(dir, { recursive: true });
const slug = 'face_best_shot_20261123';
const configFile = resolve('infra/frigate/config.yml');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const action = process.argv[2];
if (action === 'prepare') {
  if (existsSync(`${priv}/prepared.json`)) throw Error('Restore the previous live fixture first');
  writeFileSync(`${priv}/config-before.yml`, readFileSync(configFile));
  const YAML = req('yaml');
  const config = YAML.parse(
    readFileSync('docs/test/FACE_TRACK_ONCE_2026-11-22/data/frigate-test-config.yml', 'utf8'),
  );
  const camera = Object.values(config.cameras)[0];
  const source = new URL(`rtsp://mediamtx:8554/${slug}`);
  source.username = process.env.MEDIAMTX_PUBLISH_USERNAME || 'cam-internal';
  source.password = process.env.MEDIAMTX_PUBLISH_PASSWORD || 'local-dev-password';
  camera.ffmpeg.inputs[0].path = source.toString();
  config.cameras = { [slug]: camera };
  const bytes = Buffer.from(YAML.stringify(config));
  writeFileSync(configFile, bytes);
  save(`${priv}/prepared.json`, { sha256: hash(bytes) });
  console.log('Prepared isolated native 1080p/5 FPS camera; previous configuration backed up.');
} else if (action === 'restore') {
  const expected = JSON.parse(readFileSync(`${priv}/prepared.json`));
  if (hash(readFileSync(configFile)) !== expected.sha256)
    throw Error('Config changed externally; refusing to overwrite');
  writeFileSync(configFile, readFileSync(`${priv}/config-before.yml`));
  const { unlinkSync } = await import('node:fs');
  unlinkSync(`${priv}/prepared.json`);
  console.log('Restored previous Frigate configuration.');
} else if (action === 'run') {
  // This narrowly scoped QA endpoint replaces the absent dev backend only for
  // the temporary MediaMTX override. It accepts this camera and internal credentials.
  const auth = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4096) break;
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const allowed =
      request.url === '/api/v1/mediamtx/authorize' &&
      payload.path === slug &&
      ['read', 'publish'].includes(payload.action) &&
      payload.user === (process.env.MEDIAMTX_PUBLISH_USERNAME || 'cam-internal') &&
      payload.password === (process.env.MEDIAMTX_PUBLISH_PASSWORD || 'local-dev-password');
    response.writeHead(allowed ? 200 : 403).end();
  });
  await new Promise((done, reject) => {
    auth.once('error', reject);
    auth.listen(18082, '0.0.0.0', done);
  });
  const { ConfigService } = req('@nestjs/config');
  const config = new ConfigService({
    ...process.env,
    FACE_JOB_TRANSPORT: 'sqs',
    FACE_QUALITY_GATE_FAIL_OPEN: 'false',
    FACE_BEST_SHOT_WINDOW_MS: '4000',
    FACE_BEST_SHOT_MAX_SAMPLES: '32',
    FACE_BEST_SHOT_EARLY_DISPATCH_ENABLED: 'false',
    FACE_REQUIRE_TIMESTAMPED_FRAME: 'true',
    FACE_MIN_SAMPLE_INTERVAL_MS: '150',
    FACE_SESSION_CACHE_ENABLED: 'false',
    FACE_SPATIAL_REID_ENABLED: 'false',
  });
  const { FaceRecognitionCoordinatorService: Coordinator } = req(
    './dist/face-recognition/face-recognition-coordinator.service.js',
  );
  const { TrackIdentityStateService: State } = req(
    './dist/face-recognition/track-identity-state.service.js',
  );
  const { FaceSessionCacheService: Cache, cosineSimilarity } = req(
    './dist/face-recognition/face-session-cache.service.js',
  );
  const { FaceQualityGateClient: Gate } = req(
    './dist/face-recognition/face-quality-gate.client.js',
  );
  const { FrigateMediaAdapter: Media } = req('./dist/media/frigate-media.adapter.js');
  const media = new Media(config),
    gate = new Gate(config),
    state = new State(config);
  const owner = randomUUID(),
    cameraId = randomUUID();
  let currentCase = 'warmup',
    serial = Promise.resolve();
  const records = [],
    assessments = new Map(),
    vectors = [];
  const trace = (value) =>
    appendFileSync(
      `${out}/pipeline.jsonl`,
      JSON.stringify({ at: new Date().toISOString(), case: currentCase, ...value }) + '\n',
    );
  const assess = gate.assess.bind(gate);
  gate.assess = async (bytes) => {
    const result = await assess(bytes);
    const sha256 = hash(bytes);
    const { embeddingBase64, ...safe } = result;
    assessments.set(sha256, safe);
    trace({ type: 'assess', sha256, ...safe });
    return result;
  };
  const sink = {
    registerRecognitionResultListener() {},
    async enqueueFaceJob(input) {
      const record = state.get(slug, input.trackId);
      const file = `crops/${currentCase}-${input.trackId}.png`;
      writeFileSync(`${out}/${file}`, input.imageBuffer);
      const sha256 = hash(input.imageBuffer);
      const value = {
        type: 'dispatch',
        case: currentCase,
        trackId: input.trackId,
        file,
        sha256,
        samplesCollected: record.samplesCollected,
        waitMs: record.dispatchedAt - record.bestShotWindowStartedAt,
        qualityScore: record.dispatchedQualityScore,
        assessment: assessments.get(sha256),
      };
      records.push(value);
      trace(value);
      if (record.dispatchedEmbedding)
        vectors.push({
          case: currentCase,
          trackId: input.trackId,
          embedding: record.dispatchedEmbedding,
        });
      return { created: true, jobId: randomUUID(), status: 'PENDING' };
    },
  };
  const coordinator = new Coordinator(
    config,
    state,
    new Cache(config),
    gate,
    media,
    { submit: async () => ({}) },
    undefined,
    undefined,
    sink,
  );
  const mqtt = req('mqtt').connect(process.env.MQTT_URL, { clientId: 'best-shot-local-eval' });
  await new Promise((done, reject) => {
    mqtt.once('connect', done);
    mqtt.once('error', reject);
  });
  await mqtt.subscribeAsync(['frigate/events', 'frigate/camerai/pose/frames']);
  mqtt.on('message', (topic, bytes) => {
    if (topic === 'frigate/camerai/pose/frames') {
      const frame = media.acceptTimestampedFrame(bytes);
      if (frame?.header.cameraSlug === slug)
        void coordinator
          .sampleAvailableFrame(
            slug,
            frame.header.persons.map((p) => p.trackId),
          )
          .catch((e) => trace({ type: 'error', message: e.message }));
      return;
    }
    let event;
    try {
      event = JSON.parse(bytes);
    } catch {
      return;
    }
    if (event.after?.camera !== slug || event.after?.label !== 'person') return;
    trace({ type: 'frigate-event', message: event });
    serial = serial
      .then(async () => {
        const id = event.after.id;
        const existing = state.get(slug, id);
        const row = {
          id: existing?.eventId || randomUUID(),
          camera_id: cameraId,
          event_type: 'PERSON_DETECTED',
          status: 'DETECTED',
          detected_at: new Date(),
        };
        await coordinator.handleTrackEvent({
          messageType: event.type,
          event: row,
          after: event.after,
          isCreated: !existing,
          camera: {
            id: cameraId,
            slug,
            owner_user_id: owner,
            detect_width: 1920,
            detect_height: 1080,
          },
        });
      })
      .catch((e) => trace({ type: 'error', message: e.message }));
  });
  const videos = process.argv.slice(3);
  const replayCrf = Number(process.env.FACE_EVAL_REPLAY_CRF || 12);
  if (!Number.isInteger(replayCrf) || replayCrf < 0 || replayCrf > 18)
    throw Error('Invalid replay CRF');
  if (!videos.length) throw Error('Supply video filenames');
  try {
    const warmupCrop = readFileSync(
      'docs/test/FACE_TRACK_ONCE_2026-11-22/evidence/crops/TC06-no-glasses-acceptance_1795363041.315733-7lx5cd.jpg',
    );
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const warmup = await gate.assess(warmupCrop);
      if (warmup.gateStatus === 'READY') {
        ready = true;
        break;
      }
      await sleep(1000);
    }
    if (!ready) throw Error('Quality gate is not ready; no replay started');
    for (const name of videos) {
      currentCase = name.replace('.mp4', '');
      assessments.clear();
      trace({
        type: 'start',
        video: name,
        replay: { width: 1920, height: 1080, fps: 30, crf: replayCrf, detectFps: 5 },
      });
      const url = new URL(`rtsp://127.0.0.1:8554/${slug}`);
      url.username = process.env.MEDIAMTX_PUBLISH_USERNAME || 'cam-internal';
      url.password = process.env.MEDIAMTX_PUBLISH_PASSWORD || 'local-dev-password';
      const background = resolve('artifacts/face-track-once-2026-11-22/background-empty.jpg');
      const norm = 'scale=1920:1080,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS';
      // Encode before replay so CPU contention cannot burst packets into MediaMTX.
      const graph = `[0:v]${norm}[a];[1:v]${norm}[b];[2:v]${norm}[c];[a][b][c]concat=n=3:v=1:a=0[v]`;
      const replayFile = resolve(priv, `${name}-crf${replayCrf}.mkv`);
      const child = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'warning',
          '-y',
          '-loop',
          '1',
          '-framerate',
          '30',
          '-t',
          '10',
          '-i',
          background,
          '-i',
          resolve('local_image/Dataset_2/Videos', name),
          '-loop',
          '1',
          '-framerate',
          '30',
          '-t',
          '20',
          '-i',
          background,
          '-filter_complex_threads',
          '1',
          '-filter_complex',
          graph,
          '-map',
          '[v]',
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          String(replayCrf),
          '-tune',
          'zerolatency',
          '-threads',
          '2',
          '-pix_fmt',
          'yuv420p',
          '-g',
          '30',
          replayFile,
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      child.stderr.on('data', (bytes) =>
        appendFileSync(
          `${out}/ffmpeg.txt`,
          bytes.toString().replaceAll(url.toString(), '<qa-rtsp>'),
        ),
      );
      const code = await new Promise((done, reject) => {
        child.once('exit', done);
        child.once('error', reject);
      });
      if (code !== 0) throw Error(`Replay failed (${code})`);
      const publisher = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'warning',
          '-re',
          '-i',
          replayFile,
          '-map',
          '0:v:0',
          '-an',
          '-c:v',
          'copy',
          '-f',
          'rtsp',
          '-rtsp_transport',
          'tcp',
          url.toString(),
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      publisher.stderr.on('data', (bytes) =>
        appendFileSync(
          `${out}/ffmpeg.txt`,
          bytes.toString().replaceAll(url.toString(), '<qa-rtsp>'),
        ),
      );
      const replayCode = await new Promise((done, reject) => {
        publisher.once('exit', done);
        publisher.once('error', reject);
      });
      if (replayCode !== 0) throw Error(`RTSP publish failed (${replayCode})`);
      await sleep(3000);
      await serial;
      trace({ type: 'end', dispatched: records.filter((r) => r.case === currentCase).length });
      save(`${out}/results.json`, {
        mode: 'live-frigate-local-recognition-sink',
        awsCalls: 0,
        records,
      });
      console.log(
        JSON.stringify({
          video: name,
          dispatches: records.filter((r) => r.case === currentCase).length,
        }),
      );
    }
    const similarities = [];
    for (let i = 0; i < vectors.length; i++)
      for (let j = i + 1; j < vectors.length; j++)
        if (vectors[i].case === vectors[j].case && vectors[i].case.includes('vid6'))
          similarities.push({
            case: vectors[i].case,
            a: vectors[i].trackId,
            b: vectors[j].trackId,
            cosine: cosineSimilarity(vectors[i].embedding, vectors[j].embedding),
          });
    save(`${out}/results.json`, {
      mode: 'live-frigate-local-recognition-sink',
      awsCalls: 0,
      records,
      similarities,
    });
  } finally {
    coordinator.onModuleDestroy();
    await mqtt.endAsync();
    await new Promise((done) => auth.close(done));
  }
} else throw Error('Expected prepare, run or restore');
