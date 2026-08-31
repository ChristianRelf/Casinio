import { defineConfig, devices } from "@playwright/test";

const port = 3010;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run db:migrate:local && npm run dev -- --port ${port}`,
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_ORIGIN: baseURL,
      NEXT_PUBLIC_APP_ORIGIN: baseURL,
      CASINO_API_ORIGIN: baseURL,
      STARTING_BALANCE: "10000",
      DAILY_REFILL_AMOUNT: "500",
      DEV_AUTH_BYPASS: "false",
    },
  },
});
