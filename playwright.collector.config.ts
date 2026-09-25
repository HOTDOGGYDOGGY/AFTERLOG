import { defineConfig } from "@playwright/test";

// 수집 확장 검사: 테스트 빌드(dist-collector-test)를 실제 Chromium에 설치해 가짜 밴드 서버에서 돌린다.
export default defineConfig({
  testDir: "tests/e2e-collector",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  webServer: [
    { command: "node tests/e2e-collector/mock-band.mjs", url: "http://localhost:4588/stats", reuseExistingServer: true, timeout: 30_000 },
    { command: "npx vite --port 5179 --strictPort", url: "http://localhost:5179", reuseExistingServer: true, timeout: 60_000 },
  ],
});
