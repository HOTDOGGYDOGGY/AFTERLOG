// 수집 확장 빌드. COLLECTOR_TEST=1 이면 가짜 밴드 서버(localhost:4588)를 허용하는 테스트 빌드.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
const test = process.env.COLLECTOR_TEST === "1";
const TEST_ORIGIN = "http://localhost:4588";
const origins = ["https://band.us", "https://www.band.us", ...(test ? [TEST_ORIGIN] : [])];
const version = pkg.collectorVersion as string;

function manifest(): Plugin {
  return {
    name: "afterlog-collector-manifest",
    generateBundle() {
      const m = {
        manifest_version: 3,
        name: test ? "AFTERLOG Collector (TEST)" : "AFTERLOG Collector · 밴드 기록 저장",
        short_name: "AFTERLOG",
        version,
        description: "로그인한 밴드에서 글·댓글을 모아 AFTERLOG(.afterlog) 파일로 저장합니다. 자료는 이 컴퓨터에만 저장됩니다.",
        minimum_chrome_version: "116",
        action: { default_popup: "popup.html", default_title: "AFTERLOG · 밴드 기록 저장", default_icon: { 16: "icon16.png", 32: "icon32.png" } },
        icons: { 16: "icon16.png", 32: "icon32.png", 48: "icon48.png", 128: "icon128.png" },
        background: { service_worker: "background.js" },
        // scripting: 밴드 화면에서 게시글 영역을 읽기 위해. unlimitedStorage: 수집한 글·이미지를 브라우저에 보관하기 위해.
        permissions: ["scripting", "unlimitedStorage"],
        // 밴드 화면과 밴드 이미지 서버만. 모든 사이트 접근은 요청하지 않는다.
        host_permissions: [
          "https://band.us/*",
          "https://www.band.us/*",
          "https://*.pstatic.net/*",
          ...(test ? [`${TEST_ORIGIN}/*`, "http://127.0.0.1:4589/*"] : []),
        ],
        content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
      };
      this.emitFile({ type: "asset", fileName: "manifest.json", source: JSON.stringify(m, null, 2) });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, "collector"),
  base: "./",
  publicDir: resolve(__dirname, "collector/public"),
  plugins: [react(), manifest()],
  define: {
    __AL_BAND_ORIGINS__: JSON.stringify(origins),
    __AL_MIN_DELAY_MS__: String(test ? 60 : 1500),
    __AL_COLLECTOR_VERSION__: JSON.stringify(version),
    __AL_PAGE_TIMEOUT_MS__: String(test ? 4000 : 25_000),
  },
  build: {
    outDir: resolve(__dirname, test ? "dist-collector-test" : "dist-collector"),
    emptyOutDir: true,
    target: "chrome116",
    modulePreload: false,
    rollupOptions: {
      input: { popup: resolve(__dirname, "collector/popup.html"), manager: resolve(__dirname, "collector/manager.html") },
    },
  },
});
