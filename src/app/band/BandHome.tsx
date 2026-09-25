// 밴드 원형 보기의 바탕 화면: 왼쪽 밴드 정보, 가운데 게시글 피드, 오른쪽 채팅 목록.
// 보관된 자료에서 계산한 값만 보여 준다(가짜 통계·초대·글쓰기 버튼 없음). 글을 누르면 상세 레이어가 위에 열린다.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ROOT, type DocumentData, type Entry } from "../../domain/types";
import { blocksToPlainText } from "../../importers/band/html";
import { Avatar, countComments, reactionKnown } from "../../renderers/band/BandView";
import { bandRootClass, bandRootStyle, type AppThemeResolved } from "../../renderers/band/style";
import { Icon } from "../../components/Icon";
import { loadScroll, saveScroll } from "../nav";
import type { Person } from "../PersonArchive";

type Sort = "source" | "time" | "imported";

function rootPost(d: DocumentData): Entry | null {
  return (d.children[ROOT] ?? []).map((id) => d.entries[id]).find((e) => e?.kind === "post") ?? null;
}

export function BandHome({
  title,
  docs,
  people,
  assetUrl,
  appTheme,
  onOpenDoc,
  onOpenPerson,
  onOpenChat,
  dimmed,
  captureCount,
}: {
  title: string;
  docs: DocumentData[];
  people: Person[];
  assetUrl(id: string): string | undefined;
  appTheme: AppThemeResolved;
  onOpenDoc(docId: string): void;
  onOpenPerson(key: string): void;
  onOpenChat(): void;
  dimmed: boolean;
  captureCount: number;
}) {
  const [sort, setSort] = useState<Sort>("source");
  const [q, setQ] = useState("");
  const [author, setAuthor] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  // 피드 읽던 위치 복원(새로고침·다른 플랫폼에 다녀온 뒤)
  useLayoutEffect(() => {
    const top = loadScroll("band:home");
    if (top !== null && scroller.current) scroller.current.scrollTop = top;
  }, []);

  const rows = useMemo(() => {
    const list = docs.map((d, i) => ({ d, i, post: rootPost(d) }));
    const needle = q.trim().toLowerCase();
    const filtered = list.filter(({ d, post }) => {
      if (author && !(post?.authorId && d.identities[post.authorId]?.originalName === author) && !(d.inputFormat === "band-member-comments" && Object.values(d.identities).some((x) => x.originalName === author))) return false;
      if (!needle) return true;
      return d.title.toLowerCase().includes(needle) || Object.values(d.entries).some((e) => blocksToPlainText(e.blocks).toLowerCase().includes(needle));
    });
    if (sort === "time") filtered.sort((a, b) => (b.post?.time?.local ?? "").localeCompare(a.post?.time?.local ?? ""));
    if (sort === "imported") filtered.sort((a, b) => b.d.createdAt.localeCompare(a.d.createdAt));
    return filtered;
  }, [docs, sort, q, author]);

  const authors = useMemo(() => {
    const s = new Set<string>();
    for (const d of docs) {
      const p = rootPost(d);
      if (p?.authorId) s.add(d.identities[p.authorId]?.originalName ?? "");
    }
    return [...s].filter(Boolean).sort();
  }, [docs]);

  return (
    <div
      className={`band-home${dimmed ? " is-dimmed" : ""}`}
      ref={scroller}
      onScroll={(e) => saveScroll("band:home", (e.currentTarget as HTMLElement).scrollTop)}
      aria-hidden={dimmed || undefined}
      inert={dimmed || undefined}
    >
      <div className="band-home-grid">
        <aside className="band-side band-info" aria-label="밴드 정보">
          <div className="band-cover" aria-hidden="true">
            <span>{title.match(/[\p{L}\p{N}]/u)?.[0] ?? "B"}</span>
          </div>
          <h2 className="band-name">{title}</h2>
          <p className="band-sub">보관된 밴드</p>
          <p className="band-sub">
            보관된 인물 {people.length}명 · 글 {docs.length}개
          </p>
          {captureCount ? <p className="band-sub">수집 보고서 {captureCount}개</p> : null}
          <nav className="band-people-mini" aria-label="인물">
            {people.slice(0, 12).map((p) => {
              const idn = p.identities[0];
              const d = docs.find((x) => x.id === idn.docId);
              return d ? (
                <button key={p.key} type="button" title={idn.identity.displayName} onClick={() => onOpenPerson(p.key)}>
                  <Avatar doc={d} identity={idn.identity} context="reply" assetUrl={assetUrl} />
                </button>
              ) : null;
            })}
          </nav>
        </aside>

        <main className="band-feed" aria-label="게시글">
          <div className="band-feed-tools">
            <label className="search-box">
              <Icon name="search" size={16} />
              <input type="search" placeholder="글·댓글 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="글 검색" />
            </label>
            {authors.length > 1 ? (
              <select value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="작성자 필터">
                <option value="">모든 작성자</option>
                {authors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            ) : null}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬">
              <option value="source">가져온 순서</option>
              <option value="time">작성 시각</option>
              <option value="imported">최근 가져옴</option>
            </select>
          </div>
          {rows.length === 0 ? <p className="band-empty-note">조건에 맞는 글이 없습니다.</p> : null}
          {rows.map(({ d, post }) => (
            <FeedCard key={d.id} doc={d} post={post} assetUrl={assetUrl} appTheme={appTheme} onOpen={() => onOpenDoc(d.id)} onOpenPerson={onOpenPerson} people={people} />
          ))}
        </main>

        <aside className="band-side band-chat-list" aria-label="채팅">
          <div className="band-chat-head">
            <b>채팅</b>
          </div>
          <button type="button" className="band-chat-empty" onClick={onOpenChat}>
            <Icon name="chat" size={18} />
            <span>
              보관된 채팅 없음
              <small>밴드 채팅 저장은 아직 지원하지 않습니다</small>
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
}

function personKeyFor(people: Person[], docId: string, identityId: string): string | null {
  return people.find((p) => p.identities.some((x) => x.docId === docId && x.identity.id === identityId))?.key ?? null;
}

function FeedCard({
  doc,
  post,
  assetUrl,
  appTheme,
  onOpen,
  onOpenPerson,
  people,
}: {
  doc: DocumentData;
  post: Entry | null;
  assetUrl(id: string): string | undefined;
  appTheme: AppThemeResolved;
  onOpen(): void;
  onOpenPerson(key: string): void;
  people: Person[];
}) {
  // 피드 카드는 밴드 원형 모양 그대로(꾸미기의 댓글 스킨은 상세에만)
  const cls = bandRootClass(doc.view, appTheme, "read");
  if (doc.inputFormat === "band-member-comments" || !post) {
    const n = Object.keys(doc.entries).length;
    const who = Object.values(doc.identities)[0];
    return (
      <article className={`${cls} band-card`} style={bandRootStyle(doc.view)}>
        <button type="button" className="band-card-open" onClick={onOpen}>
          <div className="al-post-main">
            <div className="al-name-row">
              <strong className="al-name">{doc.inputFormat === "band-member-comments" ? "댓글 모음" : doc.title}</strong>
              {who ? <span className="al-desc">{who.displayName}</span> : null}
            </div>
            <p className="band-card-text">{doc.title}</p>
            <div className="al-counts">
              <span>항목 {n}개</span>
            </div>
          </div>
        </button>
      </article>
    );
  }
  const idn = post.authorId ? doc.identities[post.authorId] ?? null : null;
  const text = blocksToPlainText(post.blocks.filter((b) => b.type !== "image"));
  const images = post.blocks.filter((b) => b.type === "image");
  const shown = post.meta.commentCount;
  const found = countComments(doc, post.id);
  const pk = idn ? personKeyFor(people, doc.id, idn.id) : null;
  return (
    <article className={`${cls} band-card`} style={bandRootStyle(doc.view)}>
      <div className="al-post-main">
        <header className="al-post-head">
          <Avatar doc={doc} identity={idn} context="post" assetUrl={assetUrl} onOpen={pk ? () => onOpenPerson(pk) : undefined} />
          <div className="al-post-meta">
            <div className="al-name-row">
              {pk ? (
                <button type="button" className="al-name al-person-link" onClick={() => onOpenPerson(pk)} style={idn?.color ? { color: idn.color } : undefined}>
                  {idn?.displayName}
                </button>
              ) : (
                <strong className="al-name">{idn?.displayName ?? "(작성자 미확정)"}</strong>
              )}
              {doc.view.show.description && idn?.description ? <span className="al-desc">{idn.description}</span> : null}
            </div>
            <div className="al-sub">{post.time ? <time>{post.time.raw}</time> : null}</div>
          </div>
        </header>
        <button type="button" className="band-card-open" onClick={onOpen} aria-label={`${doc.title} 글 열기`}>
          <p className="band-card-text">{text || "(본문 없음)"}</p>
          {images.length ? (
            <div className={`band-card-images n-${Math.min(images.length, 4)}`}>
              {images.slice(0, 4).map((b, i) => {
                const url = b.type === "image" && b.assetId ? assetUrl(b.assetId) : undefined;
                return url ? <img key={i} src={url} alt="" /> : <span key={i} className="band-card-img-missing">이미지 미확보</span>;
              })}
              {images.length > 4 ? <span className="band-card-more">+{images.length - 4}</span> : null}
            </div>
          ) : null}
        </button>
        <div className="al-counts">
          {reactionKnown(post.reactions) ? (
            <span className="al-reactions">
              <Icon name="smile" size={16} /> {post.reactions!.total ?? "?"}
            </span>
          ) : null}
          <span>
            댓글 {found}
            {shown !== undefined && shown !== found ? ` / 표시 ${shown}` : ""}
          </span>
        </div>
      </div>
    </article>
  );
}
