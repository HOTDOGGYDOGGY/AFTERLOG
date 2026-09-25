// 밴드 기록 렌더러. 원형 보기(read)·내용 편집(edit)·HTML/PNG 내보내기(export)가 같은 컴포넌트와 같은 스타일 해석기를 쓴다.
// 편집 기능(선택·편집·메뉴)은 edit 훅으로만, 원형 보기의 이동(인물 열기·표정 내역)은 read 훅으로만 들어온다.
// export 모드에서는 둘 다 렌더링하지 않는다(내보낸 파일에 조작 요소가 남지 않음).
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { ROOT, type ContentBlock, type DocumentData, type Entry, type Identity, type ReactionSnapshot } from "../../domain/types";
import { avatarShapeFor, bandRootClass, bandRootStyle, currentAppTheme, docStyle, type AppThemeResolved } from "./style";
import { Icon } from "../../components/Icon";

export type BandMode = "edit" | "read" | "export";

export interface BandEditHooks {
  selectedId: string | null;
  onSelect(id: string): void;
  renderText(entry: Entry, blockIndex: number, text: string): ReactNode;
  renderTools(entry: Entry): ReactNode;
  entryProps(entry: Entry): HTMLAttributes<HTMLElement>;
  dropIndicator: { id: string; pos: "before" | "after" } | null;
}

/** 원형 보기의 이동. 실제 서비스에 아무것도 보내지 않는다 */
export interface BandReadHooks {
  onOpenPerson?(identityId: string): void;
  onShowReactions?(entryId: string): void;
  onOpenImage?(src: string): void;
  /** 이동해 와서 잠시 강조할 항목 */
  highlightId?: string | null;
}

export interface BandViewProps {
  doc: DocumentData;
  assetUrl: (id: string) => string | undefined;
  mode: BandMode;
  edit?: BandEditHooks;
  read?: BandReadHooks;
  /** 부분 렌더링(PNG 분할 등)에 쓸 루트 항목 목록. 없으면 전체 */
  rootIds?: string[];
  /** 기록 테마가 '앱과 연결'일 때 쓸 값. 없으면 지금 화면 테마 */
  appTheme?: AppThemeResolved;
  /** 원형 보기의 표정 내역·댓글 줄(보관 기록용, 누르면 보관 내역만 보여 줌) */
  actionStrip?: boolean;
}

export { bandRootStyle };

export function BandView({ doc, assetUrl, mode, edit, read, rootIds, appTheme, actionStrip }: BandViewProps) {
  const roots = rootIds ?? doc.children[ROOT] ?? [];
  const ctx: Ctx = { doc, assetUrl, mode, edit: mode === "edit" ? edit : undefined, read: mode === "read" ? read : undefined, actionStrip: mode === "read" && !!actionStrip };
  return (
    <div className={bandRootClass(doc.view, appTheme ?? currentAppTheme(), mode)} style={bandRootStyle(doc.view)}>
      {roots.map((id, i) => {
        const e = doc.entries[id];
        if (!e) return null;
        if (doc.inputFormat === "band-member-comments") return <MemberCommentCard key={id} ctx={ctx} entry={e} />;
        if (e.kind === "post") return <Post key={id} ctx={ctx} entry={e} />;
        return <CommentNode key={id} ctx={ctx} entry={e} depth={0} prevAuthor={i > 0 ? doc.entries[roots[i - 1]]?.authorId ?? null : null} />;
      })}
    </div>
  );
}

interface Ctx {
  doc: DocumentData;
  assetUrl: (id: string) => string | undefined;
  mode: BandMode;
  edit?: BandEditHooks;
  read?: BandReadHooks;
  actionStrip: boolean;
}

function identityOf(doc: DocumentData, e: Entry): Identity | null {
  return e.authorId ? doc.identities[e.authorId] ?? null : null;
}

function isHidden(doc: DocumentData, e: Entry) {
  return !!identityOf(doc, e)?.hidden;
}

