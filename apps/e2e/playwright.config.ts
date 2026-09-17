import { defineConfig, devices } from '@playwright/test'
import { API_PORT, API_URL, DATABASE_URL, WEB_PORT, WEB_URL } from './config.ts'

const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',

  fullyParallel: true,
  // A test left focused should fail the CI run rather than silently skip the rest.
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // One worker on CI: the whole suite shares helpdesk_e2e, so parallel workers
  // would write over each other. Locally the default is fine for a quick run.
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['html', { open: 'never' }]],

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],

  webServer: [
    {
      name: 'api',
      command: 'bun src/index.ts',
      cwd: '../api',
      url: `${API_URL}/api/health`,
      // Never reuse: a listener already on this port is not necessarily an API
      // pointed at helpdesk_e2e, and inheriting one would put the tests on the
      // development database.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // An explicit variable beats the .env.test that Bun auto-loads under
        // NODE_ENV=test, so DATABASE_URL below wins over the unit-test one.
        // Verified rather than assumed.
        NODE_ENV: 'test',
        DATABASE_URL,
        PORT: String(API_PORT),
        WEB_ORIGIN: WEB_URL,
      },
    },
    {
      name: 'web',
      command: `bunx vite --port ${String(WEB_PORT)} --strictPort`,
      cwd: '../web',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // Points the dev server's /api proxy at the API above rather than the
        // one a developer has running on 3000.
        API_PROXY_TARGET: API_URL,
      },
    },
  ],
})
