import { newId, nowIso } from "../../domain/ids";
import {
  ROOT,
  defaultViewSettings,
  type ContentBlock,
  type DocumentData,
  type Entry,
  type Identity,
  type ReviewIssue,
  type SourceKind,
} from "../../domain/types";
import type { ParsedDocument } from "./html";

const COLOR_POOL = ["#d9480f", "#c2255c", "#9c36b5", "#5f3dc4", "#1971c2", "#0c8599", "#2b8a3e", "#5c940d", "#e67700", "#862e9c"];

export function colorForName(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return COLOR_POOL[h % COLOR_POOL.length];
}

/** 파싱 결과 → 편집 가능한 문서. 이미지 참조(파일명)는 assetMap으로 자산 ID에 연결한다. */
export function buildDocument(
  parsed: ParsedDocument,
  ctx: { projectId: string; sourceId: string; parserVersion: string; assetMap: Map<string, string>; sourceKind?: SourceKind },
): DocumentData {
  const now = nowIso();
  const identities: Record<string, Identity> = {};
  const identityOrder: string[] = [];
  const keyToId = new Map<string, string>();
  for (const p of parsed.identities) {
    const id = newId();
    keyToId.set(p.key, id);
    identities[id] = {
      id,
      originalName: p.name,
      displayName: p.name,
      description: p.description,
      originalDescription: p.description,
      avatarAssetId: p.avatarRef ? ctx.assetMap.get(p.avatarRef) ?? null : null,
      avatarSourceRef: p.avatarRef,
      avatarSourceUrl: p.avatarUrl,
      color: null,
      hidden: false,
    };
    identityOrder.push(id);
  }

  const linkBlocks = (blocks: ContentBlock[]): ContentBlock[] =>
    blocks.map((b) => (b.type === "image" && b.sourceRef ? { ...b, assetId: ctx.assetMap.get(b.sourceRef) ?? null } : { ...b }));

  const entries: Record<string, Entry> = {};
  const children: Record<string, string[]> = { [ROOT]: [] };
  const tempToId = new Map<string, string>();
  parsed.entries.forEach((pe, i) => {
    const id = newId();
    tempToId.set(pe.tempId, id);
    const blocks = linkBlocks(pe.blocks);
    entries[id] = {
      id,
      kind: pe.kind,
      authorId: pe.authorKey ? keyToId.get(pe.authorKey) ?? null : null,
      blocks,
      originalBlocks: structuredClone(blocks),
      excerpt: pe.excerpt ? linkBlocks(pe.excerpt) : undefined,
      time: pe.time,
      sourceOrder: i,
      sourcePath: pe.sourcePath,
      meta: { ...pe.meta },
      reactions: pe.reactions,
      parentUnknown: pe.parentUnknown,
    };
    const parent = pe.parentTempId ? tempToId.get(pe.parentTempId) ?? ROOT : ROOT;
    (children[parent] ??= []).push(id);
  });

  parsed.entries.forEach((pe) => {
    if (pe.suggestedParentTempId) entries[tempToId.get(pe.tempId)!].suggestedParentId = tempToId.get(pe.suggestedParentTempId);
  });

  const issues: ReviewIssue[] = parsed.issues.map((pi) => ({
    id: newId(),
    kind: pi.kind,
    message: pi.message,
    entryId: pi.entryTempId ? tempToId.get(pi.entryTempId) : undefined,
    resolved: false,
  }));

  // 확보되지 않은 이미지
  for (const e of Object.values(entries)) {
    const missing = e.blocks.filter((b) => b.type === "image" && !b.assetId).length;
    if (missing)
      issues.push({ id: newId(), kind: "missing-image", message: `이미지 ${missing}개가 확보되지 않았습니다. 첨부 탭에서 파일을 연결해 주세요.`, entryId: e.id, resolved: false });
  }

  return {
    id: newId(),
    projectId: ctx.projectId,
    platform: "band",
    inputFormat: parsed.format,
    sourceKind: ctx.sourceKind,
    title: parsed.title,
    sourceId: ctx.sourceId,
    identities,
    identityOrder,
    entries,
    children,
    issues,
    view: defaultViewSettings(),
    parserVersion: ctx.parserVersion,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
}