function hasVisibleDescendant(doc: DocumentData, id: string): boolean {
  for (const c of doc.children[id] ?? []) {
    const ce = doc.entries[c];
    if (ce && !isHidden(doc, ce)) return true;
    if (hasVisibleDescendant(doc, c)) return true;
  }
  return false;
}

type AvatarCtx = "post" | "comment" | "reply" | "profile";

/** 인장: 원본 이미지는 그대로 두고 모양·크기·자르기만 표시에서 바꾼다 */
export function Avatar({
  doc,
  identity,
  context,
  assetUrl,
  onOpen,
}: {
  doc: DocumentData;
  identity: Identity | null;
  context: AvatarCtx;
  assetUrl: (id: string) => string | undefined;
  onOpen?: () => void;
}) {
  const st = docStyle(doc.view);
  const size = st.avatar.sizes[context];
  const shape = avatarShapeFor(doc.view, identity);
  const url = identity?.avatarAssetId ? assetUrl(identity.avatarAssetId) : undefined;
  const crop = identity?.style?.avatarCrop;
  const box: CSSProperties = { width: size, height: size };
  const cls = `al-avatar is-${shape}${st.avatar.fit === "contain" ? " is-contain" : ""}`;
  let inner: ReactNode;
  if (url) {
    const img: CSSProperties = crop ? { transform: `scale(${crop.zoom}) translate(${crop.x}%, ${crop.y}%)` } : {};
    inner = <img src={url} alt="" width={size} height={size} style={img} />;
  } else if (st.avatar.fallback === "none") {
    return null;
  } else if (st.avatar.fallback === "neutral") {
    inner = <Icon name="user" size={Math.round(size * 0.6)} />;
  } else {
    const name = identity?.displayName ?? "?";
    inner = <span style={{ fontSize: Math.round(size * 0.42) }}>{Array.from(name.trim())[0] ?? "?"}</span>;
  }
  const empty = url ? "" : " al-avatar-empty";
  if (onOpen)
    return (
      <button
        type="button"
        className={`${cls}${empty} al-person-link`}
        style={box}
        onClick={(ev) => {
          ev.stopPropagation();
          onOpen();
        }}
        aria-label={`${identity?.displayName ?? "작성자"} 프로필`}
      >
        {inner}
      </button>
    );
  return (
    <span className={`${cls}${empty}`} style={box} aria-hidden="true">
      {inner}
    </span>
  );
}

function Name({ identity, onOpen }: { identity: Identity | null; onOpen?: () => void }) {
  const label = identity?.displayName || "(작성자 미확정)";
  const style = identity?.color ? { color: identity.color } : undefined;
  if (onOpen)
    return (
      <button
        type="button"
        className="al-name al-person-link"
        style={style}
        onClick={(ev) => {
          ev.stopPropagation();
          onOpen();
        }}
      >
        {label}
      </button>
    );
  return (
    <strong className="al-name" style={style}>
      {label}
    </strong>
  );
}

