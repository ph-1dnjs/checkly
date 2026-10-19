import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  // Node test suites run through their own package scripts, not Playwright.
  testIgnore: ['**/api-testing/**', '**/auth/**', '**/supabase/**', '**/mobile-inspector/**', '**/live-session/**', '**/run-report.test.ts'],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
})
