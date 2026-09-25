import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5179",
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    locale: "ko-KR",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npx vite --port 5179 --strictPort",
    url: "http://localhost:5179",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
