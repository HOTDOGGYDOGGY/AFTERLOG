// 감상용 단일 HTML. 외부 요청 없이 열리며, 숨긴 인물의 본문은 파일 어디에도 들어가지 않는다.
import { renderToStaticMarkup } from "react-dom/server";
import type { DocumentData } from "../domain/types";
import { BandView } from "../renderers/band/BandView";
import { currentAppTheme, pageBackground, resolveDocTheme, type AppThemeResolved } from "../renderers/band/style";
import bandCss from "../renderers/band/band.css?raw";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

/** 문서에서 실제로 쓰이는 자산 ID (숨긴 인물 제외) */
export function usedAssetIds(doc: DocumentData): Set<string> {
  const ids = new Set<string>();
  for (const idn of Object.values(doc.identities)) if (!idn.hidden && idn.avatarAssetId) ids.add(idn.avatarAssetId);
  for (const e of Object.values(doc.entries)) {
    const author = e.authorId ? doc.identities[e.authorId] : null;
    if (author?.hidden) continue;
    for (const b of [...e.blocks, ...(e.excerpt ?? [])]) if (b.type === "image" && b.assetId) ids.add(b.assetId);
  }
  return ids;
}

/** 기록 본문만(HTML 복사용). 기록 테마가 '앱과 연결'이면 지금 화면 테마로 확정한다 */
export function renderDocumentBody(doc: DocumentData, dataUrls: Map<string, string>, appTheme: AppThemeResolved = currentAppTheme()): string {
  return renderToStaticMarkup(<BandView doc={doc} mode="export" appTheme={appTheme} assetUrl={(id) => dataUrls.get(id)} />);
}

export function renderDocumentHtml(doc: DocumentData, dataUrls: Map<string, string>, appTheme: AppThemeResolved = currentAppTheme()): string {
  const body = renderDocumentBody(doc, dataUrls, appTheme);
  // 바깥 면은 기록 설정의 색. 편집기 앱 바탕색과 섞지 않는다
  const bg = pageBackground(doc.view, resolveDocTheme(doc.view, appTheme));
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="AFTERLOG">
<title>${escapeHtml(doc.title)}</title>
<style>
html,body{margin:0;padding:0;background:${bg};}
body{padding:24px 0;}
@media (max-width:480px){body{padding:0;}}
${bandCss}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

async function dataUrlsFor(doc: DocumentData, getBlob: (id: string) => Promise<Blob | undefined>) {
  const urls = new Map<string, string>();
  for (const id of usedAssetIds(doc)) {
    const b = await getBlob(id);
    if (b) urls.set(id, await blobToDataUrl(b));
  }
  return urls;
}

export async function exportDocumentHtml(doc: DocumentData, getBlob: (id: string) => Promise<Blob | undefined>, appTheme?: AppThemeResolved): Promise<Blob> {
  return new Blob([renderDocumentHtml(doc, await dataUrlsFor(doc, getBlob), appTheme)], { type: "text/html;charset=utf-8" });
}

/** HTML 복사: 스타일을 포함한 조각(붙여넣을 곳에서 그대로 보이도록 style 태그 동봉) */
export async function documentHtmlSnippet(doc: DocumentData, getBlob: (id: string) => Promise<Blob | undefined>, appTheme?: AppThemeResolved): Promise<string> {
  return `<style>${bandCss}</style>\n${renderDocumentBody(doc, await dataUrlsFor(doc, getBlob), appTheme)}`;
}
