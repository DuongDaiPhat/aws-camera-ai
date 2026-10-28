/** Fault injection is limited to the disposable Compose project supplied by the video runner. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const token = 'us18-isolated-callback-token-32-characters';
const headers = { 'X-Internal-Token': token };
const timeoutMs = Number(process.env.FIRE_RECOVERY_TIMEOUT_MS ?? 120000);
const outageHoldMs = Number(process.env.FIRE_RECOVERY_HOLD_MS ?? 12000);
const pollMs = 1000;
if (
  !Number.isFinite(timeoutMs) ||
  timeoutMs < 10000 ||
  !Number.isFinite(outageHoldMs) ||
  outageHoldMs < 11000
)
  throw new Error('Recovery timeout must be >=10000 ms and outage hold >=11000 ms');

export async function initialFireHealth(api, output) {
  const response = await fetch(`${api}/api/v1/internal/fire/health`, { headers });
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.status, 'DEGRADED');
  assert.equal(health.cameras[0]?.status, 'NO_FRAMES');
  assert.equal(health.ai?.status, 'STARTING');
  assert.equal((await fetch(`${api}/api/v1/internal/fire/health`)).status, 401);
  assert.equal(
    (
      await fetch(`${api}/api/v1/internal/fire/health`, {
        headers: { 'X-Internal-Token': 'invalid-test-token' },
      })
    ).status,
    401,
  );
  await writeFile(join(output, 'health-before-frames.json'), JSON.stringify(health, null, 2));
}

export async function verifyFireRecovery({
  api,
  output,
  compose,
  pool,
  root,
  mqttPort,
  minioPort,
}) {
  const stages = [];
  let originalIncident;
  async function health() {
    const response = await fetch(`${api()}/api/v1/internal/fire/health`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function waitFor(name, predicate) {
    const deadline = performance.now() + timeoutMs;
    let last;
    let lastError;
    while (performance.now() < deadline) {
      try {
        last = await health();
        if (predicate(last)) return last;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Health probe failed';
        /* Bounded process recovery. */
      }
      await setTimeout(pollMs);
    }
    throw new Error(`${name} timed out: ${JSON.stringify({ last, lastError })}`);
  }
  async function unchangedIncident() {
    const result =
      await pool.query(`SELECT f.event_id,f.observed_clear_at,f.delivery_status,f.result_id,md5(f.pending_payload::text) AS payload_hash,
      (SELECT count(*)::int FROM event_ai_result_receipts r WHERE r.event_id=f.event_id) AS receipts
      FROM fire_incidents f WHERE f.camera_id='33333333-3333-4333-8333-333333333333'`);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].observed_clear_at, null);
    assert.equal(result.rows[0].delivery_status, 'APPLIED');
    assert.equal(result.rows[0].receipts, 1);
    const immutable = {
      eventId: result.rows[0].event_id,
      resultId: result.rows[0].result_id,
      payloadHash: result.rows[0].payload_hash,
    };
    if (originalIncident) assert.deepEqual(immutable, originalIncident);
    else originalIncident = immutable;
    const duplicateIntents = await pool.query(
      `SELECT channel,escalation_level,count(*)
      FROM notifications WHERE event_id=$1 GROUP BY channel,escalation_level,recipient_user_id,emergency_contact_id HAVING count(*) > 1`,
      [result.rows[0].event_id],
    );
    assert.equal(duplicateIntents.rows.length, 0);
    return result.rows[0].event_id;
  }
  async function save(name, before, degraded, recovered, durationMs) {
    const eventId = await unchangedIncident();
    stages.push({ name, eventId, before, degraded, recovered, durationMs });
    await writeFile(join(output, 'recovery-stages.json'), JSON.stringify(stages, null, 2));
    console.log(`PASS recovery: ${name} (${Math.round(durationMs)} ms)`);
  }
  const initial = await waitFor('initial fresh processing', (value) => value.status === 'READY');
  const mediaDeadline = performance.now() + timeoutMs;
  let eventId;
  while (performance.now() < mediaDeadline) {
    const result = await pool.query(`SELECT f.event_id FROM fire_incidents f
      WHERE f.delivery_status='APPLIED' AND EXISTS (SELECT 1 FROM event_media m WHERE m.event_id=f.event_id AND m.media_type='CLIP')`);
    if (result.rows[0]) {
      eventId = result.rows[0].event_id;
      break;
    }
    await setTimeout(pollMs);
  }
  assert.ok(
    eventId,
    'Initial real ONNX incident and recording clip required before fault injection',
  );
  await unchangedIncident();
  await save('baseline', initial, null, await health(), 0);

  // Exercise admission metrics with malformed bytes and a valid envelope carrying an old capture time.
  const mqtt = createRequire(join(root, 'apps/orchestrator/package.json'))('mqtt');
  const client = await mqtt.connectAsync(`mqtt://127.0.0.1:${mqttPort}`);
  try {
    const before = await health();
    await client.publishAsync('frigate/camerai/fire/frames', Buffer.from([1]), { qos: 1 });
    const header = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        cameraSlug: 'cam_fire',
        sourceSessionId: 'diagnostic',
        frameId: 'stale-diagnostic',
        frameTimestamp: new Date(Date.parse(before.checkedAt) - 60000).toISOString(),
        frameWidth: 1280,
        frameHeight: 720,
      }),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(header.length);
    await client.publishAsync(
      'frigate/camerai/fire/frames',
      Buffer.concat([prefix, header, Buffer.from([255, 216, 255, 217])]),
      { qos: 1 },
    );
    const after = await waitFor(
      'admission counters',
      (value) =>
        value.counters.invalidFrames > before.counters.invalidFrames &&
        value.counters.staleFrames > before.counters.staleFrames,
    );
    await save('malformed and stale frame counters', before, null, after, 0);
  } finally {
    await client.endAsync();
  }

  for (const [name, service, predicate] of [
    [
      'RTSP interruption',
      'publisher',
      (value) => value.status === 'DEGRADED' && value.cameras[0]?.status !== 'READY',
    ],
    ['MQTT outage', 'mqtt', (value) => !value.mqttConnected],
    ['AI process restart', 'ai', (value) => value.ai === null],
    [
      'Frigate process restart',
      'frigate',
      (value) => value.status === 'DEGRADED' && value.cameras[0]?.status !== 'READY',
    ],
  ]) {
    const before = await waitFor(`${name} precondition`, (value) => value.status === 'READY');
    const started = performance.now();
    console.log(`Injecting ${name}`);
    compose('stop', service);
    const degraded = await waitFor(`${name} detection`, predicate);
    assert.equal(degraded.status, 'DEGRADED');
    await setTimeout(outageHoldMs);
    await unchangedIncident(); // Silence longer than the clear window must not rearm the active episode.
    compose('start', service);
    const recovered = await waitFor(
      `${name} recovery`,
      (value) =>
        value.status === 'READY' &&
        value.cameras[0]?.lastProcessedAt !== before.cameras[0]?.lastProcessedAt &&
        value.counters.confirmedEpisodes > before.counters.confirmedEpisodes,
    );
    if (service === 'ai') assert.notEqual(recovered.ai.instanceId, before.ai.instanceId);
    await save(name, before, degraded, recovered, performance.now() - started);
  }
  const before = await health();
  const started = performance.now();
  console.log('Injecting backend process restart');
  compose('stop', 'gate');
  await assert.rejects(health());
  await setTimeout(outageHoldMs);
  await unchangedIncident();
  compose('start', 'gate');
  const recovered = await waitFor(
    'backend restart',
    (value) =>
      value.status === 'READY' &&
      value.instanceId !== before.instanceId &&
      value.counters.confirmedEpisodes >= 1,
  );
  await save(
    'backend process restart',
    before,
    { status: 'UNREACHABLE' },
    recovered,
    performance.now() - started,
  );
  const media = await pool.query(
    'SELECT media_type,object_key,checksum_sha256 FROM event_media WHERE event_id=$1',
    [eventId],
  );
  assert.deepEqual(media.rows.map((item) => item.media_type).sort(), ['CLIP', 'SNAPSHOT']);
  const { S3Client, GetObjectCommand } = createRequire(
    join(root, 'apps/orchestrator/package.json'),
  )('@aws-sdk/client-s3');
  const storage = new S3Client({
    endpoint: `http://127.0.0.1:${minioPort}`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'us18-test', secretAccessKey: 'us18-test-only-password' },
  });
  try {
    for (const item of media.rows) {
      const downloaded = await storage.send(
        new GetObjectCommand({ Bucket: 'us18-media', Key: item.object_key }),
      );
      assert.ok(downloaded.Body);
      const body = await downloaded.Body.transformToByteArray();
      assert.equal(createHash('sha256').update(body).digest('hex'), item.checksum_sha256);
      await writeFile(
        join(
          output,
          item.media_type === 'SNAPSHOT' ? 'recovery-snapshot.jpg' : 'recovery-clip.mp4',
        ),
        body,
      );
    }
  } finally {
    storage.destroy();
  }
  await writeFile(
    join(output, 'recovery-result.json'),
    JSON.stringify(
      {
        passed: true,
        eventId,
        stages: stages.length,
        media: media.rows,
        finalHealth: recovered,
        externalDeliveryTested: false,
        loadSoakTested: false,
      },
      null,
      2,
    ),
  );
}
