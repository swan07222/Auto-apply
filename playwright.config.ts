import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    locale: "en-US",
    timezoneId: "America/Phoenix",
    viewport: { width: 1440, height: 2200 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    launchOptions: {
      args: ["--disable-blink-features=AutomationControlled"],
    },
  },
});
