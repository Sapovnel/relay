import { defineConfig, devices } from '@playwright/test';

// The suite talks to a dev stack brought up manually (npm run infra:up +
// npm run dev:server + dev:executor + dev:web). We don't spawn a webServer
// from Playwright because our stack is three services with their own
// watchers and Docker dependencies.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
