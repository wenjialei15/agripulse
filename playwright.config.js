const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:8765',
    viewport: { width: 1440, height: 1100 },
    locale: 'zh-CN',
    // Local testing can use an existing browser: PLAYWRIGHT_CHANNEL=msedge.
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python -m agripulse --port 8765 --db data/browser-tests.db',
    url: 'http://127.0.0.1:8765/api/health',
    reuseExistingServer: false,
    env: { AGRIPULSE_API_KEY: '' },
  },
});