function Blocks({ blocks, entry, ctx, omitMissing }: { blocks: ContentBlock[]; entry: Entry; ctx: Ctx; omitMissing?: boolean }) {
  const { mode, edit, assetUrl, read } = ctx;
  // 연속된 텍스트/멘션은 한 문단(pre-wrap), 이미지는 블록
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = (k: string) => {
    if (run.length) out.push(<p className="al-text" key={`t${k}`}>{run}</p>);
    run = [];
  };
  blocks.forEach((b, i) => {
    if (b.type === "text") {
      run.push(edit ? <span key={i}>{edit.renderText(entry, i, b.text)}</span> : <span key={i}>{b.text}</span>);
    } else if (b.type === "mention") {
      run.push(
        <span key={i} className="al-mention">
          @{b.name}
        </span>,
      );
    } else if (b.type === "unclassified") {
      flush(String(i));
      out.push(
        <div key={i} className="al-unclassified">
          {mode === "edit" && <span className="al-unclassified-label">미분류 · {b.reason}</span>}
          <p className="al-text">{edit ? edit.renderText(entry, i, b.text) : b.text}</p>
        </div>,
      );
    } else if (b.type === "image") {
      flush(String(i));
      const url = b.assetId ? assetUrl(b.assetId) : undefined;
      if (!url && omitMissing && mode !== "edit") return;
      out.push(
        url ? (
          <figure key={i} className="al-image">
            {read?.onOpenImage ? (
              <button
                type="button"
                className="al-image-open"
                onClick={(ev) => {
                  ev.stopPropagation();
                  read.onOpenImage!(url);
                }}
                aria-label="이미지 크게 보기"
              >
                <img src={url} alt={b.alt ?? ""} />
              </button>
            ) : (
              <img src={url} alt={b.alt ?? ""} />
            )}
          </figure>
        ) : (
          <div key={i} className="al-image-missing" data-block-index={i}>
            {b.sourceUrl ? "이미지 링크만 있음(파일 미확보)" : "이미지 미확보"}
            {mode === "edit" && b.sourceRef ? ` · ${b.sourceRef}` : ""}
          </div>
        ),
      );
    }
  });
  flush("end");
  return <div className="al-blocks">{out}</div>;
}

function entryWrapperProps(entry: Entry, ctx: Ctx, base: string): HTMLAttributes<HTMLElement> & { "data-entry-id": string } {
  const { edit, read } = ctx;
  const cls = [base];
  if (edit) {
    if (edit.selectedId === entry.id) cls.push("is-selected");
    if (edit.dropIndicator?.id === entry.id) cls.push(`drop-${edit.dropIndicator.pos}`);
  }
  if (read?.highlightId === entry.id) cls.push("is-highlight");
  const extra = edit ? edit.entryProps(entry) : read ? { tabIndex: -1 } : {};
  return {
    ...extra,
    className: cls.join(" "),
    "data-entry-id": entry.id,
    onClick: edit
      ? (ev) => {
          ev.stopPropagation();
          edit.onSelect(entry.id);
        }
      : undefined,
  };
}

function openPerson(ctx: Ctx, idn: Identity | null) {
  return ctx.read?.onOpenPerson && idn ? () => ctx.read!.onOpenPerson!(idn.id) : undefined;
}

/** 확보한 댓글·답글 수(미분류 댓글 영역 포함) */
export function countComments(doc: DocumentData, id: string): number {
  let n = 0;
  for (const c of doc.children[id] ?? []) n += 1 + countComments(doc, c);
  return n;
}

