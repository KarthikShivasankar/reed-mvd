import { defineConfig, devices } from "@playwright/test";

/**
 * UI end-to-end tests against a running REED stack (docker compose up + ./seed-identity.sh + ./seed-reed.sh).
 *   npx playwright test            (REED_UI overrides the dashboard URL)
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.REED_UI ?? "http://localhost:8088",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
