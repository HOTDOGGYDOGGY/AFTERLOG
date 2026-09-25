// 편집 명령. 모두 (문서, 인자) → 새 문서 순수 함수이며 실행취소 기록의 단위가 된다.
import { produce, type Draft } from "immer";
import { newId } from "../domain/ids";
import { ROOT, type ContentBlock, type DocumentData, type Identity, type ViewSettings } from "../domain/types";
import { findParent } from "../domain/validate";
import { parseKoreanDateTime } from "../importers/band/time";

type D = Draft<DocumentData>;

/** immer 초안(Proxy)은 structuredClone이 안 되므로 순수 데이터로 복사한다 */
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function parentOf(d: D, id: string): string | null {
  for (const [p, list] of Object.entries(d.children)) if (list.includes(id)) return p;
  return null;
}

function isDescendant(d: D, ancestor: string, id: string): boolean {
  const stack = [...(d.children[ancestor] ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === id) return true;
    stack.push(...(d.children[cur] ?? []));
  }
  return false;
}

function detach(d: D, id: string): { parent: string; index: number } | null {
  const p = parentOf(d, id);
  if (!p) return null;
  const idx = d.children[p].indexOf(id);
  d.children[p].splice(idx, 1);
  return { parent: p, index: idx };
}

export const setTitle = (doc: DocumentData, title: string) =>
  produce(doc, (d) => {
    d.title = title;
  });

export const editTextBlock = (doc: DocumentData, entryId: string, blockIndex: number, text: string) =>
  produce(doc, (d) => {
    const b = d.entries[entryId]?.blocks[blockIndex];
    if (b && (b.type === "text" || b.type === "unclassified")) b.text = text;
  });

/** 본문 블록 전체 교체 (미분류 블록을 본문으로 확정할 때 등) */
export const setBlocks = (doc: DocumentData, entryId: string, blocks: ContentBlock[]) =>
  produce(doc, (d) => {
    const e = d.entries[entryId];
    if (e) e.blocks = blocks as Draft<ContentBlock>[];
  });

export const removeBlock = (doc: DocumentData, entryId: string, blockIndex: number) =>
  produce(doc, (d) => {
    d.entries[entryId]?.blocks.splice(blockIndex, 1);
  });

export const restoreOriginal = (doc: DocumentData, entryId: string) =>
  produce(doc, (d) => {
    const e = d.entries[entryId];
    if (e) e.blocks = plain(e.originalBlocks) as Draft<ContentBlock>[];
  });

export const editTime = (doc: DocumentData, entryId: string, raw: string) =>
  produce(doc, (d) => {
    const e = d.entries[entryId];
    if (!e) return;
    e.time = raw.trim() ? parseKoreanDateTime(raw, "사용자 입력") : null;
  });

/**
 * 항목을 newParent의 index 위치로 옮긴다. 자손 아래로 옮기는 것(순환)은 무시.
 * 자식들은 함께 따라간다(관계 보존).
 */
export const moveEntry = (doc: DocumentData, id: string, newParent: string, index: number) =>
  produce(doc, (d) => {
    if (id === newParent || (newParent !== ROOT && !d.entries[newParent])) return;
    if (isDescendant(d, id, newParent)) return;
    const from = detach(d, id);
    if (!from) return;
    const list = (d.children[newParent] ??= []);
    let at = index;
    if (from.parent === newParent && from.index < index) at -= 1;
    list.splice(Math.max(0, Math.min(at, list.length)), 0, id);
    const e = d.entries[id];
    if (e) {
      e.parentUnknown = false;
      delete e.suggestedParentId;
    }
  });

export function moveBy(doc: DocumentData, id: string, delta: -1 | 1): DocumentData {
  const p = findParent(doc, id);
  if (!p) return doc;
  const list = doc.children[p];
  const idx = list.indexOf(id);
  const target = idx + delta;
  if (target < 0 || target >= list.length) return doc;
  return produce(doc, (d) => {
    const l = d.children[p];
    l.splice(idx, 1);
    l.splice(target, 0, id);
  });
}

