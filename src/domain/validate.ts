import { ROOT, type DocumentData } from "./types";

/**
 * 문서 관계 무결성 검사. 문제 목록을 돌려준다(빈 배열이면 정상).
 * - children 참조가 실제 항목을 가리키는가
 * - 모든 항목이 정확히 한 번 트리에 등장하는가
 * - 순환이 없는가
 * - 작성자 ID가 존재하는가
 */
export function validateDocument(doc: DocumentData): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const [parent, list] of Object.entries(doc.children)) {
    if (parent !== ROOT && !doc.entries[parent]) errors.push(`없는 부모 ${parent}`);
    if (!Array.isArray(list)) {
      errors.push(`children[${parent}] 형식 오류`);
      continue;
    }
    for (const id of list) {
      if (!doc.entries[id]) errors.push(`없는 항목 참조 ${id}`);
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  for (const id of Object.keys(doc.entries)) {
    const n = seen.get(id) ?? 0;
    if (n !== 1) errors.push(`항목 ${id}가 트리에 ${n}번 등장`);
  }
  // 순환: ROOT에서 도달 가능한지로 확인
  const reach = new Set<string>();
  const stack = [...(doc.children[ROOT] ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id)) {
      errors.push(`순환 참조 ${id}`);
      continue;
    }
    reach.add(id);
    stack.push(...(doc.children[id] ?? []));
  }
  for (const id of Object.keys(doc.entries)) if (!reach.has(id)) errors.push(`루트에서 도달 불가 ${id}`);
  for (const e of Object.values(doc.entries)) {
    if (e.authorId && !doc.identities[e.authorId]) errors.push(`없는 인물 ${e.authorId}`);
  }
  return errors;
}

/** 항목의 부모 ID (ROOT 포함). 트리에 없으면 null */
export function findParent(doc: DocumentData, id: string): string | null {
  for (const [p, list] of Object.entries(doc.children)) if (list.includes(id)) return p;
  return null;
}

export function depthOf(doc: DocumentData, id: string): number {
  let d = 0;
  let cur: string | null = id;
  while (cur && cur !== ROOT) {
    cur = findParent(doc, cur);
    d++;
    if (d > 50) break;
  }
  return d - 1;
}
