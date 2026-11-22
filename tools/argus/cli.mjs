#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const profiles = {
  local: {
    AUTH_PROVIDER: 'jwt',
    STORAGE_PROVIDER: 'minio',
    FACE_PROVIDER: 'local',
    FACE_JOB_TRANSPORT: 'bullmq',
    APPLICATION_RESULTS_CONSUMER_ENABLED: 'false',
  },
  cloud: {
    AUTH_PROVIDER: 'cognito',
    STORAGE_PROVIDER: 's3',
    FACE_PROVIDER: 'rekognition',
    FACE_JOB_TRANSPORT: 'sqs',
    APPLICATION_RESULTS_CONSUMER_ENABLED: 'true',
  },
};

const root = fileURLToPath(new URL('../../', import.meta.url));
const services = ['ai-service', 'orchestrator', 'web'];
const modeQuery = 'SELECT mode FROM public.cloud_transport_mode WHERE singleton';
const queueKeys = [
  'FACE_JOBS_QUEUE_URL',
  'NOTIFICATION_JOBS_QUEUE_URL',
  'APPLICATION_RESULTS_QUEUE_URL',
];
const notificationMigration = '0025_notification_claim_outcome.sql';
const notificationEmailMigration = '0025_notification_email_rules.sql';
const cloudMigrations = new Map([
  ['0017_cognito_issuer.sql', "to_regclass('public.idx_users_cognito_identity') IS NOT NULL"],
  ['0018_aws_queue_pipeline.sql', "to_regclass('public.cloud_transport_mode') IS NOT NULL"],
  [
    '0018_cognito_email.sql',
    "EXISTS (SELECT FROM pg_attribute WHERE attrelid = to_regclass('public.users') AND attname = 'cognito_email' AND NOT attisdropped)",
  ],
  [
    '0019_household_access.sql',
    "to_regprocedure('public.shares_camera_household(uuid, uuid)') IS NOT NULL",
  ],
  [
    notificationMigration,
    `to_regclass('public.cloud_notification_attempts') IS NOT NULL
      AND EXISTS (SELECT FROM pg_attribute
        WHERE attrelid = to_regclass('public.cloud_transport_mode')
          AND attname = 'notification_driver' AND NOT attisdropped)`,
  ],
  [
    notificationEmailMigration,
    `(SELECT count(*) FROM public.escalation_rules
      WHERE event_type IN ('FIRE_SMOKE_DETECTED', 'FALL_DETECTED', 'RESTRICTED_ZONE', 'UNKNOWN_PERSON')
        AND notify_channels ? 'SNS_EMAIL') = 4`,
  ],
]);

// Match whole assignments so that KEY= lines within quoted values stay untouched.
const assignment =
  /^(\uFEFF?)(?:[\t ]*export[\t ]+)?[\t ]*([\w.-]+)[\t ]*=[\t ]*(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`[^`]*`|[^\r\n#]*)([\t ]*#[^\r\n]*)?/gm;

export function updateEnv(source, changes) {
  const pending = new Map(Object.entries(changes));
  const edited = source.replace(assignment, (original, prefix, key, comment) => {
    if (!Object.hasOwn(changes, key)) return original;
    pending.delete(key);
    return `${prefix}${key}=${changes[key]}${comment ? ` ${comment.trimStart()}` : ''}`;
  });
  if (!pending.size) return edited;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const additions = [...pending].map(([key, value]) => `${key}=${value}`).join(newline);
  return `${edited}${edited && !edited.endsWith('\n') ? newline : ''}${additions}${newline}`;
}

function makeChanges(mode, env) {
  const changes = { ...profiles[mode] };
  const localBucket =
    (env.STORAGE_PROVIDER !== 's3' && env.STORAGE_BUCKET) ||
    env.ARGUS_LOCAL_STORAGE_BUCKET ||
    'camerai-media';
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(localBucket)) {
    throw new Error(
      'Tên bucket MinIO không hợp lệ. Kiểm tra STORAGE_BUCKET và ARGUS_LOCAL_STORAGE_BUCKET.',
    );
  }
  if (mode === 'local') {
    changes.STORAGE_BUCKET = localBucket;
    if (!env.JWT_SECRET?.trim()) changes.JWT_SECRET = randomBytes(48).toString('base64url');
    return changes;
  }

  const required = [
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'S3_BUCKET',
    'COGNITO_USER_POOL_ID',
    'COGNITO_CLIENT_ID',
    'COGNITO_DOMAIN',
    'INTERNAL_SERVICE_TOKEN',
    ...queueKeys,
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Điền các biến Dev Cloud trong .env: ${missing.join(', ')}.`);
  if (env.INTERNAL_SERVICE_TOKEN.length < 32) {
    throw new Error('INTERNAL_SERVICE_TOKEN cần ít nhất 32 ký tự.');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET)) {
    throw new Error('S3_BUCKET cần là tên bucket S3 của Dev Cloud.');
  }
  const poolRegion = /^([a-z0-9-]+)_\w+$/.exec(env.COGNITO_USER_POOL_ID)?.[1];
  if (poolRegion !== env.AWS_REGION) {
    throw new Error('COGNITO_USER_POOL_ID cần khớp AWS_REGION.');
  }
  if (!URL.canParse(env.COGNITO_DOMAIN) || !/^https:\/\/[^/@?#]+\/?$/.test(env.COGNITO_DOMAIN)) {
    throw new Error('COGNITO_DOMAIN cần là HTTPS origin của Cognito dev.');
  }
  const queues = queueKeys.map((key) => {
    const value = env[key];
    const url = URL.canParse(value) && new URL(value);
    if (
      !url ||
      url.origin !== `https://sqs.${env.AWS_REGION}.amazonaws.com` ||
      !/^\/\d{12}\/[\w-]+$/.test(url.pathname) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error(`${key} cần là URL của Standard SQS queue trong AWS_REGION.`);
    }
    return `${url.origin}${url.pathname}`;
  });
  if (new Set(queues).size !== queues.length) throw new Error('Điền ba SQS queue khác nhau.');

  return {
    ...changes,
    STORAGE_BUCKET: env.S3_BUCKET,
    ARGUS_LOCAL_STORAGE_BUCKET: localBucket,
  };
}

