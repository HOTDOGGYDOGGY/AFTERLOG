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

/**
 * 로컬 실행판(npm run build:local → dist-local/index.html 더블클릭).
 * 브라우저는 파일로 연 페이지(file://)에서 분리된 모듈 스크립트 파일을 막으므로, 앱 코드와 스타일을 index.html 안에 넣는다.
 */
function inlineForFile(): Plugin {
  return {
    name: "afterlog-inline-for-file",
    apply: "build",
    enforce: "post",
    generateBundle(_opts, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset") return;
      let text = String(html.source);
      for (const [name, out] of Object.entries(bundle)) {
        if (out.type === "chunk" && out.isEntry) {
          const code = out.code.replace(/<\/(script)/gi, "<\\/$1");
          text = text.replace(new RegExp(`<script type="module" crossorigin src="\\./${name}"></script>`), () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (out.type === "asset" && name.endsWith(".css")) {
          text = text.replace(new RegExp(`<link rel="stylesheet" crossorigin href="\\./${name}">`), () => `<style>${String(out.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = text;
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), legacyVendor(), ...(mode === "offline" ? [inlineForFile()] : [])],
  build:
    mode === "offline"
      ? { outDir: "dist-local", modulePreload: false, rolldownOptions: { output: { codeSplitting: false } } }
      : undefined,
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "jsdom",
  },
}));
