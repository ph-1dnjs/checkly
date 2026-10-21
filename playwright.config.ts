import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // tests/auth·tests/supabase 등은 node:test 파일이라 각 package script로 실행한다.
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
