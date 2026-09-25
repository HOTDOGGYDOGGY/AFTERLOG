import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * 기존 도구(public/legacy)가 쓰는 html2canvas를 CDN 대신 로컬 파일로 제공한다(명세 v1.2 15.4: CDN 부재로 저장 실패 방지).
 * 개발 서버에서는 경로로 응답하고, 빌드에서는 같은 경로의 파일로 내보낸다.
 */
function legacyVendor(): Plugin {
  const path = "legacy/vendor/html2canvas.min.js";
  const src = () => readFileSync(require.resolve("html2canvas/dist/html2canvas.min.js"));
  return {
    name: "afterlog-legacy-vendor",
    configureServer(server) {
      server.middlewares.use(`/${path}`, (_req, res) => {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.end(src());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: path, source: src() });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), legacyVendor()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "jsdom",
  },
});
