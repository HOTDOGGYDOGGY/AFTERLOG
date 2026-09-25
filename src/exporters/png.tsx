// 분할 PNG 내보내기. 명세 12.3.
// 출력 전용 렌더링을 화면 밖에 한 번 그린 뒤, 항목 경계(없으면 줄 경계)에서 페이지를 나눠
// 페이지마다 작은 캔버스를 따로 만든다. 거대한 캔버스 하나를 만든 뒤 자르지 않는다.
import { toCanvas } from "html-to-image";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { DocumentData } from "../domain/types";
import { BandView } from "../renderers/band/BandView";
import { currentAppTheme, effectiveWidth, type AppThemeResolved } from "../renderers/band/style";
import { safeName } from "./fileName";
import { usedAssetIds } from "./html";

export interface PngOptions {
  pixelRatio: 1 | 2;
  /** png(기본) 또는 jpeg */
  format?: "png" | "jpeg";
  appTheme?: AppThemeResolved;
  /** 한 장의 최대 높이(CSS px) */
  maxPageHeight: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface PngPage {
  fileName: string;
  blob: Blob;
  height: number;
}

/**
 * 잘라도 되는 y 위치 목록에서 페이지 경계를 고른다(순수 함수, 테스트 대상).
 * - entryCuts: 항목 경계(우선)
 * - lineCuts: 텍스트 줄/이미지 경계(항목 하나가 너무 길 때)
 * 둘 다 없으면 maxH에서 강제로 자르고 forced로 표시한다.
 */
export function planPages(total: number, maxH: number, entryCuts: number[], lineCuts: number[]): { start: number; end: number; forced: boolean }[] {
  const e = [...new Set(entryCuts.filter((y) => y > 0 && y < total))].sort((a, b) => a - b);
  const l = [...new Set(lineCuts.filter((y) => y > 0 && y < total))].sort((a, b) => a - b);
  const pages: { start: number; end: number; forced: boolean }[] = [];
  let s = 0;
  while (total - s > maxH) {
    const limit = s + maxH;
    const bestEntry = lastBetween(e, s, limit);
    const bestLine = lastBetween(l, s, limit);
    let end: number;
    let forced = false;
    if (bestEntry !== null && bestEntry - s >= maxH * 0.35) end = bestEntry;
    else if (bestLine !== null && bestLine - s >= maxH * 0.35) end = bestLine;
    else if (bestEntry !== null) end = bestEntry;
    else if (bestLine !== null) end = bestLine;
    else {
      end = limit;
      forced = true;
    }
    pages.push({ start: s, end, forced });
    s = end;
  }
  pages.push({ start: s, end: total, forced: false });
  return pages;
}

function lastBetween(sorted: number[], lo: number, hi: number): number | null {
  let best: number | null = null;
  for (const y of sorted) {
    if (y <= lo) continue;
    if (y > hi) break;
    best = y;
  }
  return best;
}

function collectCuts(root: HTMLElement): { entryCuts: number[]; lineCuts: number[] } {
  const top = root.getBoundingClientRect().top;
  const entryCuts: number[] = [];
  root.querySelectorAll<HTMLElement>(".al-thread, .al-post, .al-mc-card, .al-comments, .al-counts").forEach((el) => {
    entryCuts.push(Math.round(el.getBoundingClientRect().top - top));
  });
  const lineCuts: number[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let prevBottom = -1;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    range.selectNodeContents(n);
    for (const r of Array.from(range.getClientRects())) {
      const b = Math.ceil(r.bottom - top);
      if (b !== prevBottom) lineCuts.push(b);
      prevBottom = b;
    }
  }
  root.querySelectorAll("img, .al-image-missing").forEach((el) => {
    const r = el.getBoundingClientRect();
    lineCuts.push(Math.round(r.top - top), Math.ceil(r.bottom - top));
  });
  return { entryCuts, lineCuts };
}

export async function exportDocumentPng(doc: DocumentData, getBlob: (id: string) => Promise<Blob | undefined>, opts: PngOptions): Promise<{ pages: PngPage[]; forcedCuts: number }> {
  const urls = new Map<string, string>();
  for (const id of usedAssetIds(doc)) {
    const b = await getBlob(id);
    if (b) urls.set(id, URL.createObjectURL(b));
  }
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", width: `${effectiveWidth(doc.view)}px`, pointerEvents: "none" });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<BandView doc={doc} mode="export" appTheme={opts.appTheme ?? currentAppTheme()} assetUrl={(id) => urls.get(id)} />));
    await document.fonts?.ready;
    await Promise.all(
      Array.from(host.querySelectorAll("img")).map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))),
    );
    const node = host.firstElementChild as HTMLElement;
    // 배경은 기록 스킨의 글 표면색(편집기 화면 색이 아님)
    const bg = getComputedStyle(node).backgroundColor || "#ffffff";
    const fmt = opts.format ?? "png";
    const ext = fmt === "jpeg" ? "jpg" : "png";
    const total = Math.ceil(node.getBoundingClientRect().height);
    const { entryCuts, lineCuts } = collectCuts(node);
    const plan = planPages(total, opts.maxPageHeight, entryCuts, lineCuts);
    const pages: PngPage[] = [];
    const base = safeName(doc.title);
    for (let i = 0; i < plan.length; i++) {
      if (opts.signal?.aborted) throw new DOMException("취소했습니다.", "AbortError");
      const p = plan[i];
      const h = p.end - p.start;
      const canvas = await toCanvas(node, {
        width: effectiveWidth(doc.view),
        height: h,
        pixelRatio: opts.pixelRatio,
        backgroundColor: bg,
        skipFonts: true,
        style: { margin: "0", transform: `translateY(-${p.start}px)`, transformOrigin: "top left" },
      });
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("이미지 생성 실패(캔버스 크기 제한일 수 있음)"))), `image/${fmt}`, 0.92));
      canvas.width = canvas.height = 0;
      const num = plan.length > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";
      pages.push({ fileName: `${base}${num}.${ext}`, blob, height: h });
      opts.onProgress?.(i + 1, plan.length);
    }
    return { pages, forcedCuts: plan.filter((p) => p.forced).length };
  } finally {
    root.unmount();
    host.remove();
    for (const u of urls.values()) URL.revokeObjectURL(u);
  }
}
