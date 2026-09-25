// 사용자가 넣은 파일(저장 페이지 HTML / ZIP / HTML 조각 TXT / 텍스트 복사 / 이미지) 또는 붙여넣은 글을
// 분석해 가져오기 검토용 결과를 만든다. 구조(HTML)를 우선하고 텍스트 파서는 대체 경로다.
import { unzip } from "fflate";
import { newId, nowIso } from "../domain/ids";
import type { DocumentData, SourceImport, SourceKind } from "../domain/types";
import { sha256Hex } from "../storage/hash";
import { addAsset, addImport, guessMime, listSources } from "../storage/repo";
import { buildDocument } from "./band/build";
import { BAND_HTML_PARSER_VERSION, parseBandHtml, type BandPageParseResult } from "./band/html";
import { BAND_TEXT_PARSER_VERSION, looksLikeBandText, parseBandText, type LineInfo } from "./band/text";

export const ZIP_LIMITS = { maxEntries: 5000, maxTotalBytes: 300 * 1024 * 1024 };

export interface PendingImport {
  fileName: string;
  sourceKind: SourceKind;
  sourceBytes: Uint8Array;
  sourceMime: string;
  sha256: string;
  parserVersion: string;
  parse: BandPageParseResult;
  /** 텍스트 입력일 때 줄별 분류 */
  lines: LineInfo[] | null;
  /** 파일명(basename) → 이미지 데이터 */
  images: Map<string, Blob>;
  /** 페이지가 참조하지만 파일이 없는 이미지 */
  missingImages: string[];
  /** 파일은 없지만 원격 링크는 있는 이미지 */
  linkOnlyImages: string[];
  duplicateOf: SourceImport | null;
  sourceUrl: string | null;
  warnings: string[];
}

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const isHtmlName = (n: string) => /\.(html?|xhtml)$/i.test(n);
const isTextName = (n: string) => /\.txt$/i.test(n);
const isImageName = (n: string) => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(n);