function openDevCompose(projectRoot, env) {
  const childEnv = { ...process.env };
  // Compose prioritizes the shell over .env for interpolation.
  for (const key of [
    ...Object.keys(env),
    ...Object.keys(profiles.local),
    'STORAGE_BUCKET',
    'COMPOSE_PROJECT_NAME',
    'COMPOSE_ENV_FILES',
  ]) {
    delete childEnv[key];
  }
  const args = [
    'compose',
    '--project-directory',
    projectRoot,
    '--env-file',
    '.env',
    '-f',
    'docker-compose.yml',
  ];
  return (step, command, { input, output = 'pipe' } = {}) => {
    const result = spawnSync('docker', [...args, ...command], {
      cwd: projectRoot,
      env: childEnv,
      input,
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', output, 'pipe'],
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.status !== 0) {
      // Compose errors can include values from the dotenv file.
      throw new Error(`${step} thất bại. Kiểm tra Docker Desktop và \`docker compose ps\`.`);
    }
    return result.stdout?.trim();
  };
}

function readJson(source, step) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${step} trả về dữ liệu không hợp lệ.`);
  }
}

function postgres(compose) {
  const { services: resolved } = readJson(
    compose('Đọc cấu hình Compose dev', ['config', '--format', 'json']),
    'Docker Compose',
  );
  const { POSTGRES_USER: user, POSTGRES_DB: database } = resolved.postgres.environment;
  const env = resolved.orchestrator.environment;
  const url = URL.canParse(env.DATABASE_URL) && new URL(env.DATABASE_URL);
  if (
    !url ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== 'postgres' ||
    (url.port && url.port !== '5432') ||
    url.pathname !== `/${encodeURIComponent(database)}` ||
    url.username !== encodeURIComponent(user)
  ) {
    throw new Error('DATABASE_URL cần trỏ tới đúng PostgreSQL dev của Compose (postgres:5432).');
  }
  return {
    env,
    query: (step, sql) =>
      compose(
        step,
        [
          'exec',
          '-T',
          'postgres',
          'sh',
          '-c',
          'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
        ],
        { input: `${sql}\n` },
      ),
    dump: (output) =>
      compose(
        'Sao lưu PostgreSQL dev',
        [
          'exec',
          '-T',
          'postgres',
          'sh',
          '-c',
          'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
        ],
        { output },
      ),
  };
}

function backup(projectRoot, db, mode) {
  console.log('Đang sao lưu PostgreSQL dev…');
  const directory = join(projectRoot, 'artifacts', 'argus');
  mkdirSync(directory, { recursive: true });
  const name = `before-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;
  const file = join(directory, name);
  try {
    const fd = openSync(file, 'wx', 0o600);
    try {
      db.dump(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (error.code !== 'EEXIST' && existsSync(file)) unlinkSync(file);
    throw error;
  }
  console.log(`Đã sao lưu PostgreSQL: artifacts/argus/${name}`);
}

function databaseMode(db) {
  const hasTable = db.query(
    'Kiểm tra migration PostgreSQL',
    "SELECT to_regclass('public.cloud_transport_mode') IS NOT NULL;",
  );
  if (hasTable !== 't')
    throw new Error(
      'Thiếu migration 0018_aws_queue_pipeline.sql. Cập nhật schema dev rồi chạy lại.',
    );
  const mode = db.query('Đọc mode PostgreSQL', `${modeQuery};`);
  if (!['bullmq', 'sqs'].includes(mode))
    throw new Error('PostgreSQL dev thiếu dòng cloud_transport_mode hợp lệ.');
  return mode;
}

function cloudSchema(db) {
  const missingQuery = [...cloudMigrations]
    .map(([file, applied]) => `SELECT '${file}' WHERE NOT (${applied})`)
    .join('\nUNION ALL\n');
  const pending = new Set(db.query('Kiểm tra schema dev', `${missingQuery};`).split(/\r?\n/));
  return [...cloudMigrations.keys()].filter((file) => pending.has(file));
}

function applyCloudMigrations(projectRoot, db, pending) {
  const migrations = pending.map((file) => {
    const sql = readFileSync(join(projectRoot, 'db', 'migrations', file), 'utf8').trim();
    if (!/^BEGIN;\r?\n[\s\S]+\r?\nCOMMIT;$/i.test(sql)) {
      throw new Error(`Kiểm tra lại transaction của ${file}.`);
    }
    return sql.replace(/^BEGIN;\r?\n|\r?\nCOMMIT;$/gi, '');
  });
  // Docker's initial SQL scripts do not create schema_migrations. Preserve the
  // existing convention and update history only for databases that track it.
  const history = db.query(
    'Kiểm tra lịch sử migration',
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL;",
  );
  const record =
    history === 't'
      ? `INSERT INTO public.schema_migrations (filename) VALUES ${pending.map((file) => `('${file}')`).join(', ')} ON CONFLICT DO NOTHING;`
      : '';
  db.query('Chạy migration dev', ['BEGIN;', ...migrations, record, 'COMMIT;'].join('\n'));
  console.log(`Đã áp dụng migration: ${pending.join(', ')}.`);
}

function setDatabaseMode(db, mode) {
  const saved = db.query(
    'Đổi mode PostgreSQL',
    `UPDATE public.cloud_transport_mode SET mode = '${mode}' WHERE singleton RETURNING mode;`,
  );
  if (saved !== mode) throw new Error('PostgreSQL dev chưa xác nhận mode mới.');
}

function recreate(compose, selectedServices) {
  if (!selectedServices.length) return;
  compose('Tạo lại container dev', [
    'up',
    '-d',
    '--no-deps',
    '--force-recreate',
    '--wait',
    '--wait-timeout',
    '150',
    ...selectedServices,
  ]);
}

function switchMode(projectRoot, mode, openCompose) {
  const file = join(projectRoot, '.env');
  const lock = join(projectRoot, '.env.argus-lock');
  const temp = join(lock, 'next');
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error('Một lần chuyển khác đang chạy. Xem .env.argus-lock nếu lệnh trước bị ngắt.');
    throw error;
  }

  try {
    const original = readFileSync(file, 'utf8');
    const parsed = parseEnv(original);
    const compose = openCompose(projectRoot, parsed);
    const db = postgres(compose);
    const changes = makeChanges(mode, db.env);
    const next = updateEnv(original, changes);
    const target = changes.FACE_JOB_TRANSPORT;
    const pending = cloudSchema(db);
    const missingPrerequisites = pending.filter(
      (file) => file !== notificationMigration && file !== notificationEmailMigration,
    );
    if (mode === 'local' && missingPrerequisites.length) {
      throw new Error(`PostgreSQL dev thiếu migration nền: ${missingPrerequisites.join(', ')}.`);
    }
    if (
      pending.length &&
      db.query(
        'Kiểm tra schema nền',
        "SELECT to_regclass('public.resident_wellness_source_evidence') IS NOT NULL;",
      ) !== 't'
    ) {
      throw new Error(
        'PostgreSQL dev chưa có schema đến migration 0016. Cập nhật schema dev rồi chạy lại.',
      );
    }
    let previous = pending.includes('0018_aws_queue_pipeline.sql') ? 'bullmq' : databaseMode(db);
    const running = compose('Đọc trạng thái container dev', [
      'ps',
      '--status',
      'running',
      '--services',
    ]).split(/\r?\n/);

    if (pending.length || (mode === 'cloud' && previous !== target)) backup(projectRoot, db, mode);

    let envChanged = false;
    let dbChanged = false;
    const replaceEnv = (expected, content) => {
      if (readFileSync(file, 'utf8') !== expected) {
        throw new Error('.env đã được chỉnh trong khi Argus chạy. Kiểm tra lại .env rồi chạy lại.');
      }
      writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
      renameSync(temp, file);
    };

    console.log(`Đang chuyển sang Dev ${mode === 'cloud' ? 'Cloud' : 'Local'}…`);
    compose('Dừng Orchestrator dev', ['stop', 'orchestrator']);
    let recreating = false;
    try {
      if (pending.length) {
        applyCloudMigrations(projectRoot, db, pending);
        previous = databaseMode(db);
      }
      if (next !== original) {
        replaceEnv(original, next);
        envChanged = true;
      }
      if (previous !== target) {
        dbChanged = true;
        setDatabaseMode(db, target);
      }
      recreating = true;
      recreate(compose, services);
      const auth = readJson(
        compose('Kiểm tra auth/config', [
          'exec',
          '-T',
          'orchestrator',
          'wget',
          '-qO-',
          'http://localhost:3001/api/v1/auth/config',
        ]),
        'auth/config',
      );
      if (auth.provider !== changes.AUTH_PROVIDER)
        throw new Error('Orchestrator đang dùng AUTH_PROVIDER khác cấu hình mới.');
    } catch (error) {
      try {
        const affected = recreating ? services : ['orchestrator'];
        if (recreating) compose('Dừng dịch vụ dev để khôi phục', ['stop', ...affected]);
        if (dbChanged) setDatabaseMode(db, previous);
        if (envChanged) replaceEnv(next, original);
        recreate(
          compose,
          affected.filter((service) => running.includes(service)),
        );
        console.error('Đã khôi phục cấu hình trước khi chuyển.');
      } catch {
        console.error(
          'Chưa khôi phục được hoàn toàn. Chạy `argus status`, kiểm tra Docker rồi chạy lại chế độ cần dùng.',
        );
      }
      throw error;
    }

    if (changes.JWT_SECRET) console.log('Đã tạo JWT_SECRET cho Dev Local trong .env.');
    console.log(
      `Dev ${mode === 'cloud' ? 'Cloud' : 'Local'} đã sẵn sàng (${changes.AUTH_PROVIDER}, ${changes.STORAGE_PROVIDER}, ${target}).`,
    );
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
    rmdirSync(lock);
  }
}

export function run(command, projectRoot = root, openCompose = openDevCompose) {
  if (!command.length || (command.length === 1 && ['help', '-h', '--help'].includes(command[0]))) {
    console.log(
      `Argus · chuyển chế độ dev\n\n  pnpm argus local    JWT + MinIO + BullMQ\n  pnpm argus cloud    Cognito + S3 + Rekognition + SQS\n  pnpm argus status   Xem cấu hình và mode PostgreSQL\n\nDùng tại môi trường dev Docker Compose. Xem docs/DEV_ONBOARDING.md để thiết lập lần đầu.`,
    );
    return;
  }
  const [mode] = command;
  if (command.length !== 1 || !['local', 'cloud', 'status'].includes(mode)) {
    throw new Error('Dùng `pnpm argus local`, `pnpm argus cloud` hoặc `pnpm argus status`.');
  }
  const file = join(projectRoot, '.env');
  if (!existsSync(file))
    throw new Error('Chưa có .env. Tạo cấu hình dev theo docs/DEV_ONBOARDING.md.');
  if (mode !== 'status') return switchMode(projectRoot, mode, openCompose);

  const env = parseEnv(readFileSync(file, 'utf8'));
  const modeFromFile = Object.keys(profiles).find((name) =>
    Object.entries(profiles[name]).every(
      ([key, value]) => (env[key] || profiles.local[key]) === value,
    ),
  );
  console.log(
    `.env: ${modeFromFile ? `Dev ${modeFromFile === 'local' ? 'Local' : 'Cloud'}` : 'cấu hình hỗn hợp'}`,
  );
  if (!modeFromFile) {
    for (const [key, local] of Object.entries(profiles.local)) {
      const value = env[key] || local;
      console.log(
        `  ${key}=${[local, profiles.cloud[key]].includes(value) ? value : '(khác preset)'}`,
      );
    }
  }
  const db = postgres(openCompose(projectRoot, env));
  const persisted = databaseMode(db);
  console.log(`PostgreSQL: ${persisted}`);
  if (persisted !== (env.FACE_JOB_TRANSPORT || 'bullmq')) {
    console.log(
      'Mode PostgreSQL lệch .env. Chạy `pnpm argus local` hoặc `pnpm argus cloud` để đồng bộ.',
    );
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(
      error.code && error.code !== 'ENOENT'
        ? `Argus: thao tác thất bại (${error.code}).`
        : `Argus: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
