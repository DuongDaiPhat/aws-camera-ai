/** Local UI regression review; API fixtures exist only in this isolated browser. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = new URL(process.argv[2] || 'http://127.0.0.1:3002').origin;
assert.ok(
  ['localhost', '127.0.0.1'].includes(new URL(web).hostname),
  'Only local UI review is allowed',
);
import { mkdir, writeFile } from 'node:fs/promises';
const requireQa = createRequire(join(root, 'artifacts/m3/browser-qa/package.json'));
const { chromium } = requireQa('playwright');
const out = resolve(process.argv[3] || join(root, 'artifacts/ui-refresh-v3'));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const unexpectedWrites = [];
context.on('request', (request) => {
  const url = new URL(request.url());
  if (
    url.pathname.includes('/api/v1/') &&
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) &&
    !url.pathname.endsWith('/auth/login')
  )
    unexpectedWrites.push(url.pathname);
});
const errors = [],
  unknown = new Set(),
  layouts = [];
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.log('BROWSER:', message.text());
});
const now = new Date().toISOString();
const user = {
  id: 'qa-admin',
  fullName: 'Nguyễn Minh Anh',
  email: 'qa@example.test',
  role: 'ADMIN',
  isActive: true,
  createdAt: now,
};
const events = [
  {
    id: 'qa-motion',
    eventType: 'PERSON_DETECTED',
    status: 'RESOLVED',
    priority: 'P3',
    confidence: 0.95,
    isFalseAlarm: false,
    detectedAt: now,
    camera: { id: 'qa-camera', name: 'Camera phòng khách' },
    zone: { id: 'qa-zone', name: 'Phòng khách' },
  },
  {
    id: 'qa-fall',
    eventType: 'FALL_DETECTED',
    status: 'NOTIFIED',
    priority: 'P1',
    confidence: 0.92,
    isFalseAlarm: false,
    detectedAt: now,
    camera: { id: 'qa-camera', name: 'Camera phòng khách' },
    zone: { id: 'qa-zone', name: 'Phòng khách' },
  },
];
const stats = {
  cameraTotalCount: 2,
  cameraOnlineCount: 1,
  totalEvents: 2,
  personDetectedCount: 1,
  pendingCount: 1,
  windowHours: 24,
  latestPendingEvent: {
    id: 'qa-fall',
    cameraName: 'Camera phòng khách',
    zoneName: 'Phòng khách',
    detectedAt: now,
  },
};
await context.route('**/api/v1/**', async (route) => {
  const url = new URL(route.request().url()),
    path = url.pathname.split('/api/v1')[1];
  if (route.request().method() === 'OPTIONS')
    return route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': web,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE',
      },
    });
  if (path === '/events/stream')
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': ready\n\n' });
  let data;
  if (path === '/auth/login')
    data = { accessToken: 'browser-qa-only', refreshToken: 'qa-only', expiresIn: 3600 };
  else if (path === '/auth/me') data = user;
  else if (path === '/events/stats') data = stats;
  else if (path === '/events') {
    const list = url.searchParams.has('eventType')
      ? events.filter((event) => event.eventType === 'FIRE_SMOKE_DETECTED')
      : events;
    data = { data: list, meta: { total: list.length, page: 1, pageSize: 100 } };
  } else if (path === '/events/qa-fire')
    data = {
      ...events.find((event) => event.id === 'qa-fire'),
      media: [],
      aiResults: [],
      statusHistory: [],
      confirmations: [],
    };
  else if (path === '/cameras' || path === '/known-faces' || path === '/wellness-schedules')
    data = { data: [] };
  else if (path === '/wellness-checks') data = { data: [], total: 0 };
  else if (path === '/escalation-rules')
    data = {
      data: [
        {
          eventType: 'FIRE_SMOKE_DETECTED',
          displayName: 'Phát hiện lửa',
          priority: 'P0',
          tLow: 0.5,
          tHigh: 0.7,
          tWaitSeconds: 30,
          version: 1,
          isEnabled: true,
          highWaitSeconds: null,
          effectiveHighWaitSeconds: 30,
          skipLoggedOnly: true,
          updatedAt: now,
          updatedByName: user.fullName,
        },
      ],
    };
  else {
    unknown.add(path);
    data = { data: [] };
  }
  return route.fulfill({ status: 200, json: data });
});
async function layout(name) {
  const result = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  layouts.push({ name, ...result });
  assert.ok(result.document <= result.viewport, `Overflow ${name}: ${JSON.stringify(result)}`);
}
async function screenshot(name) {
  console.log('Reviewing ' + name);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}

async function nav(id, label) {
  await page
    .getByRole('navigation', { name: 'Các trang quản lý' })
    .locator('button[data-value="' + id + '"]')
    .click();
  await page.getByRole('heading', { level: 1, name: label, exact: true }).waitFor();
  await page.waitForTimeout(350);
}
try {
  const fontResponse = await page.request.get(web + '/fonts/inter-variable.ttf');
  assert.equal(fontResponse.status(), 200);
  await page.goto(web + '/login');
  await page.waitForTimeout(1800);
  await screenshot('login-desktop');
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByLabel('Email', { exact: true }).fill('qa@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('browser-qa-only');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.waitForURL(web + '/');
  await page.getByText('Nguyễn Minh Anh', { exact: true }).waitFor();
  const canvas = page.locator('canvas');
  await canvas.waitFor();
  await page.waitForTimeout(1800);
  await screenshot('dashboard-assembled');
  await layout('dashboard desktop');
  const base = await canvas.screenshot();
  await page.getByRole('button', { name: 'Khám phá bên trong', exact: true }).click();
  await page.getByText('Bên trong hệ thống', { exact: true }).waitFor();
  await page.waitForTimeout(1800);
  assert.notDeepEqual(base, await canvas.screenshot());
  await screenshot('dashboard-exploded');
  await page.getByRole('button', { name: 'Lắp lại camera', exact: true }).click();
  await page.waitForTimeout(1500);
  let clicked = false;
  for (const [x, y] of [
    [0.55, 0.5],
    [0.65, 0.55],
    [0.6, 0.6],
  ]) {
    const rect = await canvas.boundingBox();
    await canvas.click({ position: { x: rect.width * x, y: rect.height * y } });
    if (await page.getByRole('button', { name: 'Lắp lại camera', exact: true }).count()) {
      clicked = true;
      break;
    }
  }
  assert.equal(clicked, true, 'Click camera must explode the actual model');
  await page.waitForTimeout(1500);
  const beforeZoom = await canvas.screenshot();
  await page.getByRole('button', { name: 'Phóng to', exact: true }).click();
  await page.waitForTimeout(500);
  assert.notDeepEqual(beforeZoom, await canvas.screenshot());
  await page.getByRole('button', { name: 'Đặt lại góc nhìn', exact: true }).click();
  const pill = page.locator('[data-nav-indicator="navigation"]');
  const first = await pill.boundingBox();
  const handle = await pill.elementHandle();
  await page.locator('button[data-value="settings"]').hover();
  await page.waitForTimeout(100);
  const middle = await pill.boundingBox();
  await page.waitForTimeout(450);
  await page.waitForFunction(() => {
    const indicator = document.querySelector('[data-nav-indicator="navigation"]');
    const target = document.querySelector('button[data-value="settings"]');
    return (
      indicator &&
      target &&
      Math.abs(indicator.getBoundingClientRect().x - target.getBoundingClientRect().x) < 2
    );
  });
  await page.waitForFunction(() => {
    const active = document.querySelector('button[data-value="dashboard"]');
    const hovered = document.querySelector('button[data-value="settings"]');
    return (
      active &&
      hovered &&
      getComputedStyle(active).color === 'rgb(116, 60, 201)' &&
      getComputedStyle(hovered).color === 'rgb(255, 255, 255)'
    );
  });
  const last = await pill.boundingBox();
  assert.equal(await handle.evaluate((element) => element.isConnected), true);
  assert.ok(last.x > first.x);
  assert.ok(middle.x > first.x && middle.x <= last.x + 1);
  assert.equal(
    await page.locator('button[data-value="dashboard"]').getAttribute('aria-current'),
    'page',
  );
  const activeBorder = await page.locator('button[data-value="dashboard"]').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: parseFloat(style.borderTopWidth),
      color: style.borderTopColor,
      background: style.backgroundColor,
    };
  });
  assert.ok(
    activeBorder.width >= 1 && activeBorder.color !== 'rgba(0, 0, 0, 0)',
    'Current page must keep a visible border while hovering elsewhere',
  );
  await screenshot('menu-hover');
  await page.mouse.move(2, 2);
  await page.waitForTimeout(350);
  let priorDemo = null;
  for (const [id, label, result] of [
    ['fire', 'Lửa & khói', 'Nguy hiểm · Phát hiện lửa'],
    ['fall', 'Phát hiện té ngã', 'Cần kiểm tra · Dấu hiệu té ngã'],
    ['face', 'Nhận diện người', 'Nhận diện · Đối chiếu khuôn mặt'],
    ['zone', 'Khu vực giám sát', 'Khu vực · Có người đi vào vùng'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.locator('[data-camera-mode="' + id + '"]').waitFor();
    await page.getByText(result, { exact: true }).waitFor();
    await page.waitForTimeout(2200);
    const rendered = await canvas.screenshot();
    if (priorDemo)
      assert.notDeepEqual(rendered, priorDemo, 'Each feature must render a distinct 3D scenario');
    priorDemo = rendered;
    await screenshot('simulation-' + id);
  }
  await page.getByRole('button', { name: 'Đóng mô phỏng', exact: true }).click();
  await page.waitForTimeout(1000);
  for (const width of [768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(800);
    await layout('dashboard ' + width);
    await screenshot('dashboard-' + width);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Nhận diện người', exact: true }).click();
  await page.getByRole('button', { name: 'Quản lý người quen', exact: true }).click();
  await page.getByRole('heading', { name: 'Người quen', level: 1, exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const pages = [
    ['cameras', 'Camera trực tiếp'],
    ['events', 'Lịch sử sự kiện'],
    ['known-faces', 'Người quen'],
    ['zones', 'Khu vực giám sát'],
    ['wellness', 'Kiểm tra sức khỏe'],
    ['settings', 'Cài đặt cảnh báo'],
  ];
  for (const [id, label] of pages) {
    await nav(id, label);
    await layout(id + ' desktop');
    await screenshot(id + '-desktop');
  }
  await page.setViewportSize({ width: 375, height: 900 });
  for (const [id, label] of pages) {
    await nav(id, label);
    await layout(id + ' mobile');
    await screenshot(id + '-mobile');
  }
  const fallback = await context.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      return type === 'webgl2' ? null : original.call(this, type, ...options);
    };
  });
  await fallback.goto(web + '/');
  await fallback
    .getByText('Thiết bị chưa hỗ trợ 3D. Bạn vẫn có thể khám phá các chức năng bên dưới.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await fallback.getByRole('button', { name: 'Khám phá bên trong', exact: true }).isDisabled(),
    true,
  );
  await fallback.getByRole('button', { name: 'Nhận diện người', exact: true }).click();
  await fallback.getByRole('button', { name: 'Quản lý người quen', exact: true }).click();
  await fallback.getByRole('heading', { name: 'Người quen', exact: true, level: 1 }).waitFor();
  await fallback.close();
  events.push({
    id: 'qa-fire',
    eventType: 'FIRE_SMOKE_DETECTED',
    status: 'NOTIFIED',
    priority: 'P0',
    confidence: 0.98,
    isFalseAlarm: false,
    detectedAt: new Date().toISOString(),
    camera: { id: 'qa-camera', name: 'Camera bếp' },
    zone: { id: 'qa-zone', name: 'Bếp' },
  });
  await page.reload();
  await page.getByRole('alertdialog').waitFor();
  await screenshot('fire-attention-mobile');
  await layout('fire attention mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await screenshot('fire-attention-desktop');
  assert.deepEqual(
    unexpectedWrites,
    [],
    'Simulations must not create real events or notifications',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual([...unknown], []);
  await writeFile(
    out + '/result.json',
    JSON.stringify(
      {
        layouts,
        errors,
        menu: { first, middle, last },
        checks: [
          'public local font',
          'assembled camera',
          'explode/reassemble',
          'click camera mesh',
          'zoom and reset',
          'shared hover pill moves without navigation',
          'AI feature navigation',
          'reduced motion',
          'WebGL fallback',
          'all seven sections desktop/mobile',
          'persistent active page border and readable text during hover',
          'four distinct AI simulation renders',
          'no mutation requests from simulations',
          'fire attention',
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: 'passed', out, layouts: layouts.length }));
} catch (error) {
  await screenshot('failure');
  await writeFile(
    out + '/failure.txt',
    String(error) + '\n' + (await page.locator('body').innerText()) + '\n' + errors.join('\n'),
  );
  throw error;
} finally {
  await browser.close();
}