/** 부모 변경. 새 부모의 마지막 자식으로 붙는다. */
export function setParent(doc: DocumentData, id: string, newParent: string): DocumentData {
  const len = (doc.children[newParent] ?? []).length;
  return moveEntry(doc, id, newParent, len + 1);
}

export type DeleteMode = "with-children" | "promote-children";

export const deleteEntry = (doc: DocumentData, id: string, mode: DeleteMode) =>
  produce(doc, (d) => {
    const from = detach(d, id);
    if (!from) return;
    const kids = d.children[id] ?? [];
    if (mode === "promote-children") {
      d.children[from.parent].splice(from.index, 0, ...kids);
    } else {
      const stack = [...kids];
      while (stack.length) {
        const k = stack.pop()!;
        stack.push(...(d.children[k] ?? []));
        delete d.children[k];
        delete d.entries[k];
      }
    }
    delete d.children[id];
    delete d.entries[id];
    d.issues = d.issues.filter((i) => !i.entryId || d.entries[i.entryId]);
  });

/** 복제: 새 ID, 자식은 복제하지 않음, 바로 뒤에 삽입 */
export const duplicateEntry = (doc: DocumentData, id: string) =>
  produce(doc, (d) => {
    const e = d.entries[id];
    const p = parentOf(d, id);
    if (!e || !p) return;
    const copyId = newId();
    d.entries[copyId] = { ...plain(e), id: copyId } as Draft<typeof e>;
    const list = d.children[p];
    list.splice(list.indexOf(id) + 1, 0, copyId);
  });

/** 텍스트 블록의 offset 위치에서 항목을 둘로 나눈다. 뒷부분은 같은 작성자·같은 부모의 새 항목. */
export const splitEntry = (doc: DocumentData, id: string, blockIndex: number, offset: number) =>
  produce(doc, (d) => {
    const e = d.entries[id];
    const p = parentOf(d, id);
    if (!e || !p) return;
    const b = e.blocks[blockIndex];
    if (!b || b.type !== "text") return;
    const head = b.text.slice(0, offset).replace(/\s+$/, "");
    const tail = b.text.slice(offset).replace(/^\s+/, "");
    const before = e.blocks.slice(0, blockIndex);
    const after = e.blocks.slice(blockIndex + 1);
    e.blocks = [...before, ...(head ? [{ type: "text" as const, text: head }] : [])];
    const newBlocks = [...(tail ? [{ type: "text" as const, text: tail }] : []), ...after];
    const nid = newId();
    d.entries[nid] = {
      ...plain(e),
      id: nid,
      blocks: newBlocks,
      originalBlocks: plain(newBlocks),
    } as Draft<typeof e>;
    const list = d.children[p];
    list.splice(list.indexOf(id) + 1, 0, nid);
  });

/** 다음 형제 항목을 이 항목에 합친다. 다음 항목의 자식은 이 항목 아래로 옮긴다. */
export const mergeWithNext = (doc: DocumentData, id: string) =>
  produce(doc, (d) => {
    const p = parentOf(d, id);
    if (!p) return;
    const list = d.children[p];
    const nextId = list[list.indexOf(id) + 1];
    if (!nextId) return;
    const e = d.entries[id];
    const n = d.entries[nextId];
    e.blocks.push({ type: "text", text: "\n" }, ...n.blocks);
    const nk = d.children[nextId] ?? [];
    (d.children[id] ??= []).push(...nk);
    delete d.children[nextId];
    list.splice(list.indexOf(nextId), 1);
    delete d.entries[nextId];
    d.issues = d.issues.filter((i) => i.entryId !== nextId);
  });

export const setAuthor = (doc: DocumentData, entryId: string, identityId: string | null) =>
  produce(doc, (d) => {
    const e = d.entries[entryId];
    if (e && (identityId === null || d.identities[identityId])) e.authorId = identityId;
  });

