import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SMOKE_SH = join(ROOT, 'tools', 'cd', 'smoke.sh');
const DEPLOY_HOST_SH = join(ROOT, 'tools', 'cd', 'deploy-host.sh');

function hasCommand(cmd, args = ['--version']) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return res.status === 0;
}

describe('CD staging smoke scripts', () => {
  it('uses LF line endings and covers health, auth, internal smoke, and lambda', () => {
    const smokeText = readFileSync(SMOKE_SH, 'utf8');
    const deployHostText = readFileSync(DEPLOY_HOST_SH, 'utf8');

    assert.equal(smokeText.includes('\r\n'), false, 'tools/cd/smoke.sh must use LF');
    assert.equal(deployHostText.includes('\r\n'), false, 'tools/cd/deploy-host.sh must use LF');
    assert.match(smokeText, /\/api\/v1\/health/);
    assert.match(smokeText, /\/api\/v1\/auth\/config/);
    assert.match(smokeText, /\/api\/v1\/auth\/me/);
    assert.match(smokeText, /\/api\/v1\/internal\/smoke/);
    assert.match(smokeText, /aws lambda invoke/);
    assert.match(deployHostText, /\/api\/v1\/internal\/smoke/);
  });

  it('passes API, DB, Auth, and S3 checks against a mock staging endpoint when bash+jq+curl exist', async (t) => {
    if (
      process.platform === 'win32' ||
      !hasCommand('bash') ||
      !hasCommand('jq') ||
      !hasCommand('curl')
    ) {
      t.skip('bash/jq/curl integration test runs on POSIX CI runners');
      return;
    }

    const token = 'test-internal-token-that-is-at-least-32-chars';
    const releaseId = 'a'.repeat(40) + '-1-1';

    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/v1/health') {
        res.end(JSON.stringify({ status: 'ok', service: 'orchestrator', version: releaseId }));
        return;
      }
      if (req.url === '/login') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html>login</html>');
        return;
      }
      if (req.url === '/api/v1/auth/config') {
        res.end(JSON.stringify({ provider: 'jwt' }));
        return;
      }
      if (req.url === '/api/v1/auth/login' && req.method === 'POST') {
        res.end(JSON.stringify({ accessToken: 'jwt-access-token' }));
        return;
      }
      if (req.url === '/api/v1/auth/me') {
        if (req.headers.authorization !== 'Bearer jwt-access-token') {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        res.end(JSON.stringify({ id: 'u1', role: 'ADMIN' }));
        return;
      }
      if (req.url === '/api/v1/cameras' || req.url === '/api/v1/events?limit=1') {
        if (req.headers.authorization !== 'Bearer jwt-access-token') {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      if (req.url === '/api/v1/internal/smoke') {
        if (req.headers['x-internal-token'] !== token) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        res.end(
          JSON.stringify({
            status: 'ok',
            service: 'orchestrator',
            version: releaseId,
            checks: {
              database: { status: 'ok' },
              auth: { status: 'ok' },
              storage: { status: 'ok' },
              cloudQueue: { status: 'ok' },
            },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const res = spawnSync('bash', [SMOKE_SH], {
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_URL: `http://127.0.0.1:${port}`,
          RELEASE_ID: releaseId,
          SMOKE_INTERNAL_TOKEN: token,
          SMOKE_TEST_EMAIL: 'admin@camerai.local',
          SMOKE_TEST_PASSWORD: 'secret',
          FACE_FUNCTION_NAME: '',
        },
      });
      assert.equal(res.status, 0, `smoke.sh failed: ${res.stderr || res.stdout}`);
      assert.match(res.stdout, /All staging smoke checks passed/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
