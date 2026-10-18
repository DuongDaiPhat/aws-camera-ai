import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { WellnessRepository } from '../src/wellness/wellness.repository';
import { WellnessService } from '../src/wellness/wellness.service';
import { WellnessSchedulerService } from '../src/wellness/wellness-scheduler.service';
import { WellnessSourceAdapter } from '../src/wellness/wellness-source.adapter';
import { WellnessController } from '../src/wellness/wellness.controller';
import { TOKEN_SERVICE, type TokenClaims } from '../src/auth/auth.types';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { InternalTokenGuard } from '../src/ai-results/internal-token.guard';
import { DatabaseService } from '../src/database/database.service';
import { NotificationsRepository } from '../src/notifications/notifications.repository';
import { NotificationRetryWorker } from '../src/notifications/notification-retry-worker.service';
import { TelegramAdapter } from '../src/notifications/telegram/telegram.adapter';
import { TelegramWorkRepository } from '../src/notifications/telegram/telegram-work.repository';
import { TelegramWorkConfig } from '../src/notifications/telegram/telegram-work.config';
import {
  TelegramCallbackService,
  type TelegramCallback,
} from '../src/notifications/telegram/telegram-callback.service';
import { EscalationEngineService } from '../src/escalation/escalation-engine.service';
import { EscalationRepository } from '../src/escalation/escalation.repository';
import { EscalationRulesRepository } from '../src/escalation-rules/escalation-rules.repository';
import type { SubmitAiResultDto } from '../src/ai-results/dto/submit-ai-result.dto';
import type { WellnessObservationDto } from '../src/wellness/dto';
import type { IStorageService } from '../src/storage/storage.interface';
import { AiResultsRepository } from '../src/ai-results/ai-results.repository';
import { AiResultValidator } from '../src/ai-results/ai-result.validator';
import { AiResultOutboxService } from '../src/ai-results/ai-result-outbox.service';
import { EventsRepository } from '../src/events/events.repository';
import { EventsService } from '../src/events/events.service';
import { MediaService } from '../src/media/media.service';
import type { TokenService } from '../src/auth/auth.types';

