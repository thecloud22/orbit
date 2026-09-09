import { defineConfig, devices } from '@playwright/test';

const PORT = 3030;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Browser tests for the Meridian loan origination demo portal.
 *
 * testDir is ./tests so these specs stay clear of Vitest, which collects
 * src/**\/*.test.ts. The two runners never see each other's files.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
