const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test.beforeEach(async ({ request }) => {
  for (const source of ['simulator', 'device']) {
    const response = await request.post('/api/threshold', {
      data: { zone_id: 'greenhouse-a', moisture_min: 35, source },
    });
    expect(response.ok()).toBeTruthy();
  }
});

async function screenshot(page, filename) {
  if (!process.env.UPDATE_SCREENSHOTS) return;
  const folder = path.resolve(__dirname, '../../docs/images');
  await fs.mkdir(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, filename), fullPage: true });
}

test('desktop dashboard renders live demo and exports CSV', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#online')).toHaveText('3 / 3');
  await expect(page.locator('#device-rows tr')).toHaveCount(3);
  await expect(page.locator('#chart polyline')).toHaveCount(1);
  await expect(page.locator('#threshold-scope')).toContainText('仅修改模拟演示');
  await expect(page.locator('#error')).toBeHidden();
  await screenshot(page, 'dashboard-desktop.png');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('agripulse-greenhouse-a-simulator.csv');
  expect(errors).toEqual([]);
});

test('editing a demo threshold does not alter real device settings', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#threshold')).toBeEnabled();
  await page.locator('#threshold').fill('47');
  await page.locator('#save-threshold').click();
  await expect(page.locator('#threshold-label')).toHaveText('47%');
  await page.getByRole('button', { name: '真实设备', exact: true }).click();
  await expect(page.locator('#threshold')).toHaveValue('35');
  await expect(page.locator('#threshold-scope')).toContainText('仅修改真实设备');
  await page.locator('#threshold').fill('29');
  await page.locator('#save-threshold').click();
  await expect(page.locator('#threshold-label')).toHaveText('29%');
  await page.getByRole('button', { name: '模拟演示', exact: true }).click();
  await expect(page.locator('#threshold')).toHaveValue('47');
});

test('changing source disables editing until its settings have loaded', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/summary?source=device', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#threshold')).toBeEnabled();
  await page.locator('#threshold').fill('77');
  await page.getByRole('button', { name: '真实设备', exact: true }).click();
  try {
    await expect(page.locator('#threshold')).toBeDisabled();
    await expect(page.locator('#save-threshold')).toBeDisabled();
  } finally { release(); }
  await expect(page.locator('#threshold')).toBeEnabled();
  await expect(page.locator('#threshold')).toHaveValue('35');
});

test('offline registered devices with expired history render missing measurements', async ({ page, request }) => {
  const summary = await (await request.get('/api/summary?source=device')).json();
  const old = '2026-01-01T00:00:00+00:00';
  summary.devices = [{
    device_id: 'offline-sensor', zone_id: 'greenhouse-a', source: 'device',
    first_seen: old, last_seen: old, recorded_at: null, id: null,
    temperature: null, humidity: null, soil_moisture: null, light: null, battery: null,
    has_reading: false, online: false, age_seconds: 2678400,
    advice: { level: 'offline', title: '设备离线', reason: '超过 60 秒没有新数据。' },
  }];
  await page.route('**/api/summary?source=device', (route) => route.fulfill({ json: summary }));
  await page.goto('/');
  await page.getByRole('button', { name: '真实设备', exact: true }).click();
  const row = page.locator('#device-rows tr');
  await expect(row).toContainText('offline-sensor');
  await expect(row).toContainText('历史读数已清理');
  await expect(row.locator('td').filter({ hasText: /^—$/ })).toHaveCount(5);
  await expect(page.locator('#online')).toHaveText('0 / 1');
  await expect(page.locator('#error')).toBeHidden();
});

test('mobile dashboard fits the viewport and keeps controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#online')).toHaveText('3 / 3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await expect(page.locator('#save-threshold')).toBeEnabled();
  await screenshot(page, 'dashboard-mobile.png');
});

test('a stalled response times out and the next refresh recovers', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/summary?source=simulator', () => {});
  await page.goto('/');
  await page.clock.fastForward(10001);
  await expect(page.locator('#error')).toContainText('请求超时');
  await expect(page.locator('#save-threshold')).toBeDisabled();
  await page.unroute('**/api/summary?source=simulator');
  await page.clock.fastForward(5000);
  await expect(page.locator('#online')).toHaveText('3 / 3');
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#save-threshold')).toBeEnabled();
});

test('a pending save retains its original source when the user switches modes', async ({ page, request }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/threshold', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#threshold')).toBeEnabled();
  await page.locator('#threshold').fill('66');
  await page.locator('#save-threshold').click();
  const deviceSummary = page.waitForResponse('**/api/summary?source=device');
  await page.getByRole('button', { name: '真实设备', exact: true }).click();
  await deviceSummary;
  try {
    await expect(page.locator('#threshold')).toHaveValue('35');
    await expect(page.locator('#save-threshold')).toBeDisabled();
  } finally { release(); }
  await expect(page.locator('#save-threshold')).toBeEnabled();
  await expect(page.locator('#threshold')).toHaveValue('35');
  const demo = await (await request.get('/api/summary?source=simulator')).json();
  expect(demo.zones.find((zone) => zone.id === 'greenhouse-a').moisture_min).toBe(66);
});
