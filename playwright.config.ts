import { defineConfig, devices } from '@playwright/test';

const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'touch', use: { ...devices['Pixel 7'], viewport: { width: 740, height: 360 } } },
  ...(process.env.PLAYWRIGHT_WEBKIT === '1'
    ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }]
    : [])
];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry'
  },
  projects,
  webServer: {
    command: 'DATABASE_PATH=:memory: npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
