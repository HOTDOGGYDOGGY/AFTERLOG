// 감상용 단일 HTML. 외부 요청 없이 열리며, 숨긴 인물의 본문은 파일 어디에도 들어가지 않는다.
import { renderToStaticMarkup } from "react-dom/server";
import type { DocumentData } from "../domain/types";
import { BandView } from "../renderers/band/BandView";
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

export function renderDocumentHtml(doc: DocumentData, dataUrls: Map<string, string>): string {
  const body = renderToStaticMarkup(<BandView doc={doc} mode="export" assetUrl={(id) => dataUrls.get(id)} />);
  const bg = doc.view.theme === "dark" ? "#1b1c1e" : "#f0f0f0";
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

export async function exportDocumentHtml(doc: DocumentData, getBlob: (id: string) => Promise<Blob | undefined>): Promise<Blob> {
  const urls = new Map<string, string>();
  for (const id of usedAssetIds(doc)) {
    const b = await getBlob(id);
    if (b) urls.set(id, await blobToDataUrl(b));
  }
  return new Blob([renderDocumentHtml(doc, urls)], { type: "text/html;charset=utf-8" });
}
