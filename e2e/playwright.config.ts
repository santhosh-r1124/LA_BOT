import { defineConfig, devices } from '@playwright/test';
import { API, PORTAL, WEB } from './urls';

/**
 * Browser E2E across all three apps (Phase 14). Playwright starts the API and
 * both Next.js apps itself; it needs a migrated Postgres (+pgvector) and Redis,
 * reachable via DATABASE_URL / REDIS_URL (CI provides them as services — see
 * .github/workflows/ci.yml, job `e2e`). Locally:
 *
 *   pnpm stack:up && pnpm db:migrate
 *   pnpm --filter @legal-platform/e2e exec playwright install chromium
 *   pnpm e2e
 *
 * Servers already running on the same ports are reused outside CI.
 */

const nextEnv = { NEXT_PUBLIC_API_BASE_URL: API, NEXT_TELEMETRY_DISABLED: '1' };

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  // The journey is one shared story across three accounts; run it in order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    navigationTimeout: 90_000, // first hit on a `next dev` route compiles it
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: '../apps/api',
      url: `${API}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        CORS_ORIGINS: `${WEB},${PORTAL}`,
        // Many sign-ups from one IP in a few seconds is the test, not an attack.
        AUTH_RATE_LIMIT_PER_MINUTE: '0',
        AI_RATE_LIMIT_PER_MINUTE: '0',
        // Assert the honest "not configured" checkout path, never a live gateway.
        RAZORPAY_KEY_ID: '',
        RAZORPAY_KEY_SECRET: '',
        EMAIL_BACKEND: 'console',
      },
    },
    {
      command: 'pnpm --filter @legal-platform/web dev',
      cwd: '..',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: nextEnv,
    },
    {
      command: 'pnpm --filter @legal-platform/advocate-portal dev',
      cwd: '..',
      url: PORTAL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: nextEnv,
    },
  ],
});
