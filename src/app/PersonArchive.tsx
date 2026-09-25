// 인물 묶기(명세 21, A4 일부). 원형 보기의 인물 프로필(band/PersonLayer)이 쓴다.
// 지금 프로젝트에 확보된 문서로 "재구성한" 인물별 글·댓글 목록이다. 밴드의 원래 목록 저장본이 아니며,
// 그 인물의 전체 활동이라고 표시하지 않는다. 프로필·스토리·반응 명단은 실제 샘플이 생기면 추가한다.
import type { DocumentData, Entry, Identity } from "../domain/types";

export interface PersonItem {
  docId: string;
  docTitle: string;
  entry: Entry;
  /** 원글 발췌만 있는 댓글 모음 항목 */
  excerptOnly: boolean;
}

export interface Person {
  key: string;
  identities: { docId: string; identity: Identity }[];
  posts: PersonItem[];
  comments: PersonItem[];
  linkBasis: string;
}

/**
 * 문서들 사이에서 같은 사람으로 볼 근거가 있을 때만 묶는다:
 * 원래 이름이 같고 프로필 사진 파일(해시가 같아 같은 자산 ID)도 같을 때.
 * 사진이 없으면 문서마다 따로 둔다(동명이인 자동 병합 금지).
 */
export function buildPeople(docs: DocumentData[]): Person[] {
  const map = new Map<string, Person>();
  for (const d of docs) {
    for (const id of d.identityOrder) {
      const idn = d.identities[id];
      if (!idn) continue;
      const key = idn.avatarAssetId ? `${idn.originalName}\u0000${idn.avatarAssetId}` : `${idn.originalName}\u0000doc:${d.id}:${idn.id}`;
      const p = map.get(key) ?? {
        key,
        identities: [],
        posts: [],
        comments: [],
        linkBasis: idn.avatarAssetId ? "같은 이름·같은 프로필 사진" : "이 문서 안에서만",
      };
      p.identities.push({ docId: d.id, identity: idn });
      for (const e of Object.values(d.entries)) {
        if (e.authorId !== idn.id) continue;
        const item: PersonItem = { docId: d.id, docTitle: d.title, entry: e, excerptOnly: d.inputFormat === "band-member-comments" };
        if (e.kind === "post") p.posts.push(item);
        else p.comments.push(item);
      }
      map.set(key, p);
    }
  }
  const byTime = (a: PersonItem, b: PersonItem) => (a.entry.time?.local ?? "").localeCompare(b.entry.time?.local ?? "") || a.entry.sourceOrder - b.entry.sourceOrder;
  for (const p of map.values()) {
    p.posts.sort(byTime);
    p.comments.sort(byTime);
  }
  return Array.from(map.values()).sort((a, b) => b.posts.length + b.comments.length - (a.posts.length + a.comments.length));
}
