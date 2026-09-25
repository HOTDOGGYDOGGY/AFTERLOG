// 같은 글의 새 관측을 기존 글에 합치기(팝업·병합 명세 6.3). '기존 글이니 건너뜀'으로 끝내지 않고 새 댓글·답글만 더한다.
// 원본 댓글 ID가 없어 임시 키 = 부모 키 + 종류 + 작성자 원래 이름 + 시각 원문 + 글(정규화) + 같은 부모 안 순번.
// 같은 문장을 두 번 쓴 댓글은 순번으로 둘 다 남고, 기존에만 있는 댓글은 지우지 않는다(C06·M05).
import { newId } from "../domain/ids";
import { ROOT, type DocumentData, type Entry } from "../domain/types";
import { blocksToPlainText } from "../importers/band/html";

const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, "");

function parentMap(doc: DocumentData) {
  const m = new Map<string, string>();
  for (const [p, kids] of Object.entries(doc.children)) for (const k of kids) m.set(k, p);
  return m;
}

/** 문서 안 모든 항목의 임시 키(부모 → 자식 순서) */
export function entryKeys(doc: DocumentData): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (parent: string, parentKey: string) => {
    const seen = new Map<string, number>();
    for (const id of doc.children[parent] ?? []) {
      const e = doc.entries[id];
      if (!e) continue;
      const who = e.authorId ? doc.identities[e.authorId]?.originalName ?? "" : "";
      const base = `${parentKey}/${e.kind}|${who}|${e.time?.raw ?? ""}|${norm(blocksToPlainText(e.originalBlocks?.length ? e.originalBlocks : e.blocks)).slice(0, 300)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const key = `${base}#${n}`;
      out.set(id, key);
      walk(id, key);
    }
  };
  walk(ROOT, "");
  return out;
}

export interface EntryMergeResult {
  doc: DocumentData;
  /** 더한 항목(댓글·답글) 수 */
  added: number;
}

/** old에 없는 inc의 항목을 같은 자리에 더한다. old의 편집·항목은 바꾸지 않는다 */
export function mergeDocEntries(old: DocumentData, inc: DocumentData): EntryMergeResult {
  const oldKeys = entryKeys(old);
  const incKeys = entryKeys(inc);
  const byKey = new Map<string, string>();
  for (const [id, k] of oldKeys) byKey.set(k, id);
  const incToOld = new Map<string, string>([[ROOT, ROOT]]);
  for (const [id, k] of incKeys) {
    const hit = byKey.get(k);
    if (hit) incToOld.set(id, hit);
  }
  const doc: DocumentData = structuredClone(old);
  let added = 0;
  // 작성자: 원래 이름·설명이 같은 기존 인물로, 없으면 새 인물로
  const idnMap = new Map<string, string>();
  const identityFor = (incId: string | null): string | null => {
    if (!incId) return null;
    const cached = idnMap.get(incId);
    if (cached) return cached;
    const src = inc.identities[incId];
    if (!src) return null;
    const hit = Object.values(doc.identities).find((i) => i.originalName === src.originalName && i.originalDescription === src.originalDescription);
    let id = hit?.id;
    if (!id) {
      id = newId();
      doc.identities[id] = { ...src, id };
      doc.identityOrder.push(id);
    }
    idnMap.set(incId, id);
    return id;
  };
  let order = Math.max(0, ...Object.values(doc.entries).map((e) => e.sourceOrder)) + 1;
  const walk = (incParent: string) => {
    const kids = inc.children[incParent] ?? [];
    kids.forEach((incId, i) => {
      if (!incToOld.has(incId)) {
        const oldParent = incToOld.get(incParent);
        const e = inc.entries[incId];
        if (!oldParent || !e) return;
        const id = newId();
        const entry: Entry = { ...structuredClone(e), id, authorId: identityFor(e.authorId), sourceOrder: order++ };
        delete entry.suggestedParentId;
        doc.entries[id] = entry;
        const list = (doc.children[oldParent] ??= []);
        // 자리: 앞 형제 뒤, 없으면 뒤 형제 앞, 둘 다 없으면 끝
        const prev = kids.slice(0, i).reverse().map((k) => incToOld.get(k)).find((x) => x && list.includes(x));
        const next = kids.slice(i + 1).map((k) => incToOld.get(k)).find((x) => x && list.includes(x));
        const at = prev ? list.indexOf(prev) + 1 : next ? list.indexOf(next) : list.length;
        list.splice(at, 0, id);
        incToOld.set(incId, id);
        added++;
      }
      walk(incId);
    });
  };
  walk(ROOT);
  if (added) {
    // 댓글 수가 모자라다는 안내는 채워졌으면 닫는다(표시 수는 고치지 않음)
    const post = (doc.children[ROOT] ?? []).map((id) => doc.entries[id]).find(Boolean);
    const shown = post?.meta.commentCount;
    const have = Object.values(doc.entries).filter((e) => e.kind !== "post").length;
    if (shown !== undefined && have >= shown) doc.issues = doc.issues.map((x) => (x.kind === "comment-count-mismatch" ? { ...x, resolved: true } : x));
  }
  return { doc, added };
}

/** 부모 관계 확인용(테스트) */
export const _parentMap = parentMap;
