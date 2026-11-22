/** Scoped dev fixture: real enrollment, S3, SQS, Lambda callbacks and DB results. */
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const requireApp = createRequire(resolve('apps/orchestrator/package.json'));
const { Pool } = requireApp('pg');
const { ConfigService } = requireApp('@nestjs/config');
const { DatabaseService } = requireApp('./dist/database/database.service.js');
const { KnownFacesRepository } = requireApp('./dist/known-faces/known-faces.repository.js');
const { KnownFacesService } = requireApp('./dist/known-faces/known-faces.service.js');
const { RekognitionFaceEnrollmentService } = requireApp(
  './dist/known-faces/rekognition-face-enrollment.service.js',
);
const { hash } = requireApp('argon2');
const output = resolve('docs/test/REKOGNITION_2026-11-22');
const privateDir = resolve('artifacts/rekognition-eval-2026-11-22');
mkdirSync(privateDir, { recursive: true });
const fixturePath = resolve(privateDir, 'fixture.json');
const fixture = existsSync(fixturePath)
  ? JSON.parse(readFileSync(fixturePath))
  : {
      owner: randomUUID(),
      device: randomUUID(),
      camera: randomUUID(),
      email: `face-eval-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('base64url'),
      jwtSecret: randomBytes(48).toString('base64url'),
      slug: 'face_eval_20261122',
    };
writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new DatabaseService(pool);
const repo = new KnownFacesRepository(db);
const config = new ConfigService(process.env);
const rek = new RekognitionFaceEnrollmentService(config);
const service = new KnownFacesService(repo, {}, {}, config, rek);
const action = process.argv[2] || 'setup';
function uploads(paths) {
  return paths.map((p) => {
    const buffer = readFileSync(p);
    return { buffer, size: buffer.length };
  });
}
const allPhotos = [
  'know_face.png',
  'known_face_half_left.jpg',
  'known_face_half_right.jpg',
  'known_face_left.jpg',
  'known_face_right.jpg',
].map((p) => resolve('local_image', p));
try {
  if (action === 'setup') {
    await db.query(
      `INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,$2,$3,'Rekognition Evaluation','CAREGIVER') ON CONFLICT(id) DO NOTHING`,
      [fixture.owner, fixture.email, await hash(fixture.password)],
    );
    await db.query(
      `INSERT INTO devices(id,owner_user_id,name,status) VALUES($1,$2,'Face evaluation dev','ONLINE') ON CONFLICT(id) DO NOTHING`,
      [fixture.device, fixture.owner],
    );
    await db.query(
      `INSERT INTO cameras(id,device_id,name,slug,rtsp_url,is_enabled) VALUES($1,$2,'Rekognition evaluation',$3,'rtsp://127.0.0.1:8554/face_eval',false) ON CONFLICT(id) DO NOTHING`,
      [fixture.camera, fixture.device, fixture.slug],
    );
    const edges = [];
    async function check(name, paths, selections, shouldFail) {
      const dto = { personName: `Eval ${name}`, relationship: 'Test dev' };
      if (selections !== undefined) dto.faceSelections = selections;
      try {
        const result = await service.create(fixture.owner, dto, uploads(paths));
        edges.push({ name, status: 201, result, expectedFailure: shouldFail });
      } catch (e) {
        edges.push({
          name,
          status: e.getStatus?.() || 500,
          response: e.getResponse?.() || { error: e.name },
          expectedFailure: shouldFail,
        });
      }
    }
    await check('original-five-with-background-face', allPhotos, undefined, true);
    await check('invalid-selection', [allPhotos[1]], '[999]', true);
    const rows = await repo.list(fixture.owner);
    let target = rows.find((r) => r.personName === 'Eval selected-five');
    if (!target) {
      await check('selected-five', allPhotos, '[null,0,null,null,null]', false);
      target = (await repo.list(fixture.owner)).find((r) => r.personName === 'Eval selected-five');
    }
    fixture.knownFaceId = target?.id;
    if (!fixture.knownFaceId) throw new Error('Selected five-angle enrollment failed');
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
    writeFileSync(resolve(output, 'data/enrollment-api.json'), JSON.stringify(edges, null, 2));
    console.log(
      JSON.stringify(
        {
          owner: fixture.owner,
          camera: fixture.camera,
          knownFaceId: fixture.knownFaceId,
          edges: edges.map((e) => ({ name: e.name, status: e.status })),
        },
        null,
        2,
      ),
    );
  } else if (action === 'scientific-enrollment') {
    const scientificOwner = 'a9cba867-2cb6-5d8b-8d40-965d04a11e68';
    const prior = JSON.parse(readFileSync(resolve(output, 'data/enrollment.json')));
    writeFileSync(resolve(output, 'data/enrollment-raw.json'), JSON.stringify(prior, null, 2));
    const normalized = [];
    for (const variant of ['original', 'mirror']) {
      for (let angle = 0; angle < 5; angle++) {
        const paths =
          variant === 'original'
            ? [allPhotos[angle]]
            : [resolve(privateDir, `enrollment/mirror-${angle}.jpg`)];
        const files = uploads(paths);
        await rek.validateSingleFaces(files, angle === 1 ? [0] : undefined);
        const indexed = await rek.indexFaces(
          scientificOwner,
          files,
          `normalized-${variant}-${angle}`,
        );
        const old = prior.find((e) => e.variant === variant && e.angle === angle);
        normalized.push({
          ...old,
          collection: indexed.collectionId,
          faceRecords: indexed.faceIds.map((FaceId) => ({
            Face: { FaceId, BoundingBox: { Width: 1, Height: 1 } },
          })),
          selection: angle === 1 ? 0 : null,
        });
        writeFileSync(
          resolve(privateDir, `enrollment/normalized-${variant}-${angle}.jpg`),
          files[0].buffer,
        );
        files[0].buffer.fill(0);
      }
    }
    writeFileSync(resolve(output, 'data/enrollment.json'), JSON.stringify(normalized, null, 2));
    console.log('Indexed 10 app-validated references, excluding the background poster face.');
  } else if (action === 'prepare-jobs') {
    const cases = JSON.parse(readFileSync(resolve(output, 'data/e2e-cases.json')));
    const registry = (
      await db.query('SELECT * FROM cloud_face_collections WHERE owner_user_id=$1', [fixture.owner])
    ).rows[0];
    const jobs = [];
    for (const test of cases) {
      const id = randomUUID(),
        eventId = randomUUID(),
        resultId = randomUUID();
      const now = new Date().toISOString(),
        trackId = `eval-${id}`;
      const key = `owners/${fixture.owner}/cameras/${fixture.camera}/events/${eventId}/face/${id}.jpg`;
      const envelope = {
        schemaVersion: 1,
        type: 'face.job',
        messageId: id,
        correlationId: eventId,
        occurredAt: now,
        payload: {
          jobId: id,
          resultId,
          eventId,
          cameraId: fixture.camera,
          ownerScopeId: fixture.owner,
          trackId,
          sourceSessionId: `${fixture.slug}:${Date.now() / 1000}`,
          observationId: `track:${trackId}:face`,
          revision: 1,
          collectionVersion: registry.version,
          collectionId: registry.collection_id,
          image: { bucket: process.env.S3_BUCKET, key },
        },
      };
      await db.transaction(async (c) => {
        await c.query(
          `INSERT INTO events(id,camera_id,event_type,priority,detected_at,track_id) VALUES($1,$2,'PERSON_DETECTED','P3',now(),$3)`,
          [eventId, fixture.camera, trackId],
        );
        await c.query(
          `UPDATE cloud_jobs SET id=$2,result_id=$3,envelope=$4,available_at=now()+interval '1 hour' WHERE event_id=$1`,
          [eventId, id, resultId, JSON.stringify(envelope)],
        );
      });
      jobs.push({ ...test, envelope });
    }
    writeFileSync(resolve(privateDir, 'jobs.json'), JSON.stringify(jobs, null, 2));
    console.log(`Prepared ${jobs.length} authorized dev jobs; held until S3 upload.`);
  } else if (action === 'release-jobs') {
    const jobs = JSON.parse(readFileSync(resolve(privateDir, 'jobs.json')));
    for (const j of jobs)
      if (j.delivery !== 'direct')
        await db.query(`UPDATE cloud_jobs SET status='PENDING',available_at=now() WHERE id=$1`, [
          j.envelope.messageId,
        ]);
    console.log('Released SQS cases.');
  } else if (action === 'results') {
    const jobs = JSON.parse(readFileSync(resolve(privateDir, 'jobs.json')));
    const results = [];
    for (const j of jobs) {
      const row = (
        await db.query(
          `SELECT j.id,j.event_id,j.status,j.cached_result,j.last_error,e.person_status,e.matched_known_face_id,e.ai_results,(SELECT count(*)::int FROM cloud_result_receipts r WHERE r.job_id=j.id) AS receipts FROM cloud_jobs j JOIN events e ON e.id=j.event_id WHERE j.id=$1`,
          [j.envelope.messageId],
        )
      ).rows[0];
      results.push({ name: j.name, expected: j.expected, ...row });
    }
    writeFileSync(resolve(output, 'data/e2e-results.json'), JSON.stringify(results, null, 2));
    console.log(
      JSON.stringify(
        results.map((r) => ({
          name: r.name,
          expected: r.expected,
          actual: r.person_status,
          cache: Boolean(r.cached_result),
          receipts: r.receipts,
        })),
        null,
        2,
      ),
    );
  }
} finally {
  rek.onModuleDestroy();
  await pool.end();
}
