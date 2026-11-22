import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import { run, updateEnv } from '../../argus/cli.mjs';

const localEnv = `AUTH_PROVIDER=jwt
STORAGE_PROVIDER=minio
STORAGE_BUCKET=my-local-bucket
FACE_PROVIDER=local
FACE_JOB_TRANSPORT=bullmq
APPLICATION_RESULTS_CONSUMER_ENABLED=false
DATABASE_URL=postgresql://dev@postgres:5432/dev
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=dev-key
AWS_SECRET_ACCESS_KEY=dev-secret
S3_BUCKET=dev-media
COGNITO_USER_POOL_ID=ap-southeast-1_pool
COGNITO_CLIENT_ID=dev-client
COGNITO_DOMAIN=https://dev.example.com
INTERNAL_SERVICE_TOKEN=${'x'.repeat(32)}
FACE_JOBS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/000000000000/dev-face
NOTIFICATION_JOBS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/000000000000/dev-notify
APPLICATION_RESULTS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/000000000000/dev-results
`;

function setup(t, source = localEnv) {
  const root = mkdtempSync(join(tmpdir(), 'argus-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, '.env');
  writeFileSync(path, source);
  const state = { mode: 'bullmq', commands: [], pending: [], failUp: false };
  const read = () => readFileSync(path, 'utf8');
  const compose =
    () =>
    (step, args, { input, output } = {}) => {
      state.commands.push(args[0]);
      if (args[0] === 'config') {
        return JSON.stringify({
          services: {
            postgres: { environment: { POSTGRES_USER: 'dev', POSTGRES_DB: 'dev' } },
            orchestrator: { environment: parseEnv(read()) },
          },
        });
      }
      if (args[0] === 'ps') return 'ai-service\norchestrator\nweb';
      if (args[0] === 'stop') return '';
      if (args[0] === 'up') {
        assert.ok(args.includes('--force-recreate'));
        assert.ok(args.includes('ai-service'));
        assert.equal(parseEnv(read()).FACE_JOB_TRANSPORT, state.mode);
        if (state.failUp) {
          state.failUp = false;
          throw new Error('Unhealthy container');
        }
        return '';
      }
      if (args[2] === 'orchestrator')
        return JSON.stringify({ provider: parseEnv(read()).AUTH_PROVIDER });
      if (output !== undefined) {
        state.commands.push('backup');
        writeFileSync(output, Buffer.from([0x50, 0x47, 0x44, 0x4d, 0x50, 0x00, 0xff]));
        return;
      }
      if (input.startsWith('UPDATE ')) {
        state.mode = /SET mode = '(\w+)'/.exec(input)[1];
        state.commands.push(`mode:${state.mode}`);
        return state.mode;
      }
      if (input.startsWith('SELECT mode ')) return state.mode;
      if (input.startsWith("SELECT '0017_cognito_issuer.sql'")) {
        return state.pending.filter((file) => input.includes(`'${file}'`)).join('\n');
      }
      if (input.startsWith("SELECT to_regclass('public.schema_migrations')")) return 'f';
      if (input.startsWith('SELECT to_regclass(')) return 't';
      if (input.startsWith('BEGIN;')) {
        assert.equal((input.match(/\bBEGIN;/g) ?? []).length, 1);
        if (state.pending.includes('0018_aws_queue_pipeline.sql')) {
          assert.match(input, /CREATE TABLE cloud_transport_mode/);
        }
        if (state.pending.includes('0025_notification_claim_outcome.sql')) {
          assert.match(input, /ALTER TABLE cloud_transport_mode ADD COLUMN notification_driver/);
          assert.match(input, /CREATE TABLE cloud_notification_attempts/);
        }
        if (state.pending.includes('0025_notification_email_rules.sql')) {
          assert.match(input, /UPDATE escalation_rules/);
          assert.match(input, /SNS_EMAIL/);
        }
        assert.match(input, /COMMIT;\s*$/);
        state.commands.push('migrate');
        return '';
      }
      assert.fail(`Unexpected step ${step}`);
    };
  return { root, state, read, switchTo: (mode) => run([mode], root, compose) };
}

test('editing profiles preserves comments, duplicate assignments and multiline secrets', () => {
  const secret = `OTHER="long\r\nAUTH_PROVIDER=part-of-secret\r\nvalue"`;
  const before = `${secret}\r\nexport AUTH_PROVIDER=jwt # old\r\nAUTH_PROVIDER=jwt\r\n`;
  const after = updateEnv(before, { AUTH_PROVIDER: 'cognito', FACE_PROVIDER: 'rekognition' });
  assert.equal(
    after,
    `${secret}\r\nAUTH_PROVIDER=cognito # old\r\nAUTH_PROVIDER=cognito\r\nFACE_PROVIDER=rekognition\r\n`,
  );
});

test('switches both ways, backs up binary data and restores the local bucket', (t) => {
  const { root, state, read, switchTo } = setup(t);
  switchTo('cloud');
  const env = parseEnv(read());
  assert.equal(env.AUTH_PROVIDER, 'cognito');
  assert.equal(env.STORAGE_BUCKET, 'dev-media');
  assert.equal(env.FACE_PROVIDER, 'rekognition');
  assert.equal(env.APPLICATION_RESULTS_CONSUMER_ENABLED, 'true');
  assert.ok(state.commands.indexOf('backup') < state.commands.indexOf('mode:sqs'));
  assert.ok(state.commands.indexOf('stop') < state.commands.indexOf('mode:sqs'));
  const directory = join(root, 'artifacts', 'argus');
  const [dump] = readdirSync(directory);
  assert.deepEqual([...readFileSync(join(directory, dump))], [80, 71, 68, 77, 80, 0, 255]);

  switchTo('local');
  const restored = parseEnv(read());
  assert.equal(restored.AUTH_PROVIDER, 'jwt');
  assert.equal(restored.STORAGE_PROVIDER, 'minio');
  assert.equal(restored.STORAGE_BUCKET, 'my-local-bucket');
  assert.equal(restored.FACE_PROVIDER, 'local');
  assert.equal(restored.APPLICATION_RESULTS_CONSUMER_ENABLED, 'false');
  assert.equal(restored.AWS_SECRET_ACCESS_KEY, env.AWS_SECRET_ACCESS_KEY);
  assert.ok(restored.JWT_SECRET.length >= 32);
  assert.equal(state.mode, 'bullmq');
});

test('rejects missing cloud config before stopping services or updating .env', (t) => {
  const source = updateEnv(localEnv, { APPLICATION_RESULTS_QUEUE_URL: '' });
  const { state, read, switchTo } = setup(t, source);
  assert.throws(() => switchTo('cloud'), /APPLICATION_RESULTS_QUEUE_URL/);
  assert.deepEqual(state.commands, ['config']);
  assert.equal(read(), source);
});

for (const mode of ['cloud', 'local']) {
  test(`applies missing incident email rules before recreating services in ${mode} mode`, (t) => {
    const { root, state, switchTo } = setup(t);
    cpSync(new URL('../../../db/migrations', import.meta.url), join(root, 'db', 'migrations'), {
      recursive: true,
    });
    state.pending = ['0025_notification_email_rules.sql'];
    switchTo(mode);
    const migration = state.commands.indexOf('migrate');
    assert.ok(migration > state.commands.indexOf('stop'));
    assert.ok(migration > state.commands.indexOf('backup'));
    assert.ok(migration < state.commands.indexOf('up'));
  });
}

test('applies the missing cloud migration before changing the DB mode', (t) => {
  const { root, state, switchTo } = setup(t);
  cpSync(new URL('../../../db/migrations', import.meta.url), join(root, 'db', 'migrations'), {
    recursive: true,
  });
  state.pending = ['0018_aws_queue_pipeline.sql'];
  switchTo('cloud');
  assert.ok(state.commands.indexOf('backup') < state.commands.indexOf('migrate'));
  assert.ok(state.commands.indexOf('stop') < state.commands.indexOf('migrate'));
  assert.ok(state.commands.indexOf('migrate') < state.commands.indexOf('mode:sqs'));
});

for (const mode of ['cloud', 'local']) {
  test(`migrates a schema at 0019 before recreating Orchestrator in ${mode} mode`, (t) => {
    const source = localEnv + 'NOTIFICATION_DRIVER=local\n';
    const { root, state, read, switchTo } = setup(t, source);
    cpSync(new URL('../../../db/migrations', import.meta.url), join(root, 'db', 'migrations'), {
      recursive: true,
    });
    state.pending = ['0025_notification_claim_outcome.sql'];
    switchTo(mode);
    const migration = state.commands.indexOf('migrate');
    assert.ok(
      migration > state.commands.indexOf('backup') && migration > state.commands.indexOf('stop'),
    );
    assert.ok(migration < state.commands.indexOf('up'));
    assert.equal(parseEnv(read()).NOTIFICATION_DRIVER, 'local');
    assert.equal(state.mode, mode === 'cloud' ? 'sqs' : 'bullmq');
  });
}

test('local mode rejects an old schema before stopping services', (t) => {
  const { state, switchTo } = setup(t);
  state.pending = ['0019_household_access.sql', '0025_notification_claim_outcome.sql'];
  assert.throws(() => switchTo('local'), /0019_household_access/);
  assert.ok(!state.commands.includes('stop'));
});

test('restores .env and database mode after a failed startup', (t) => {
  const { state, read, switchTo } = setup(t);
  state.failUp = true;
  assert.throws(() => switchTo('cloud'), /Unhealthy container/);
  assert.equal(read(), localEnv);
  assert.equal(state.mode, 'bullmq');
  assert.deepEqual(state.commands.slice(-5), ['up', 'stop', 'exec', 'mode:bullmq', 'up']);
});