/** 같은 이름의 다른 사람: 이 항목(들)을 새 인물로 분리한다. */
export const splitIdentity = (doc: DocumentData, entryIds: string[], name?: string) =>
  produce(doc, (d) => {
    const first = d.entries[entryIds[0]];
    const src = first?.authorId ? d.identities[first.authorId] : null;
    const id = newId();
    const base = name ?? src?.displayName ?? "새 인물";
    d.identities[id] = {
      id,
      originalName: src?.originalName ?? base,
      displayName: `${base} (2)`,
      description: src?.description ?? "",
      originalDescription: src?.originalDescription ?? "",
      avatarAssetId: src?.avatarAssetId ?? null,
      avatarSourceRef: src?.avatarSourceRef,
      color: null,
      hidden: false,
    };
    const at = src ? d.identityOrder.indexOf(src.id) + 1 : d.identityOrder.length;
    d.identityOrder.splice(at, 0, id);
    for (const eid of entryIds) if (d.entries[eid]) d.entries[eid].authorId = id;
  });

/** from 인물의 항목을 모두 into 인물로 옮기고 from을 삭제 */
export const mergeIdentities = (doc: DocumentData, fromId: string, intoId: string) =>
  produce(doc, (d) => {
    if (fromId === intoId || !d.identities[fromId] || !d.identities[intoId]) return;
    for (const e of Object.values(d.entries)) if (e.authorId === fromId) e.authorId = intoId;
    delete d.identities[fromId];
    d.identityOrder = d.identityOrder.filter((x) => x !== fromId);
  });

export const updateIdentity = (doc: DocumentData, id: string, patch: Partial<Omit<Identity, "id">>) =>
  produce(doc, (d) => {
    const idn = d.identities[id];
    if (idn) Object.assign(idn, patch);
  });

export const updateView = (doc: DocumentData, patch: (v: Draft<ViewSettings>) => void) =>
  produce(doc, (d) => {
    patch(d.view);
  });

export const setImageAsset = (doc: DocumentData, entryId: string, blockIndex: number, assetId: string | null) =>
  produce(doc, (d) => {
    const b = d.entries[entryId]?.blocks[blockIndex];
    if (b && b.type === "image") b.assetId = assetId;
    refreshMissingImageIssues(d);
  });

export const insertImage = (doc: DocumentData, entryId: string, assetId: string, atIndex?: number) =>
  produce(doc, (d) => {
    const e = d.entries[entryId];
    if (!e) return;
    const block: ContentBlock = { type: "image", assetId };
    if (atIndex === undefined || atIndex >= e.blocks.length) e.blocks.push(block);
    else e.blocks.splice(atIndex, 0, block);
  });

export const resolveIssue = (doc: DocumentData, issueId: string, resolved: boolean) =>
  produce(doc, (d) => {
    const i = d.issues.find((x) => x.id === issueId);
    if (i) i.resolved = resolved;
  });

function refreshMissingImageIssues(d: D) {
  for (const issue of d.issues) {
    if (issue.kind !== "missing-image" || !issue.entryId) continue;
    const e = d.entries[issue.entryId];
    const missing = e ? e.blocks.filter((b) => b.type === "image" && !b.assetId).length : 0;
    issue.resolved = missing === 0;
  }
}

/** 제안된 부모로 연결(사용자 확정). 제안이 없거나 순환이면 그대로 */
export function applyParentSuggestion(doc: DocumentData, id: string): DocumentData {
  const e = doc.entries[id];
  if (!e?.suggestedParentId || !doc.entries[e.suggestedParentId]) return doc;
  const moved = setParent(doc, id, e.suggestedParentId);
  return produce(moved, (d) => {
    const x = d.entries[id];
    if (x) {
      x.parentUnknown = false;
      delete x.suggestedParentId;
    }
  });
}

/** 제안이 있는 항목을 모두 연결. 한 번의 실행취소로 되돌린다 */
export function applyAllParentSuggestions(doc: DocumentData): DocumentData {
  const ids = Object.values(doc.entries)
    .filter((e) => e.suggestedParentId)
    .sort((a, b) => a.sourceOrder - b.sourceOrder)
    .map((e) => e.id);
  return ids.reduce((d, id) => applyParentSuggestion(d, id), doc);
}

/** 부모 미확정 표시를 지운다(지금 위치가 맞다고 확정) */
export const confirmParent = (doc: DocumentData, id: string) =>
  produce(doc, (d) => {
    const x = d.entries[id];
    if (x) {
      x.parentUnknown = false;
      delete x.suggestedParentId;
    }
  });
