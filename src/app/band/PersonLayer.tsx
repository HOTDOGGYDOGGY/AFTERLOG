// 보관된 인물 프로필(레이어). 가져온 문서에서 다시 모은 글·댓글이며, 밴드의 실제 프로필 전체를 수집한 것이 아니다.
// 스토리·프로필 반응은 수집 미지원으로 분명히 표시한다(가짜 커버·가짜 수치 없음).
import { useLayoutEffect, useRef } from "react";
import type { DocumentData } from "../../domain/types";
import { blocksToPlainText } from "../../importers/band/html";
import { Avatar, reactionKnown } from "../../renderers/band/BandView";
import { bandRootClass, bandRootStyle, type AppThemeResolved } from "../../renderers/band/style";
import type { PersonTab } from "../nav";
import { loadScroll, saveScroll } from "../nav";
import type { Person, PersonItem } from "../PersonArchive";

const TABS: [PersonTab, string][] = [
  ["posts", "작성 글"],
  ["comments", "작성 댓글"],
  ["stories", "스토리"],
  ["reactions", "반응"],
];

export function PersonLayer({
  person,
  docs,
  tab,
  onTab,
  assetUrl,
  appTheme,
  onJump,
}: {
  person: Person;
  docs: DocumentData[];
  tab: PersonTab;
  onTab(t: PersonTab): void;
  assetUrl(id: string): string | undefined;
  appTheme: AppThemeResolved;
  onJump(docId: string, entryId: string): void;
}) {
  const main = person.identities[0];
  const doc = docs.find((d) => d.id === main.docId)!;
  const idn = main.identity;
  const descs = Array.from(new Set(person.identities.map((x) => x.identity.description).filter(Boolean)));
  const scroll = useRef<HTMLDivElement>(null);
  const key = `band:person:${person.key}:${tab}`;
  useLayoutEffect(() => {
    const top = loadScroll(key);
    if (scroll.current) scroll.current.scrollTop = top ?? 0;
  }, [key]);
  const reacted = [...person.posts, ...person.comments].filter((it) => reactionKnown(it.entry.reactions));

  return (
    <div className={`${bandRootClass(doc.view, appTheme, "read")} band-profile`} style={{ ...bandRootStyle(doc.view), maxWidth: "none" }} ref={scroll} onScroll={(e) => saveScroll(key, (e.currentTarget as HTMLElement).scrollTop)}>
      <header className="band-profile-head">
        <Avatar doc={doc} identity={idn} context="profile" assetUrl={assetUrl} />
        <h2 className="al-name" style={idn.color ? { color: idn.color } : undefined}>
          {idn.displayName}
        </h2>
        {idn.displayName !== idn.originalName ? <p className="al-desc">원래 이름: {idn.originalName}</p> : null}
        {descs.map((d) => (
          <p key={d} className="al-desc">
            {d}
          </p>
        ))}
        <p className="band-profile-note">
          보관된 글 {person.identities.length}개에서 관측 · 연결 근거: {person.linkBasis}
        </p>
      </header>
      <nav className="band-profile-tabs" role="tablist" aria-label="인물 기록">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)}>
            {label}
            {t === "posts" ? ` ${person.posts.length}` : t === "comments" ? ` ${person.comments.length}` : ""}
          </button>
        ))}
      </nav>
      <div className="band-profile-body">
        {tab === "posts" ? <Items items={person.posts} onJump={onJump} empty="보관된 글이 없습니다." /> : null}
        {tab === "comments" ? <Items items={person.comments} onJump={onJump} empty="보관된 댓글이 없습니다." /> : null}
        {tab === "stories" ? <p className="band-profile-empty">프로필 스토리와 스토리 댓글은 아직 수집하지 않습니다(실제 화면 샘플 확인 전).</p> : null}
        {tab === "reactions" ? (
          reacted.length ? (
            <Items items={reacted} onJump={onJump} empty="" showReactions />
          ) : (
            <p className="band-profile-empty">
              이 인물의 글·댓글에서 확인된 표정 수가 없습니다. 화면에 수가 보이지 않던 곳은 0이 아니라 '미확보'입니다. 프로필 자체에 달린 반응·하트는 아직 수집하지 않습니다.
            </p>
          )
        ) : null}
        <p className="band-profile-note">지금 프로젝트에 가져온 글에서 다시 모은 목록입니다. 이 인물의 전체 활동이 아닙니다.</p>
      </div>
    </div>
  );
}

function Items({ items, onJump, empty, showReactions }: { items: PersonItem[]; onJump(docId: string, entryId: string): void; empty: string; showReactions?: boolean }) {
  if (!items.length) return <p className="band-profile-empty">{empty}</p>;
  return (
    <ul className="band-profile-items">
      {items.map((it) => (
        <li key={`${it.docId}:${it.entry.id}`}>
          <button type="button" onClick={() => onJump(it.docId, it.entry.id)}>
            <span className="band-profile-text">{blocksToPlainText(it.entry.blocks).slice(0, 200) || "(내용 없음)"}</span>
            <span className="al-sub">
              <span>{it.entry.time?.raw ?? "시각 없음"}</span>
              <span className="ellipsis">{it.docTitle}</span>
              {it.excerptOnly ? <span>댓글 모음(원글은 발췌만)</span> : null}
              {showReactions && it.entry.reactions ? <span>표정 {it.entry.reactions.total ?? "?"}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
