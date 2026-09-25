// 인물 중심 보기 (명세 21, A4 일부).
// 지금 프로젝트에 확보된 문서로 "재구성한" 인물별 글·댓글 목록이다. 밴드의 원래 목록 저장본이 아니며,
// 그 인물의 전체 활동이라고 표시하지 않는다. 프로필·스토리·반응 명단은 실제 샘플이 생기면 추가한다.
import { useMemo, useState } from "react";
import type { DocumentData, Entry, Identity } from "../domain/types";
import { blocksToPlainText } from "../importers/band/html";

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

export function PersonArchive({
  docs,
  currentDocId,
  assetUrl,
  onJump,
}: {
  docs: DocumentData[];
  currentDocId: string;
  assetUrl(id: string): string | undefined;
  onJump(docId: string, entryId: string): void;
}) {
  const people = useMemo(() => buildPeople(docs), [docs]);
  const [sel, setSel] = useState<string | null>(people[0]?.key ?? null);
  const [q, setQ] = useState("");
  const person = people.find((p) => p.key === sel) ?? people[0];

  const match = (it: PersonItem) => !q.trim() || blocksToPlainText(it.entry.blocks).toLowerCase().includes(q.trim().toLowerCase());

  if (!person) return <p className="muted small archive-empty">인물이 없습니다.</p>;
  const main = person.identities.find((x) => x.docId === currentDocId)?.identity ?? person.identities[0].identity;
  const avatar = main.avatarAssetId ? assetUrl(main.avatarAssetId) : undefined;
  const descs = Array.from(new Set(person.identities.map((x) => x.identity.description).filter(Boolean)));

  return (
    <div className="archive">
      <nav className="archive-list" aria-label="인물 목록">
        {people.map((p) => {
          const idn = p.identities[0].identity;
          const u = idn.avatarAssetId ? assetUrl(idn.avatarAssetId) : undefined;
          return (
            <button key={p.key} type="button" aria-current={p.key === person.key} onClick={() => setSel(p.key)} title={idn.originalName}>
              <span className="archive-avatar">{u ? <img src={u} alt="" /> : Array.from(idn.displayName)[0]}</span>
              <span className="ellipsis">{idn.displayName}</span>
              <small className="muted">{p.posts.length + p.comments.length}</small>
            </button>
          );
        })}
      </nav>
      <section className="archive-detail" aria-label="인물 기록">
        <header className="archive-profile">
          <span className="archive-avatar big">{avatar ? <img src={avatar} alt="" /> : Array.from(main.displayName)[0]}</span>
          <div>
            <h2>{main.displayName}</h2>
            {main.displayName !== main.originalName ? <p className="small muted">원래 이름: {main.originalName}</p> : null}
            {descs.map((d) => (
              <p key={d} className="small">
                {d}
              </p>
            ))}
            <p className="small muted">
              {person.identities.length}개 문서에서 관측 · 연결 근거: {person.linkBasis}
            </p>
          </div>
        </header>
        <p className="notice">
          지금 프로젝트에 확보된 문서로 다시 모은 목록입니다. 이 인물의 전체 글·댓글이 아닙니다. 프로필 상세·스토리·프로필 반응은 아직 가져올 수 없습니다(실제 샘플 필요).
        </p>
        <input className="archive-search" type="search" placeholder="이 인물의 글·댓글에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="인물 기록 검색" />
        <h3>게시글 {person.posts.length}</h3>
        <ItemList items={person.posts.filter(match)} onJump={onJump} />
        <h3>댓글 {person.comments.length}</h3>
        <ItemList items={person.comments.filter(match)} onJump={onJump} />
      </section>
    </div>
  );
}

function ItemList({ items, onJump }: { items: PersonItem[]; onJump(docId: string, entryId: string): void }) {
  if (!items.length) return <p className="small muted">없음</p>;
  return (
    <ul className="archive-items">
      {items.map((it) => (
        <li key={`${it.docId}:${it.entry.id}`}>
          <button type="button" onClick={() => onJump(it.docId, it.entry.id)}>
            <span className="archive-item-text">{blocksToPlainText(it.entry.blocks).slice(0, 160) || "(내용 없음)"}</span>
            <span className="small muted">
              {it.entry.time?.raw ?? "시각 없음"} · {it.docTitle}
              {it.excerptOnly ? " · 댓글 모음(원글은 발췌만)" : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