function Post({ ctx, entry }: { ctx: Ctx; entry: Entry }) {
  const { doc, mode, edit } = ctx;
  const idn = identityOf(doc, entry);
  const show = doc.view.show;
  const kids = doc.children[entry.id] ?? [];
  const hidden = !!idn?.hidden;
  const found = countComments(doc, entry.id);
  const shownCount = entry.meta.commentCount;
  const known = reactionKnown(entry.reactions);
  return (
    <article className="al-post">
      <div {...entryWrapperProps(entry, ctx, `al-entry al-post-main${hidden ? " is-hidden" : ""}`)}>
        {hidden && mode !== "edit" ? (
          <p className="al-hidden-placeholder">숨긴 인물의 게시글</p>
        ) : (
          <>
            <header className="al-post-head">
              <Avatar doc={doc} identity={idn} context="post" assetUrl={ctx.assetUrl} onOpen={openPerson(ctx, idn)} />
              <div className="al-post-meta">
                <div className="al-name-row">
                  <Name identity={idn} onOpen={openPerson(ctx, idn)} />
                  {show.description && idn?.description ? <span className="al-desc">{idn.description}</span> : null}
                </div>
                <div className="al-sub">
                  {show.date && entry.time ? <time dateTime={entry.time.local ?? undefined}>{entry.time.raw}</time> : null}
                  {show.readCount && entry.meta.readCount !== undefined ? <span>{entry.meta.readCount} 읽음</span> : null}
                </div>
              </div>
              {edit ? edit.renderTools(entry) : null}
            </header>
            <div className="al-post-body">
              <Blocks blocks={entry.blocks} entry={entry} ctx={ctx} omitMissing={doc.view.missingImages === "omit"} />
            </div>
          </>
        )}
        {show.reactions && (known || shownCount !== undefined) ? (
          <div className="al-counts">
            {known ? <Reactions r={entry.reactions!} /> : null}
            <span className="al-spacer" />
            {shownCount !== undefined ? <span>댓글 {shownCount}</span> : null}
          </div>
        ) : null}
      </div>
      {ctx.actionStrip ? (
        <div className="al-action-strip" role="group" aria-label="보관된 반응과 댓글">
          <button type="button" onClick={() => ctx.read?.onShowReactions?.(entry.id)}>
            <Icon name="smile" size={17} /> 표정 내역
          </button>
          <button
            type="button"
            onClick={(ev) => {
              const root = (ev.currentTarget as HTMLElement).closest(".al-post");
              root?.querySelector(".al-comments")?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          >
            <Icon name="comment" size={17} /> 댓글 {found}
          </button>
        </div>
      ) : null}
      {kids.length ? (
        <section className="al-comments">
          {kids.map((k, i) => {
            const ke = doc.entries[k];
            return ke ? <CommentNode key={k} ctx={ctx} entry={ke} depth={0} prevAuthor={i > 0 ? doc.entries[kids[i - 1]]?.authorId ?? null : null} /> : null;
          })}
        </section>
      ) : null}
      {mode === "read" ? (
        <footer className="al-archive-status">
          보관된 기록 · 댓글 {found}개 확보
          {shownCount !== undefined && shownCount !== found ? ` (표시된 수 ${shownCount})` : ""}
        </footer>
      ) : null}
    </article>
  );
}

function CommentNode({ ctx, entry, depth, prevAuthor }: { ctx: Ctx; entry: Entry; depth: number; prevAuthor: string | null }) {
  const { doc, mode, edit } = ctx;
  const idn = identityOf(doc, entry);
  const hidden = !!idn?.hidden;
  const kids = doc.children[entry.id] ?? [];
  if (hidden && mode !== "edit" && !hasVisibleDescendant(doc, entry.id)) return null;
  const st = docStyle(doc.view);
  const repeat = st.avatar.repeat;
  const grouped = repeat === "group" && !!entry.authorId && entry.authorId === prevAuthor;
  const showAvatar = repeat !== "hidden" && !grouped;
  const replies = kids.length;
  const known = reactionKnown(entry.reactions);
  const bubble = idn?.style?.bubbleColor ? ({ ["--al-bubble" as string]: idn.style.bubbleColor } as CSSProperties) : undefined;
  return (
    <div className={`al-thread depth-${Math.min(depth, 3)}${grouped ? " is-grouped" : ""}`}>
      <div
        {...entryWrapperProps(
          entry,
          ctx,
          `al-entry al-comment${hidden ? " is-hidden" : ""}${entry.kind === "unclassified" ? " is-unclassified" : ""}${mode === "edit" && entry.parentUnknown ? " is-parent-unknown" : ""}`,
        )}
      >
        {hidden && mode !== "edit" ? (
          <p className="al-hidden-placeholder">숨긴 인물의 댓글</p>
        ) : (
          <>
            {showAvatar ? (
              <Avatar doc={doc} identity={idn} context={depth === 0 ? "comment" : "reply"} assetUrl={ctx.assetUrl} onOpen={openPerson(ctx, idn)} />
            ) : repeat === "hidden" ? null : (
              <span className="al-avatar-gap" style={{ width: st.avatar.sizes[depth === 0 ? "comment" : "reply"] }} aria-hidden="true" />
            )}
            <div className="al-comment-main">
              {grouped ? (
                edit ? <div className="al-name-row is-tools-only">{edit.renderTools(entry)}</div> : null
              ) : (
                <div className="al-name-row">
                  <Name identity={idn} onOpen={openPerson(ctx, idn)} />
                  {doc.view.show.description && idn?.description ? <span className="al-desc">{idn.description}</span> : null}
                  {edit ? edit.renderTools(entry) : null}
                </div>
              )}
              <div className="al-comment-body" style={bubble}>
                <Blocks blocks={entry.blocks} entry={entry} ctx={ctx} omitMissing={doc.view.missingImages === "omit"} />
              </div>
              {(doc.view.show.date && entry.time) || (doc.view.show.reactions && known) || (mode === "read" && replies) ? (
                <div className="al-sub">
                  {doc.view.show.date && entry.time ? <time dateTime={entry.time.local ?? undefined}>{entry.time.raw}</time> : null}
                  {doc.view.show.reactions && known ? (
                    ctx.read?.onShowReactions ? (
                      <button
                        type="button"
                        className="al-meta-link"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          ctx.read!.onShowReactions!(entry.id);
                        }}
                      >
                        <Reactions r={entry.reactions!} compact />
                      </button>
                    ) : (
                      <Reactions r={entry.reactions!} compact />
                    )
                  ) : null}
                  {mode === "read" && replies ? <span>답글 {replies}</span> : null}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
      {kids.length ? (
        <div className="al-replies">
          {kids.map((k, i) => {
            const ke = doc.entries[k];
            return ke ? <CommentNode key={k} ctx={ctx} entry={ke} depth={depth + 1} prevAuthor={i > 0 ? doc.entries[kids[i - 1]]?.authorId ?? null : null} /> : null;
          })}
        </div>
      ) : null}
    </div>
  );
}

function MemberCommentCard({ ctx, entry }: { ctx: Ctx; entry: Entry }) {
  const { doc, mode, edit } = ctx;
  const idn = identityOf(doc, entry);
  if (idn?.hidden && mode !== "edit") return null;
  return (
    <article {...entryWrapperProps(entry, ctx, `al-entry al-mc-card${idn?.hidden ? " is-hidden" : ""}`)}>
      <div className="al-name-row">
        <Avatar doc={doc} identity={idn} context="reply" assetUrl={ctx.assetUrl} onOpen={openPerson(ctx, idn)} />
        <Name identity={idn} onOpen={openPerson(ctx, idn)} />
        {edit ? edit.renderTools(entry) : null}
      </div>
      <div className="al-comment-body">
        <Blocks blocks={entry.blocks} entry={entry} ctx={ctx} omitMissing={doc.view.missingImages === "omit"} />
      </div>
      {doc.view.show.excerpt && entry.excerpt?.length ? (
        <blockquote className="al-excerpt">
          <span className="al-excerpt-label">원글 발췌</span>
          <Blocks blocks={entry.excerpt} entry={entry} ctx={{ ...ctx, mode: "export", edit: undefined }} omitMissing={doc.view.missingImages === "omit"} />
        </blockquote>
      ) : null}
      {doc.view.show.date && entry.time ? (
        <div className="al-sub">
          <time>{entry.time.raw}</time>
        </div>
      ) : null}
    </article>
  );
}

export function reactionKnown(r: ReactionSnapshot | undefined): boolean {
  return !!r && (r.status === "value" || r.status === "confirmed-zero");
}

/** 보관 당시의 반응 표시. 실제 서비스 버튼처럼 동작하지 않는다. 확인 못 한 값은 만들지 않는다 */
function Reactions({ r, compact }: { r: ReactionSnapshot; compact?: boolean }) {
  const kinds = r.kinds.filter((k) => k.label).map((k) => (k.count !== null ? `${k.label} ${k.count}` : k.label));
  if (compact)
    return (
      <span className="al-reactions" title={r.evidence}>
        표정 {r.total ?? "?"}
      </span>
    );
  return (
    <span className="al-reactions" title={r.evidence}>
      <Icon name="smile" size={16} /> {r.total ?? "?"}
      {kinds.length ? ` (${kinds.join(", ")})` : ""}
    </span>
  );
}
