import path from 'path'
import { defineConfig, devices } from '@playwright/test'

// Run through the launcher only: `node e2e/run.mjs test`. It supplies the fake
// environment; lib/db.ts refuses to load without it.
const reports = path.join(__dirname, '.reports')
const core = /@core/
// WebKit keeps the app's Secure session cookie only over https, as on the real site: the WebKit-engine
// projects go through the https front (run.mjs), whose throwaway certificate only these browsers accept
const httpsFront = { baseURL: 'https://localhost:3443', ignoreHTTPSErrors: true }

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  outputDir: path.join(reports, 'artifacts'),
  globalSetup: path.join(__dirname, 'lib/global-setup.ts'),
  globalTeardown: path.join(__dirname, 'lib/global-teardown.ts'),
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: path.join(reports, 'html'), open: 'never' }], ['json', { outputFile: path.join(reports, 'results.json') }]],
  use: {
    baseURL: 'http://localhost:3200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'en-GH',
    timezoneId: 'Africa/Accra',
  },
  projects: [
    // Everything, in Chromium. Tests that stop the database or a server are kept apart and run alone.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /chaos\// },
    { name: 'chaos', use: { ...devices['Desktop Chrome'] }, testMatch: /chaos\//, fullyParallel: false, workers: 1 },
    // The core journeys again in the other engines and on small screens with touch
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: core, testIgnore: /chaos\// },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...httpsFront }, grep: core, testIgnore: /chaos\// },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'], ...httpsFront }, grep: core, testIgnore: /chaos\// },
    { name: 'iphone', use: { ...devices['iPhone SE'], ...httpsFront }, grep: core, testIgnore: /chaos\// },
    { name: 'android', use: { ...devices['Galaxy S9+'] }, grep: core, testIgnore: /chaos\// },
  ],
})