export function decodeHtml(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
  const m = head.match(/<meta[^>]+charset=["']?\s*([\w-]+)/i);
  const charset = (m?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset === "utf8" ? "utf-8" : charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** UTF-8로 읽고, 깨지면 EUC-KR(CP949)로 다시 시도 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    try {
      return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
    } catch {
      return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8(깨진 글자 있음)" };
    }
  }
}

/** 붙여넣은 글/TXT가 HTML 조각인지 */
export function looksLikeHtmlFragment(t: string): boolean {
  return /<(div|article|p|span)\b[^>]*class=/i.test(t) && /(cPostCard|cComment|DBandMember|postWriter|txtBody)/.test(t);
}

const URL_ONLY = /^\s*https?:\/\/\S+\s*$/;

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  let entries = 0;
  let total = 0;
  let overflow = "";
  return new Promise((resolve, reject) => {
    unzip(
      data,
      {
        filter(file) {
          entries++;
          total += file.originalSize;
          if (entries > ZIP_LIMITS.maxEntries) overflow = `압축 안 파일이 너무 많습니다(${ZIP_LIMITS.maxEntries}개 초과).`;
          if (total > ZIP_LIMITS.maxTotalBytes) overflow = `압축을 풀면 ${Math.round(ZIP_LIMITS.maxTotalBytes / 1048576)}MB를 넘습니다. 나눠서 가져와 주세요.`;
          const n = file.name;
          if (overflow || n.includes("..") || n.startsWith("/")) return false;
          return isHtmlName(n) || isImageName(n) || isTextName(n);
        },
      },
      (err, out) => {
        if (overflow) reject(new Error(overflow));
        else if (err) reject(new Error(`ZIP 파일을 열 수 없습니다: ${err.message}`));
        else resolve(out);
      },
    );
  });
}

interface Candidate {
  name: string;
  bytes: Uint8Array;
  kind: SourceKind;
  text: string;
}

/**
 * 파일·붙여넣은 글을 받아 가장 정확한 입력 하나를 고른다.
 * 저장 페이지 HTML > HTML 조각 > 텍스트 복사. 이미지 파일은 모두 모아 둔다.
 */
export async function analyzeFiles(files: File[], projectId: string | null, pasted?: string): Promise<PendingImport> {
  const cands: Candidate[] = [];
  const images = new Map<string, Blob>();
  const warnings: string[] = [];
  let sourceUrl: string | null = null;

  const addText = (name: string, bytes: Uint8Array) => {
    const { text, encoding } = decodeText(bytes);
    if (URL_ONLY.test(text)) {
      sourceUrl = text.trim();
      return;
    }
    if (encoding !== "utf-8") warnings.push(`${name}: ${encoding}로 읽었습니다. 글자가 깨졌다면 UTF-8로 저장해 다시 넣어 주세요.`);
    if (looksLikeHtmlFragment(text)) cands.push({ name, bytes, kind: "band-html-fragment", text });
    else cands.push({ name, bytes, kind: "band-plain-text", text });
  };
  const addFile = (name: string, bytes: Uint8Array) => {
    if (isHtmlName(name)) cands.push({ name, bytes, kind: "band-saved-page", text: decodeHtml(bytes) });
    else if (isTextName(name)) addText(name, bytes);
    else if (isImageName(name)) images.set(name, new Blob([bytes as BlobPart], { type: guessMime(name) }));
  };

  for (const f of files) {
    const name = f.name;
    if (/\.zip$/i.test(name)) {
      const out = await unzipAsync(new Uint8Array(await f.arrayBuffer()));
      for (const [path, bytes] of Object.entries(out)) addFile(basename(path), bytes);
    } else if (isHtmlName(name) || isTextName(name)) {
      addFile(name, new Uint8Array(await f.arrayBuffer()));
    } else if (isImageName(name) || f.type.startsWith("image/")) {
      images.set(name, f);
    } else {
      warnings.push(`지원하지 않는 파일은 건너뛰었습니다: ${name}`);
    }
  }
  if (pasted && pasted.trim()) {
    const bytes = new TextEncoder().encode(pasted);
    if (URL_ONLY.test(pasted)) sourceUrl = pasted.trim();
    else addText("붙여넣은 글.txt", bytes);
  }

  const rank: Record<SourceKind, number> = { "band-collector-capture": 0, "band-saved-page": 0, "band-html-fragment": 1, "band-plain-text": 2 };
  cands.sort((a, b) => rank[a.kind] - rank[b.kind]);
  if (!cands.length)
    throw new Error(
      "가져올 내용이 없습니다. 밴드 게시글을 연 상태에서 '다른 이름으로 저장'한 .html(또는 폴더째 묶은 .zip), 게시글 영역의 HTML을 복사한 .txt, 또는 화면에서 복사한 글을 넣어 주세요.",
    );
  const main = cands[0];
  const others = cands.slice(1);
  if (others.length) {
    const label = { "band-collector-capture": "수집기", "band-saved-page": "저장 페이지", "band-html-fragment": "HTML 조각", "band-plain-text": "텍스트 복사" } as const;
    warnings.push(
      `입력이 ${cands.length}개 있어 가장 정확한 ${label[main.kind]}(${main.name})를 사용했습니다. 나머지(${others.map((o) => `${label[o.kind]} ${o.name}`).join(", ")})는 가져오지 않았습니다.`,
    );
  }

  let parse: BandPageParseResult;
  let lines: LineInfo[] | null = null;
  let parserVersion: string;
  if (main.kind === "band-plain-text") {
    parserVersion = BAND_TEXT_PARSER_VERSION;
    const r = parseBandText(main.text);
    lines = r.lines;
    parse = { pageTitle: "", bandName: null, documents: r.document ? [r.document] : [], notes: r.notes, imageRefs: [] };
    if (!r.document && !looksLikeBandText(main.text)) parse.notes.push("밴드 화면에서 복사한 글처럼 보이지 않습니다.");
  } else {
    parserVersion = BAND_HTML_PARSER_VERSION;
    parse = parseBandHtml(main.text);
  }

  const linkOnly = new Set<string>();
  for (const d of parse.documents) {
    for (const i of d.identities) if (i.avatarRef && i.avatarUrl) linkOnly.add(i.avatarRef);
    for (const e of d.entries) for (const b of e.blocks) if (b.type === "image" && b.sourceRef && b.sourceUrl) linkOnly.add(b.sourceRef);
  }
  const missingImages = parse.imageRefs.filter((r) => !images.has(r));
  const sha256 = await sha256Hex(main.bytes);
  let duplicateOf: SourceImport | null = null;
  if (projectId) duplicateOf = (await listSources(projectId)).find((s) => s.sha256 === sha256) ?? null;

  return {
    fileName: main.name,
    sourceKind: main.kind,
    sourceBytes: main.bytes,
    sourceMime: main.kind === "band-plain-text" ? "text/plain" : "text/html",
    sha256,
    parserVersion,
    parse,
    lines,
    images,
    missingImages,
    linkOnlyImages: missingImages.filter((r) => linkOnly.has(r)),
    duplicateOf,
    sourceUrl,
    warnings,
  };
}

/** 검토를 마친 가져오기를 프로젝트에 기록. 선택한 문서만 만든다. */
export async function commitImport(projectId: string, pending: PendingImport, docIndexes: number[]): Promise<DocumentData[]> {
  const assetMap = new Map<string, string>();
  for (const ref of pending.parse.imageRefs) {
    const blob = pending.images.get(ref);
    if (!blob) continue;
    try {
      const a = await addAsset(projectId, blob, ref);
      assetMap.set(ref, a.id);
    } catch {
      /* 이미지가 아닌 파일은 연결하지 않고 미확보로 남긴다 */
    }
  }
  const source: SourceImport = {
    id: newId(),
    projectId,
    fileName: pending.fileName,
    mime: pending.sourceMime,
    importedAt: nowIso(),
    parserVersion: pending.parserVersion,
    sha256: pending.sha256,
    blob: new Blob([pending.sourceBytes as BlobPart], { type: pending.sourceMime }),
    kind: pending.sourceKind,
    sourceUrl: pending.sourceUrl ?? undefined,
  };
  const docs = docIndexes
    .map((i) => pending.parse.documents[i])
    .filter(Boolean)
    .map((pd) => buildDocument(pd, { projectId, sourceId: source.id, parserVersion: pending.parserVersion, assetMap, sourceKind: pending.sourceKind }));
  await addImport(projectId, source, docs);
  return docs.map((d) => ({ ...d, revision: 1 }));
}
