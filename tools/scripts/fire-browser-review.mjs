/** Browser QA for the disposable US-18 stack; uses a separate Chrome test profile. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.argv[2])
  throw new Error('Usage: node tools/scripts/fire-browser-review.mjs <report-dir>');
const output = resolve(process.argv[2]);
// Optional QA dependency stays outside the frozen application dependency graph.
const requireQa = createRequire(join(root, 'artifacts/m3/browser-qa/package.json'));
const { chromium } = requireQa('playwright');
const timeoutMs = 240000;
async function readWhenReady(filename) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      return JSON.parse(await readFile(join(output, filename), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await setTimeout(500);
    }
  }
  throw new Error(`Browser review timed out waiting for ${filename}`);
}

const config = await readWhenReady('browser-review.json');
assert.equal(new URL(config.web).hostname, '127.0.0.1');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (response) => {
  if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
});
try {
  await page.goto(`${config.web}/login`);
  await page.getByLabel('Email', { exact: true }).fill(config.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(config.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.waitForURL(config.web + '/');
  const { eventId } = await readWhenReady('review-ready.json');
  // Select the exact incident checked by the backend gate, even if another episode occurs.
  const card = page.locator('article').filter({ has: page.locator(`img[src*="${eventId}"]`) });
  await card.waitFor();
  assert.equal(await card.count(), 1);
  const attention = page.getByRole('alertdialog');
  await attention.waitFor();
  await attention.getByRole('button', { name: /Xem chi tiết ngay/ }).click();
  await page.screenshot({ path: join(output, 'dashboard-desktop.png'), fullPage: true });
  if (!(await page.getByRole('dialog').isVisible())) await card.getByRole('button').click();
  const dialog = page.getByRole('dialog');
  const evidence = dialog.getByRole('region', { name: 'Bằng chứng lửa và khói' });
  await evidence.waitFor();
  await dialog.getByRole('img', { name: 'Vị trí lửa và khói trên ảnh bằng chứng' }).waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('[role="dialog"] img');
    return image?.complete && image.naturalWidth > 0;
  });
  await page.screenshot({ path: join(output, 'evidence-desktop.png') });
  await dialog.getByRole('button', { name: /Xem video diễn biến/ }).click();
  const video = dialog.locator('video');
  await video.waitFor();
  await video.evaluate(async (element) => {
    element.muted = true;
    await element.play();
  });
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.2);
  await video.evaluate((element) => element.pause());
  const playback = await video.evaluate((element) => ({
    duration: element.duration,
    currentTime: element.currentTime,
    width: element.videoWidth,
    height: element.videoHeight,
    error: element.error?.message ?? null,
  }));
  assert.ok(playback.duration > 0 && playback.width > 0 && !playback.error);
  await evidence.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'evidence-details-desktop.png') });
  await writeFile(join(output, 'detail-body.txt'), await dialog.innerText());
  await dialog.getByRole('button', { name: 'Ảnh khoanh vùng', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  await dialog.locator('img').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'evidence-mobile.png') });
  const layout = await dialog.evaluate((element) => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    dialogWidth: element.getBoundingClientRect().width,
  }));
  assert.ok(layout.document <= layout.viewport && layout.dialogWidth <= layout.viewport);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const close = dialog.getByRole('button', { name: '🏁 Đóng sự kiện khẩn cấp', exact: true });
  const safe = dialog.getByRole('button', { name: '✅ Tôi ổn (An toàn)', exact: true });
  const action = (await close.count()) ? close : safe;
  const actionName = await action.innerText();
  await action.click();
  await dialog.waitFor({ state: 'hidden' });
  await card.getByText(/Đã xác nhận an toàn|Đã đóng sự kiện khẩn cấp/, { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'dashboard-after-action.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const result = {
    eventId,
    browser: await browser.version(),
    playback,
    layout,
    actionName,
    errors,
  };
  await writeFile(join(output, 'browser-result.json'), JSON.stringify(result, null, 2));
  await writeFile(join(output, 'review-complete.json'), JSON.stringify({ eventId }));
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(output, 'browser-failure.png'), fullPage: true });
  await writeFile(
    join(output, 'browser-failure.txt'),
    String(error) + '\n' + (await page.locator('body').innerText()) + '\n' + errors.join('\n'),
  );
  throw error;
} finally {
  await browser.close();
}