jest.setTimeout(120000);
describe('US20 real PostgreSQL + HTTP delivery + API acceptance', () => {
  let pool: Pool,
    container: StartedTestContainer | undefined,
    repository: WellnessRepository,
    service: WellnessService;
  let scheduler: WellnessSchedulerService,
    adapter: WellnessSourceAdapter,
    notifications: NotificationsRepository;
  let provider: Server,
    app: INestApplication,
    api: string,
    config: ConfigService,
    worker: NotificationRetryWorker,
    callbacks: TelegramCallbackService;
  let owner: string,
    resident: string,
    other: string,
    camera: string,
    foreignCamera: string,
    face: string,
    identityEvent: string;
  let requests: { method: string; body: Record<string, unknown> }[] = [];
  let providerFails = false;
  const secret = 'us20-local-test-signing-secret-only';
  const internal = 'us20-local-internal-token-at-least-32-characters';
  const actor = (sub: string, role: TokenClaims['role'] = 'VIEWER'): TokenClaims => ({
    sub,
    role,
    email: 'qa@local.test',
    jti: randomUUID(),
    tokenType: 'access',
  });
  const jwt = (sub: string, role: TokenClaims['role'] = 'VIEWER') =>
    sign(actor(sub, role), secret, { expiresIn: '1h' });
  const row = async (sql: string, params: unknown[] = []) =>
    (await pool.query(sql, params)).rows[0];

  beforeAll(async () => {
    const supplied = process.env.US20_TEST_DATABASE_URL;
    if (supplied) {
      const url = new URL(supplied);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/qa_us20')
        throw new Error(
          'US20_TEST_DATABASE_URL must name the disposable loopback qa_us20 database.',
        );
      pool = new Pool({ connectionString: supplied });
    } else {
      container = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'qa_us20',
          POSTGRES_USER: 'qa',
          POSTGRES_PASSWORD: 'qa-disposable-only',
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .start();
      pool = new Pool({
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: 'qa_us20',
        user: 'qa',
        password: 'qa-disposable-only',
      });
      const directory = resolve(__dirname, '../../../db/migrations');
      for (const file of (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort())
        await pool.query(await readFile(resolve(directory, file), 'utf8'));
    }
    provider = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk.toString();
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      requests.push({ method: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      res.statusCode = providerFails ? 503 : 200;
      res.end(
        JSON.stringify(
          providerFails
            ? { ok: false, error_code: 503 }
            : {
                ok: true,
                result: { message_id: 42, chat: { id: body.chat_id ?? 'resident-chat' } },
              },
        ),
      );
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Provider did not listen');
    config = new ConfigService({
      M5_ENABLED: 'true',
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'local-dummy-token',
      TELEGRAM_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      INTERNAL_SERVICE_TOKEN: internal,
      WELLNESS_BOUNDARIES_JSON: JSON.stringify([
        {
          cameraSlug: 'us20_door',
          boundaryId: 'front_door',
          axis: 'x',
          position: 0.5,
          inside: 'less',
          policyVersion: 'v1',
        },
      ]),
    });
    repository = new WellnessRepository(pool, config);
    service = new WellnessService(repository, config);
    scheduler = new WellnessSchedulerService(repository, config);
    adapter = new WellnessSourceAdapter(repository, service, config);
    const database = new DatabaseService(pool);
    notifications = new NotificationsRepository(database);
    const telegram = new TelegramAdapter(config);
    worker = new NotificationRetryWorker(config, notifications, telegram, {
      download: () => {
        throw new Error('M5 must not request an image');
      },
    } as unknown as IStorageService);
    callbacks = new TelegramCallbackService(
      new TelegramWorkRepository(database),
      new EscalationEngineService(
        new EscalationRepository(pool),
        new EscalationRulesRepository(pool),
      ),
      new TelegramWorkConfig(config),
      { publishCommittedUpdate: async () => undefined },
      service,
    );
    const module = await Test.createTestingModule({
      controllers: [WellnessController],
      providers: [
        JwtAuthGuard,
        InternalTokenGuard,
        { provide: ConfigService, useValue: config },
        { provide: WellnessService, useValue: service },
        {
          provide: TOKEN_SERVICE,
          useValue: { verifyAccessToken: (token: string) => verify(token, secret) },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.enableCors({ origin: true, credentials: true });
    await app.listen(0, '127.0.0.1');
    api = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => provider?.close(() => resolve()));
    await pool?.end();
    await container?.stop();
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    requests = [];
    providerFails = false;
    // Explicitly restricted disposable database, never the application's configured database.
    await pool.query('TRUNCATE users CASCADE');
    owner = (
      await row(
        "INSERT INTO users(email,password_hash,full_name,role,telegram_chat_id,telegram_user_id,telegram_linked_at) VALUES('owner@qa.local','test','Caregiver QA','CAREGIVER','owner-chat','owner-user',now()) RETURNING id",
      )
    ).id;
    resident = (
      await row(
        "INSERT INTO users(email,password_hash,full_name,role,telegram_chat_id,telegram_user_id,telegram_linked_at) VALUES('resident@qa.local','test','Resident QA','VIEWER','resident-chat','resident-user',now()) RETURNING id",
      )
    ).id;
    other = (
      await row(
        "INSERT INTO users(email,password_hash,full_name,role) VALUES('other@qa.local','test','Other QA','VIEWER') RETURNING id",
      )
    ).id;
    const device = (
      await row("INSERT INTO devices(owner_user_id,name) VALUES($1,'QA gateway') RETURNING id", [
        owner,
      ])
    ).id;
    camera = (
      await row(
        "INSERT INTO cameras(device_id,name,slug,rtsp_url) VALUES($1,'Door QA','us20_door','rtsp://test') RETURNING id",
        [device],
      )
    ).id;
    const foreignDevice = (
      await row(
        "INSERT INTO devices(owner_user_id,name) VALUES($1,'Foreign gateway') RETURNING id",
        [other],
      )
    ).id;
    foreignCamera = (
      await row(
        "INSERT INTO cameras(device_id,name,slug,rtsp_url) VALUES($1,'Foreign camera','us20_foreign','rtsp://test') RETURNING id",
        [foreignDevice],
      )
    ).id;
    face = (
      await row(
        "INSERT INTO known_faces(owner_user_id,linked_user_id,person_name,embedding,embedding_dim) VALUES($1,$2,'Resident QA',decode('01','hex'),1) RETURNING id",
        [owner, resident],
      )
    ).id;
    identityEvent = (
      await row(
        "INSERT INTO events(camera_id,event_type,status,track_id,detected_at,person_status,matched_known_face_id) VALUES($1,'PERSON_DETECTED','LOGGED_ONLY','track-qa',now(),'KNOWN',$2) RETURNING id",
        [camera, face],
      )
    ).id;
  });
  async function makeRun(offsetSeconds = 1, overrides: Record<string, unknown> = {}) {
    const schedule = await service.createSchedule(actor(owner, 'CAREGIVER'), {
      residentUserId: resident,
      checkAt: '09:00',
      ...overrides,
    });
    const now = await repository.databaseNow(),
      due = new Date(now.getTime() - offsetSeconds * 1000);
    await repository.insertCheckRunIfNotExists({
      scheduleId: schedule.id,
      ownerUserId: owner,
      residentUserId: resident,
      localDate: due.toISOString().slice(0, 10),
      scheduledFor: due,
      scheduleVersion: schedule.version,
      scheduleSnapshot: { cameraIds: [camera] },
      lookbackStartedAt: new Date(due.getTime() - 21600000),
      lookbackEndedAt: due,
      graceSeconds: 300,
      availableAt: due,
    });
    return {
      schedule,
      run: (
        await repository.listChecks(owner, 'CAREGIVER', {
          page: 1,
          pageSize: 20,
          scheduleId: schedule.id,
        })
      ).data[0],
    };
  }
  async function alert() {
    const { run } = await makeRun();
    await scheduler.evaluatePendingRuns();
    const current = await repository.getCheckById(run.id);
    expect(current?.status).toBe('ALERT_CREATED');
    return current!;
  }
  function identity(processedAt: Date): SubmitAiResultDto {
    return {
      schemaVersion: 1,
      resultId: randomUUID(),
      eventId: identityEvent,
      observationId: 'source-qa',
      revision: 1,
      module: 'M1_FACE',
      modelVersion: 'qa',
      processedAt: processedAt.toISOString(),
      personStatus: 'KNOWN',
      matchedKnownFaceId: face,
      error: null,
      results: [
        {
          module: 'M1_FACE',
          label: 'KNOWN',
          confidence: 0.99,
          boundingBox: null,
          metadata: { sourceSessionId: 'session-qa' },
        },
      ],
    };
  }
  async function source(kind: 'MOTION' | 'ARRIVAL' | 'DEPARTURE', at: Date) {
    const dto: WellnessObservationDto = {
      observationId: randomUUID(),
      ownerUserId: owner,
      residentUserId: resident,
      knownFaceId: face,
      identityEventId: identityEvent,
      cameraId: camera,
      sourceSessionId: 'session-qa',
      trackId: 'track-qa',
      kind,
      observedAt: at.toISOString(),
      ...(kind === 'MOTION'
        ? {}
        : {
            directionalEvidence: {
              boundaryId: 'front_door',
              direction: kind === 'ARRIVAL' ? 'ENTER' : 'EXIT',
              policyVersion: 'v1',
            },
          }),
    };
    await adapter.associateIdentity(identity(new Date(at.getTime() - 1000)));
    await pool.query(
      `INSERT INTO resident_wellness_source_evidence(observation_id,camera_id,source_session_id,track_id,kind,observed_at,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        dto.observationId,
        camera,
        dto.sourceSessionId,
        dto.trackId,
        kind,
        at,
        {
          source: 'FRIGATE_METADATA',
          isMoving: true,
          ...(dto.directionalEvidence ? { directionalEvidence: dto.directionalEvidence } : {}),
        },
      ],
    );
    return dto;
  }
  function cb(notification: string, patch: Partial<TelegramCallback> = {}): TelegramCallback {
    return {
      kind: 'CALLBACK',
      updateId: 1001,
      callbackId: 'qa',
      actorId: 'resident-user',
      chatId: 'resident-chat',
      messageId: '42',
      data: `cf:${notification.replace(/-/g, '')}:ok`,
      ...patch,
    };
  }
  async function http(
    path: string,
    method = 'GET',
    body?: unknown,
    sub = owner,
    role: TokenClaims['role'] = 'CAREGIVER',
  ) {
    return fetch(`${api}/api/v1/${path}`, {
      method,
      headers: { authorization: `Bearer ${jwt(sub, role)}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it('TC019: accepted M1 result persists durable identity work; real outbox claims and invokes adapter', async () => {
    const now = await repository.databaseNow();
    const dto = identity(new Date(now.getTime() - 1000));
    Object.assign(dto.results[0].metadata, { similarity: 0.99, confidencePolicyVersion: 'v1' });
    const validationConfig = new ConfigService({
      AI_RESULT_MAX_ITEMS: '20',
      AI_RESULT_MAX_METADATA_BYTES: '16384',
      AI_RESULT_MAX_METADATA_DEPTH: '5',
      AI_RESULT_MAX_FUTURE_SECONDS: '300',
    });
    const submission = new AiResultValidator(validationConfig).validate(dto.eventId, dto);
    const results = new AiResultsRepository(new DatabaseService(pool));
    expect((await results.applyResult(submission, 'a'.repeat(64), { ...dto })).disposition).toBe(
      'ACCEPTED',
    );
    expect(
      (await row("SELECT count(*) FROM outbox_messages WHERE message_type='wellness.identity'"))
        .count,
    ).toBe('1');
    const eventsRepository = new EventsRepository(pool);
    const eventsService = new EventsService(
      eventsRepository,
      {} as MediaService,
      {} as EscalationEngineService,
      {} as IStorageService,
      {} as TokenService,
    );
    const outbox = new AiResultOutboxService(
      new ConfigService({
        AI_RESULT_OUTBOX_POLL_MS: '1000',
        AI_RESULT_OUTBOX_LEASE_SECONDS: '30',
        AI_RESULT_OUTBOX_RETRY_SECONDS: '3',
      }),
      results,
      eventsRepository,
      eventsService,
      {} as EscalationEngineService,
      adapter,
    );
    await outbox.dispatchAvailable();
    expect(
      (await row("SELECT status FROM outbox_messages WHERE message_type='wellness.identity'"))
        .status,
    ).toBe('PROCESSED');
    expect((await row('SELECT count(*) FROM resident_wellness_track_links')).count).toBe('1');
    await adapter.acceptFrame({
      camera: 'us20_door',
      objects: [
        {
          id: 'track-qa',
          label: 'person',
          isMoving: true,
          sourceSessionId: 'session-qa',
          observedAt: now.getTime() / 1000,
          box: [0.1, 0.1, 0.3, 0.5],
        },
      ],
    });
    expect((await row('SELECT count(*) FROM resident_wellness_observations')).count).toBe('1');
  });
  it('TC001/002/004/012: 09:00 + 18:00 local, activation/cursor, one occurrence per local date', async () => {
    const first = await service.createSchedule(actor(owner, 'CAREGIVER'), {
      residentUserId: resident,
      checkAt: '09:00',
    });
    const second = await service.createSchedule(actor(owner, 'CAREGIVER'), {
      residentUserId: resident,
      checkAt: '18:00',
    });
    const instant = new Date('2026-10-18T11:00:01Z');
    jest.spyOn(repository, 'databaseNow').mockResolvedValue(instant);
    await pool.query(
      "UPDATE wellness_schedules SET activation_started_at='2026-10-18T00:00:00Z',last_materialized_at=NULL WHERE id=ANY($1::uuid[])",
      [[first.id, second.id]],
    );
    expect(await repository.materializeOccurrences(86400, 50)).toBe(2);
    expect(await repository.materializeOccurrences(86400, 50)).toBe(0);
    expect(
      (
        await pool.query('SELECT scheduled_for FROM wellness_check_runs ORDER BY scheduled_for')
      ).rows.map((r) => r.scheduled_for.toISOString()),
    ).toEqual(['2026-10-18T02:00:00.000Z', '2026-10-18T11:00:00.000Z']);
    await pool.query('TRUNCATE wellness_check_runs');
    await pool.query(
      "UPDATE wellness_schedules SET activation_started_at='2026-10-18T11:00:02Z',last_materialized_at=NULL",
    );
    expect(await repository.materializeOccurrences(86400, 50)).toBe(0);
  });
  it.each([
    ['2026-03-08', '02:30', '2026-03-08T07:30:00.000Z'],
    ['2026-11-01', '01:30', '2026-11-01T06:30:00.000Z'],
  ])('TC002 DST %s matches PostgreSQL gap/fold', async (day, hour, expected) => {
    const schedule = await service.createSchedule(actor(owner, 'CAREGIVER'), {
      residentUserId: resident,
      checkAt: hour,
      timezone: 'America/New_York',
    });
    await pool.query(
      'UPDATE wellness_schedules SET activation_started_at=$2,last_materialized_at=NULL WHERE id=$1',
      [schedule.id, `${day}T00:00:00Z`],
    );
    jest.spyOn(repository, 'databaseNow').mockResolvedValue(new Date(`${day}T12:00:00Z`));
    await repository.materializeOccurrences(86400, 50);
    expect(
      (await row('SELECT scheduled_for FROM wellness_check_runs')).scheduled_for.toISOString(),
    ).toBe(expected);
  });
  it('TC003/006/007/008: role/household/camera validation and merged PATCH', async () => {
    await expect(
      service.createSchedule(actor(owner, 'CAREGIVER'), {
        residentUserId: other,
        checkAt: '09:00',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.createSchedule(actor(resident), { residentUserId: resident, checkAt: '09:00' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.createSchedule(actor(owner, 'CAREGIVER'), {
        residentUserId: resident,
        checkAt: '09:00',
        cameraIds: [foreignCamera],
      }),
    ).rejects.toMatchObject({ status: 400 });
    const schedule = await service.createSchedule(actor(owner, 'CAREGIVER'), {
      residentUserId: resident,
      checkAt: '09:00',
    });
    await expect(
      service.updateSchedule(actor(owner, 'CAREGIVER'), schedule.id, {}),
    ).rejects.toMatchObject({ status: 400 });
    await pool.query('UPDATE known_faces SET is_active=false WHERE id=$1', [face]);
    await expect(
      service.updateSchedule(actor(owner, 'CAREGIVER'), schedule.id, {
        name: 'Cannot bypass scope',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await repository.getScheduleById(schedule.id))?.version).toBe(1);
  });
  it('TC005/009/011: closed window boundaries, last activity, as-of AWAY and expiry', async () => {
    const now = await repository.databaseNow();
    const dto = await source('MOTION', now);
    await service.submitObservation(dto);
    const start = new Date(now.getTime() - 21600000);
    expect(
      await repository.findActivityInWindow(
        owner,
        resident,
        [camera],
        now,
        new Date(now.getTime() + 1000),
      ),
    ).toEqual(now);
    expect(
      await repository.findActivityInWindow(
        owner,
        resident,
        [camera],
        start,
        new Date(now.getTime() - 1),
      ),
    ).toBeNull();
    expect(await repository.findActivityInWindow(owner, resident, [camera], start, now)).toEqual(
      now,
    );
    expect(
      await repository.findActivityInWindow(owner, resident, [foreignCamera], start, now),
    ).toBeNull();
    const depart = await source('DEPARTURE', new Date(now.getTime() + 1000));
    await service.submitObservation(depart);
    expect(await repository.getPresenceState(owner, resident, now)).toBe('HOME');
    expect(await repository.getPresenceState(owner, resident, new Date(now.getTime() + 1000))).toBe(
      'AWAY',
    );
    expect(
      await repository.getPresenceState(owner, resident, new Date(now.getTime() + 86401000)),
    ).toBe('UNKNOWN');
  });
  it('TC009/022: conflicting timestamps and expired/unknown identity never prove AWAY', async () => {
    const now = await repository.databaseNow();
    await adapter.associateIdentity(identity(new Date(now.getTime() - 31000)));
    expect((await row('SELECT count(*) FROM resident_wellness_track_links')).count).toBe('0');
    await adapter.associateIdentity({
      ...identity(now),
      personStatus: 'UNKNOWN',
      matchedKnownFaceId: undefined,
    });
    expect(await repository.getPresenceState(owner, resident, now)).toBe('UNKNOWN');
    await service.submitObservation(await source('MOTION', now));
    await service.submitObservation(await source('DEPARTURE', now));
    expect(await repository.getPresenceState(owner, resident, now)).toBe('UNKNOWN');
  });
  it('TC010/016/017: canonical replay, conflicting payload, provenance, out-of-order and rollback', async () => {
    const now = await repository.databaseNow();
    const dto = await source('MOTION', now);
    expect((await service.submitObservation(dto)).presenceUpdated).toBe(true);
    const reordered = Object.fromEntries(
      Object.entries(dto).reverse(),
    ) as unknown as WellnessObservationDto;
    expect((await service.submitObservation(reordered)).status).toBe('DUPLICATE');
    await expect(service.submitObservation({ ...dto, trackId: 'forged' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      service.submitObservation({ ...dto, observationId: randomUUID(), residentUserId: other }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.submitObservation({
        ...dto,
        observationId: randomUUID(),
        observedAt: new Date(now.getTime() + 10000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    const older = await source('DEPARTURE', new Date(now.getTime() - 500));
    expect((await service.submitObservation(older)).presenceUpdated).toBe(false);
    expect(await repository.getPresenceState(owner, resident, now)).toBe('HOME');
    const next = await source('MOTION', new Date(now.getTime() + 500));
    jest
      .spyOn(repository, 'updatePresence')
      .mockRejectedValueOnce(new Error('injected write failure'));
    await expect(service.submitObservation(next)).rejects.toThrow('injected write failure');
    expect(await repository.findObservationById(next.observationId)).toBeNull();
  });
  it('TC019/022: production M1 adapter requires motion, exact session/track and configured direction', async () => {
    const now = await repository.databaseNow();
    await adapter.associateIdentity(identity(new Date(now.getTime() - 1000)));
    expect((await row('SELECT count(*) FROM resident_wellness_observations')).count).toBe('0');
    const frame = (offset: number, x: number, patch: Record<string, unknown> = {}) => ({
      camera: 'us20_door',
      objects: [
        {
          id: 'track-qa',
          label: 'person',
          isMoving: true,
          sourceSessionId: 'session-qa',
          observedAt: (now.getTime() + offset) / 1000,
          box: [x, 0.1, x + 0.1, 0.3],
          ...patch,
        },
      ],
    });
    await adapter.acceptFrame(frame(0, 0.2, { isMoving: false }));
    await adapter.acceptFrame(frame(1, 0.2, { id: 'somebody-else' }));
    await adapter.acceptFrame(frame(2, 0.2, { sourceSessionId: 'restarted' }));
    expect((await row('SELECT count(*) FROM resident_wellness_observations')).count).toBe('0');
    await adapter.acceptFrame(frame(10, 0.2));
    expect(await repository.getPresenceState(owner, resident, new Date(now.getTime() + 10))).toBe(
      'HOME',
    );
    await adapter.acceptFrame(frame(20, 0.7));
    await adapter.acceptFrame(frame(30, 0.7));
    expect(await repository.getPresenceState(owner, resident, new Date(now.getTime() + 30))).toBe(
      'AWAY',
    );
    const awayRun = await makeRun(0);
    await scheduler.evaluatePendingRuns();
    expect((await repository.getCheckById(awayRun.run.id))?.status).toBe('SKIPPED_AWAY');
    await adapter.acceptFrame(frame(40, 0.2));
    await adapter.acceptFrame(frame(50, 0.2));
    expect(await repository.getPresenceState(owner, resident, new Date(now.getTime() + 50))).toBe(
      'HOME',
    );
    expect(
      (await pool.query('SELECT DISTINCT kind FROM resident_wellness_observations')).rows
        .map((r) => r.kind)
        .sort(),
    ).toEqual(['ARRIVAL', 'DEPARTURE', 'MOTION']);
  });
  it('TC013/014/020: no activity → P2 camera-less → actual HTTP SENT → exact 300s snapshot deadline', async () => {
    const check = await alert();
    expect(check.request_sent_at).toBeNull();
    expect(check.confirmation_deadline_at).toBeNull();
    expect(
      await row('SELECT priority,camera_id,confidence,source FROM events WHERE id=$1', [
        check.event_id,
      ]),
    ).toEqual({ priority: 'P2', camera_id: null, confidence: null, source: 'SCHEDULER' });
    await worker.runOnce();
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toContain('/sendMessage');
    expect(requests[0].body.chat_id).toBe('resident-chat');
    expect(requests[0].body.text).toContain('xác nhận');
    expect(requests[0].body.text).not.toContain('Camera:');
    const delivered = await repository.getCheckById(check.id);
    expect(delivered?.request_sent_at).toBeInstanceOf(Date);
    expect(
      delivered!.confirmation_deadline_at!.getTime() - delivered!.request_sent_at!.getTime(),
    ).toBe(300000);
    await service.updateSchedule(actor(owner, 'CAREGIVER'), check.schedule_id, {
      graceSeconds: 600,
    });
    expect((await repository.getCheckById(check.id))?.grace_seconds).toBe(300);
  });
  it('TC014/015/018: failed HTTP never starts deadline, flag off still drains delivery failures once', async () => {
    const check = await alert();
    providerFails = true;
    await worker.runOnce();
    expect((await repository.getCheckById(check.id))?.request_sent_at).toBeNull();
    expect(check.delivery_deadline_at!.getTime() - check.evaluated_at!.getTime()).toBe(60000);
    await pool.query(
      'UPDATE wellness_check_runs SET delivery_deadline_at=evaluated_at WHERE id=$1',
      [check.id],
    );
    const disabled = new WellnessSchedulerService(
      repository,
      new ConfigService({ M5_ENABLED: 'false' }),
    );
    await disabled.tick();
    await disabled.tick();
    expect((await row('SELECT status FROM events WHERE id=$1', [check.event_id])).status).toBe(
      'ESCALATED',
    );
    expect(
      (
        await row(
          'SELECT count(*) FROM notifications WHERE event_id=$1 AND recipient_user_id=$2 AND escalation_level=1',
          [check.event_id, owner],
        )
      ).count,
    ).toBe('1');
    expect((await row('SELECT count(*) FROM wellness_check_runs')).count).toBe('1');
  });
  it('TC015/016/017/020: assigned Telegram callback checks actor/chat/message, confirms once, rejects changed replay', async () => {
    const check = await alert();
    await worker.runOnce();
    const notification = (
      await row('SELECT id FROM notifications WHERE event_id=$1 AND escalation_level=0', [
        check.event_id,
      ])
    ).id;
    expect(await callbacks.confirm(cb(notification, { chatId: 'wrong' }))).toContain(
      'không có quyền',
    );
    expect(await callbacks.confirm(cb(notification, { actorId: 'owner-user' }))).toContain(
      'không có quyền',
    );
    expect(await callbacks.confirm(cb(notification, { messageId: 'wrong' }))).toContain(
      'không có quyền',
    );
    expect(await callbacks.confirm(cb(notification))).toContain('an toàn');
    expect(await callbacks.confirm(cb(notification))).toContain('an toàn');
    expect((await row('SELECT status FROM events WHERE id=$1', [check.event_id])).status).toBe(
      'RESOLVED',
    );
    expect(
      (await row('SELECT count(*) FROM confirmations WHERE event_id=$1', [check.event_id])).count,
    ).toBe('1');
    await expect(
      service.confirmCheck(actor(resident), check.id, {
        commandId: randomUUID(),
        response: 'NEED_HELP',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const command = (
      await row('SELECT source_message_id FROM confirmations WHERE event_id=$1', [check.event_id])
    ).source_message_id;
    await expect(
      service.confirmCheck(actor(resident), check.id, {
        commandId: command,
        response: 'IM_OK',
        note: 'changed',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([0, 1])(
    'TC015/018/021: at deadline + %sms commits escalation and returns 409',
    async (offset) => {
      const check = await alert();
      await worker.runOnce();
      const sent = (await repository.getCheckById(check.id))!;
      jest
        .spyOn(repository, 'databaseNow')
        .mockResolvedValue(new Date(sent.confirmation_deadline_at!.getTime() + offset));
      await expect(
        service.confirmCheck(actor(resident), check.id, {
          commandId: randomUUID(),
          response: 'IM_OK',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await row('SELECT status FROM events WHERE id=$1', [check.event_id])).status).toBe(
        'ESCALATED',
      );
      expect(
        (
          await row(
            "SELECT count(*) FROM event_status_history WHERE event_id=$1 AND reason='TIMEOUT'",
            [check.event_id],
          )
        ).count,
      ).toBe('1');
      expect(
        (await row('SELECT count(*) FROM confirmations WHERE event_id=$1', [check.event_id])).count,
      ).toBe('0');
    },
  );
  it('TC015/021: NEED_HELP immediately notifies caregiver, concurrent confirmations yield one authoritative result', async () => {
    const check = await alert();
    await worker.runOnce();
    const sent = (await repository.getCheckById(check.id))!;
    jest
      .spyOn(repository, 'databaseNow')
      .mockResolvedValue(new Date(sent.confirmation_deadline_at!.getTime() - 1));
    const results = await Promise.allSettled([
      service.confirmCheck(actor(resident), check.id, {
        commandId: randomUUID(),
        response: 'NEED_HELP',
      }),
      service.confirmCheck(actor(resident), check.id, {
        commandId: randomUUID(),
        response: 'IM_OK',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await row('SELECT count(*) FROM confirmations WHERE event_id=$1 AND is_authoritative', [
          check.event_id,
        ])
      ).count,
    ).toBe('1');
  });
  it('TC006/007/023/024: real HTTP schema/status, JWT scope, resident confirm and internal token', async () => {
    expect((await fetch(`${api}/api/v1/wellness-checks`)).status).toBe(401);
    for (const body of [
      { residentUserId: resident, checkAt: '09:00', daysOfWeek: [] },
      { residentUserId: resident, checkAt: '09:00', daysOfWeek: [1, 1] },
      { residentUserId: resident, checkAt: '09:00', timezone: 'Invalid/Timezone' },
    ])
      expect((await http('wellness-schedules', 'POST', body)).status).toBe(400);
    const created = await http('wellness-schedules', 'POST', {
      residentUserId: resident,
      checkAt: '09:00',
    });
    expect(created.status).toBe(201);
    const schedule = (await created.json()) as { id: string };
    expect(schedule).toMatchObject({
      residentUserId: resident,
      ownerUserId: owner,
      checkAt: '09:00',
    });
    expect(schedule).not.toHaveProperty('resident_user_id');
    expect((await http(`wellness-schedules/${schedule.id}`, 'PATCH', {})).status).toBe(400);
    expect(
      (
        (await (await http('wellness-schedules', 'GET', undefined, other, 'VIEWER')).json()) as {
          data: unknown[];
        }
      ).data,
    ).toHaveLength(0);
    expect(
      (
        await http(
          'wellness-schedules',
          'POST',
          { residentUserId: resident, checkAt: '18:00' },
          resident,
          'VIEWER',
        )
      ).status,
    ).toBe(403);
    const dto = await source('MOTION', await repository.databaseNow());
    expect(
      (
        await fetch(`${api}/api/v1/internal/wellness-observations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(dto),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${api}/api/v1/internal/wellness-observations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-token': internal },
          body: JSON.stringify(dto),
        })
      ).status,
    ).toBe(202);
    expect((await http(`wellness-schedules/${schedule.id}`, 'DELETE')).status).toBe(204);
  });
  it.each(['IM_OK', 'NEED_HELP'] as const)(
    'TC018/020/023: HTTP %s persists one confirmation and expected caregiver routing',
    async (response) => {
      const check = await alert();
      await worker.runOnce();
      const delivered = (await repository.getCheckById(check.id))!;
      jest
        .spyOn(repository, 'databaseNow')
        .mockResolvedValue(new Date(delivered.confirmation_deadline_at!.getTime() - 1));
      const command = { commandId: randomUUID(), response };
      expect(
        (await http(`wellness-checks/${check.id}/confirm`, 'POST', command, other, 'VIEWER'))
          .status,
      ).toBe(403);
      const confirmed = await http(
        `wellness-checks/${check.id}/confirm`,
        'POST',
        command,
        resident,
        'VIEWER',
      );
      expect(confirmed.status).toBe(200);
      const confirmation = await confirmed.json();
      expect(confirmation).toMatchObject({
        eventId: check.event_id,
        phase: 'INITIAL',
        channel: 'DASHBOARD',
        response,
        resultingStatus: response === 'IM_OK' ? 'RESOLVED' : 'ESCALATED',
        note: null,
      });
      const replay = await http(
        `wellness-checks/${check.id}/confirm`,
        'POST',
        command,
        resident,
        'VIEWER',
      );
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(confirmation);
      const status = response === 'IM_OK' ? 'RESOLVED' : 'ESCALATED';
      expect((await row('SELECT status FROM events WHERE id=$1', [check.event_id])).status).toBe(
        status,
      );
      expect(
        (await row('SELECT count(*) FROM confirmations WHERE event_id=$1', [check.event_id])).count,
      ).toBe('1');
      expect(
        (
          await row(
            'SELECT count(*) FROM event_status_history WHERE event_id=$1 AND to_status=$2::event_status',
            [check.event_id, status],
          )
        ).count,
      ).toBe('1');
      if (response === 'NEED_HELP')
        expect(
          (
            await row(
              "SELECT recipient_user_id FROM notifications WHERE event_id=$1 AND escalation_level=1 AND channel='TELEGRAM'",
              [check.event_id],
            )
          ).recipient_user_id,
        ).toBe(owner);
      const history = await http('wellness-checks', 'GET', undefined, resident, 'VIEWER');
      expect(history.status).toBe(200);
      expect(
        ((await history.json()) as { data: { localDate: string; eventStatus: string }[] }).data[0],
      ).toMatchObject({ localDate: check.local_date, eventStatus: status });
    },
  );
  it('TC011/012/021/022: scheduler commits SKIPPED_AWAY and SKIPPED_ACTIVITY; missed, disabled and superseded runs stay terminal', async () => {
    const { run, schedule } = await makeRun();
    const departure = await source('DEPARTURE', new Date(run.scheduled_for.getTime() - 1));
    await service.submitObservation(departure);
    await scheduler.evaluatePendingRuns();
    expect((await repository.getCheckById(run.id))?.status).toBe('SKIPPED_AWAY');
    expect(
      (await row("SELECT count(*) FROM events WHERE event_type='WELLNESS_TIMEOUT'")).count,
    ).toBe('0');
    await service.deleteSchedule(actor(owner, 'CAREGIVER'), schedule.id);
    const next = await makeRun();
    const arrival = await source('ARRIVAL', new Date(next.run.scheduled_for.getTime()));
    await service.submitObservation(arrival);
    await scheduler.evaluatePendingRuns();
    expect((await repository.getCheckById(next.run.id))?.status).toBe('SKIPPED_ACTIVITY');
    await service.deleteSchedule(actor(owner, 'CAREGIVER'), next.schedule.id);
    const missed = await makeRun(301);
    await scheduler.evaluatePendingRuns();
    expect((await repository.getCheckById(missed.run.id))?.status).toBe('MISSED');
    await service.deleteSchedule(actor(owner, 'CAREGIVER'), missed.schedule.id);
    const disabled = await makeRun();
    await service.updateSchedule(actor(owner, 'CAREGIVER'), disabled.schedule.id, {
      isEnabled: false,
    });
    await scheduler.evaluatePendingRuns();
    expect((await repository.getCheckById(disabled.run.id))?.status).toBe('SKIPPED_DISABLED');
    await service.deleteSchedule(actor(owner, 'CAREGIVER'), disabled.schedule.id);
    const superseded = await makeRun();
    await service.updateSchedule(actor(owner, 'CAREGIVER'), superseded.schedule.id, {
      name: 'changed',
    });
    await scheduler.evaluatePendingRuns();
    expect((await repository.getCheckById(superseded.run.id))?.status).toBe('SKIPPED_SUPERSEDED');
  });
  it('TC005/007: M5 event lists, details, stats and SSE expose resident context only to its household', async () => {
    const check = await alert();
    const eventRepository = new EventsRepository(pool);
    expect(
      (
        await eventRepository.listEvents({
          page: 1,
          pageSize: 20,
          eventType: ['WELLNESS_TIMEOUT'],
          wellnessActorId: other,
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await eventRepository.listEvents({
          page: 1,
          pageSize: 20,
          eventType: ['WELLNESS_TIMEOUT'],
          wellnessActorId: resident,
        })
      ).total,
    ).toBe(1);
    const stats = await eventRepository.getEventStats(new Date(Date.now() - 60000), 20, other);
    expect(stats.byType.some((t) => t.event_type === 'WELLNESS_TIMEOUT')).toBe(false);
    const scopedEvents = new EventsService(
      eventRepository,
      {} as MediaService,
      {} as EscalationEngineService,
      {} as IStorageService,
      { verifyAccessToken: (token: string) => actor(token) } as TokenService,
    );
    await expect(scopedEvents.getEvent(check.event_id!, actor(other))).rejects.toMatchObject({
      status: 403,
    });
    const own: unknown[] = [],
      foreign: unknown[] = [];
    const a = scopedEvents.streamEvents(resident).subscribe((m) => own.push(m)),
      b = scopedEvents.streamEvents(other).subscribe((m) => foreign.push(m));
    await scopedEvents.publishCommittedUpdate(check.event_id!);
    expect(own).toHaveLength(1);
    expect(foreign).toHaveLength(0);
    a.unsubscribe();
    b.unsubscribe();
    const summary = await scopedEvents.toEventSummary(
      (await eventRepository.findEventSummaryById(check.event_id!))!,
    );
    expect(summary).toMatchObject({
      camera: null,
      confidence: null,
      wellnessResidentUserId: resident,
      wellnessResidentName: 'Resident QA',
      wellnessCheckId: check.id,
    });
  });
  it.each(['CLOSED', 'RESOLVED', 'ESCALATED'])(
    'TC016: rejects a new command for %s without creating an authoritative confirmation',
    async (status) => {
      const check = await alert();
      await worker.runOnce();
      await pool.query('UPDATE events SET status=$2::event_status WHERE id=$1', [
        check.event_id,
        status,
      ]);
      await expect(
        service.confirmCheck(actor(resident), check.id, {
          commandId: randomUUID(),
          response: 'IM_OK',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await row('SELECT status FROM events WHERE id=$1', [check.event_id])).status).toBe(
        status,
      );
      expect(
        (await row('SELECT count(*) FROM confirmations WHERE event_id=$1', [check.event_id])).count,
      ).toBe('0');
    },
  );
  it('TC012/021: two scheduler replicas create one active request; expired leases recover', async () => {
    const first = await makeRun(),
      second = await makeRun(1, { checkAt: '18:00' });
    const claimed = await repository.transaction((client) =>
      repository.claimPendingRuns(1, 30, client),
    );
    expect(claimed).toHaveLength(1);
    await pool.query(
      "UPDATE wellness_check_runs SET leased_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [claimed[0].id],
    );
    expect(await repository.reclaimExpiredLeases()).toBe(1);
    await Promise.all([
      scheduler.evaluatePendingRuns(),
      new WellnessSchedulerService(repository, config).evaluatePendingRuns(),
    ]);
    const decisions = await pool.query(
      'SELECT status FROM wellness_check_runs WHERE id=ANY($1::uuid[])',
      [[first.run.id, second.run.id]],
    );
    expect(decisions.rows.map((r) => r.status).sort()).toEqual([
      'ALERT_CREATED',
      'SKIPPED_SUPERSEDED',
    ]);
    expect(
      (await row("SELECT count(*) FROM events WHERE event_type='WELLNESS_TIMEOUT'")).count,
    ).toBe('1');
    expect((await row('SELECT count(*) FROM notifications')).count).toBe('1');
  });
});
