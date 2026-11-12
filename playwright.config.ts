import { defineConfig, devices } from "@playwright/test";

const browserChannel = process.env.CI ? {} : { channel: "chrome" };

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    ...browserChannel,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], ...browserChannel },
    },
  ],
  webServer: {
    command: "node_modules/.bin/next start -H 127.0.0.1 -p 3000",
    cwd: "./apps/web",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
