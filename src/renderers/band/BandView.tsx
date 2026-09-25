// 밴드형 출력 스킨. 편집 미리보기와 HTML/PNG 내보내기가 같은 컴포넌트를 쓴다.
// 편집 기능(선택·편집·메뉴)은 edit 훅으로만 주입되며 export 모드에서는 전혀 렌더링되지 않는다.
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { ROOT, type ContentBlock, type DocumentData, type Entry, type Identity, type ReactionSnapshot } from "../../domain/types";

export interface BandEditHooks {
  selectedId: string | null;
  onSelect(id: string): void;
  renderText(entry: Entry, blockIndex: number, text: string): ReactNode;
  renderTools(entry: Entry): ReactNode;
  entryProps(entry: Entry): HTMLAttributes<HTMLElement>;
  dropIndicator: { id: string; pos: "before" | "after" } | null;
}

export interface BandViewProps {
  doc: DocumentData;
  assetUrl: (id: string) => string | undefined;
  mode: "edit" | "export";
  edit?: BandEditHooks;
  /** 부분 렌더링(PNG 분할 등)에 쓸 루트 항목 목록. 없으면 전체 */
  rootIds?: string[];
}

const FONT_STACKS: Record<DocumentData["view"]["fontFamily"], string> = {
  system: `"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, -apple-system, "Segoe UI", sans-serif`,
  serif: `"AppleMyungjo", "Batang", "Noto Serif KR", serif`,
  mono: `"D2Coding", "Consolas", ui-monospace, monospace`,
};

export function bandRootStyle(doc: DocumentData): CSSProperties {
  const v = doc.view;
  const s = v.sizes;
  return {
    ["--al-width" as string]: `${v.width}px`,
    ["--al-size-base" as string]: `${s.base}px`,
    ["--al-size-name" as string]: `${s.name}px`,
    ["--al-size-desc" as string]: `${s.desc}px`,
    ["--al-size-body" as string]: `${s.body}px`,
    ["--al-size-comment" as string]: `${s.comment}px`,
    fontFamily: FONT_STACKS[v.fontFamily],
  };
}

export function BandView({ doc, assetUrl, mode, edit, rootIds }: BandViewProps) {
  const roots = rootIds ?? doc.children[ROOT] ?? [];
  return (
    <div className={`al-band al-theme-${doc.view.theme} al-mode-${mode}`} style={bandRootStyle(doc)}>
      {roots.map((id) => {
        const e = doc.entries[id];
        if (!e) return null;
        if (doc.inputFormat === "band-member-comments") return <MemberCommentCard key={id} doc={doc} entry={e} assetUrl={assetUrl} mode={mode} edit={edit} />;
        if (e.kind === "post") return <Post key={id} doc={doc} entry={e} assetUrl={assetUrl} mode={mode} edit={edit} />;
        return <CommentNode key={id} doc={doc} entry={e} depth={0} assetUrl={assetUrl} mode={mode} edit={edit} />;
      })}
    </div>
  );
}

interface NodeProps {
  doc: DocumentData;
  entry: Entry;
  assetUrl: (id: string) => string | undefined;
  mode: "edit" | "export";
  edit?: BandEditHooks;
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

function Avatar({ identity, size, assetUrl }: { identity: Identity | null; size: number; assetUrl: (id: string) => string | undefined }) {
  const url = identity?.avatarAssetId ? assetUrl(identity.avatarAssetId) : undefined;
  const name = identity?.displayName ?? "?";
  if (url) return <img className="al-avatar" src={url} width={size} height={size} alt="" style={{ width: size, height: size }} />;
  const initial = Array.from(name.trim())[0] ?? "?";
  return (
    <span className="al-avatar al-avatar-empty" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {initial}
    </span>
  );
}

function Name({ identity }: { identity: Identity | null }) {
  return (
    <strong className="al-name" style={identity?.color ? { color: identity.color } : undefined}>
      {identity?.displayName || "(작성자 미확정)"}
    </strong>
  );
}

function Blocks({
  blocks,
  entry,
  assetUrl,
  mode,
  edit,
  omitMissing,
}: {
  blocks: ContentBlock[];
  entry: Entry;
  assetUrl: (id: string) => string | undefined;
  mode: "edit" | "export";
  edit?: BandEditHooks;
  omitMissing?: boolean;
}) {
  // 연속된 텍스트/멘션은 한 문단(pre-wrap), 이미지는 블록
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = (k: string) => {
    if (run.length) out.push(<p className="al-text" key={`t${k}`}>{run}</p>);
    run = [];
  };
  blocks.forEach((b, i) => {
    if (b.type === "text") {
      run.push(mode === "edit" && edit ? <span key={i}>{edit.renderText(entry, i, b.text)}</span> : <span key={i}>{b.text}</span>);
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
          <p className="al-text">{mode === "edit" && edit ? edit.renderText(entry, i, b.text) : b.text}</p>
        </div>,
      );
    } else if (b.type === "image") {
      flush(String(i));
      const url = b.assetId ? assetUrl(b.assetId) : undefined;
      if (!url && omitMissing && mode === "export") return;
      out.push(
        url ? (
          <figure key={i} className="al-image">
            <img src={url} alt={b.alt ?? ""} />
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

function entryWrapperProps(entry: Entry, mode: "edit" | "export", edit: BandEditHooks | undefined, base: string): HTMLAttributes<HTMLElement> & { "data-entry-id": string } {
  const cls = [base];
  if (mode === "edit" && edit) {
    if (edit.selectedId === entry.id) cls.push("is-selected");
    if (edit.dropIndicator?.id === entry.id) cls.push(`drop-${edit.dropIndicator.pos}`);
  }
  const extra = mode === "edit" && edit ? edit.entryProps(entry) : {};
  return {
    ...extra,
    className: cls.join(" "),
    "data-entry-id": entry.id,
    onClick:
      mode === "edit" && edit
        ? (ev) => {
            ev.stopPropagation();
            edit.onSelect(entry.id);
          }
        : undefined,
  };
}

function Post({ doc, entry, assetUrl, mode, edit }: NodeProps) {
  const idn = identityOf(doc, entry);
  const show = doc.view.show;
  const kids = doc.children[entry.id] ?? [];
  const hidden = !!idn?.hidden;
  return (
    <article className="al-post">
      <div {...entryWrapperProps(entry, mode, edit, `al-entry al-post-main${hidden ? " is-hidden" : ""}`)}>
        {hidden && mode === "export" ? (
          <p className="al-hidden-placeholder">숨긴 인물의 게시글</p>
        ) : (
          <>
            <header className="al-post-head">
              <Avatar identity={idn} size={40} assetUrl={assetUrl} />
              <div className="al-post-meta">
                <div className="al-name-row">
                  <Name identity={idn} />
                  {show.description && idn?.description ? <span className="al-desc">{idn.description}</span> : null}
                </div>
                <div className="al-sub">
                  {show.date && entry.time ? <time>{entry.time.raw}</time> : null}
                  {show.readCount && entry.meta.readCount !== undefined ? <span>{entry.meta.readCount} 읽음</span> : null}
                </div>
              </div>
              {mode === "edit" && edit ? edit.renderTools(entry) : null}
            </header>
            <div className="al-post-body">
              <Blocks blocks={entry.blocks} entry={entry} assetUrl={assetUrl} mode={mode} edit={edit} omitMissing={doc.view.missingImages === "omit"} />
            </div>
          </>
        )}
        {show.reactions && (reactionKnown(entry.reactions) || entry.meta.commentCount !== undefined) ? (
          <div className="al-counts">
            {reactionKnown(entry.reactions) ? <Reactions r={entry.reactions!} /> : null}
            {entry.meta.commentCount !== undefined ? <span>댓글 {entry.meta.commentCount}</span> : null}
          </div>
        ) : null}
      </div>
      {kids.length ? (
        <section className="al-comments">
          {kids.map((k) => {
            const ke = doc.entries[k];
            return ke ? <CommentNode key={k} doc={doc} entry={ke} depth={0} assetUrl={assetUrl} mode={mode} edit={edit} /> : null;
          })}
        </section>
      ) : null}
    </article>
  );
}

function CommentNode({ doc, entry, depth, assetUrl, mode, edit }: NodeProps & { depth: number }) {
  const idn = identityOf(doc, entry);
  const hidden = !!idn?.hidden;
  const kids = doc.children[entry.id] ?? [];
  if (hidden && mode === "export" && !hasVisibleDescendant(doc, entry.id)) return null;
  const size = depth === 0 ? 34 : 24;
  return (
    <div className={`al-thread depth-${Math.min(depth, 3)}`}>
      <div {...entryWrapperProps(entry, mode, edit, `al-entry al-comment${hidden ? " is-hidden" : ""}${entry.kind === "unclassified" ? " is-unclassified" : ""}${mode === "edit" && entry.parentUnknown ? " is-parent-unknown" : ""}`)}>
        {hidden && mode === "export" ? (
          <p className="al-hidden-placeholder">숨긴 인물의 댓글</p>
        ) : (
          <>
            <Avatar identity={idn} size={size} assetUrl={assetUrl} />
            <div className="al-comment-main">
              <div className="al-name-row">
                <Name identity={idn} />
                {doc.view.show.description && idn?.description ? <span className="al-desc">{idn.description}</span> : null}
                {mode === "edit" && edit ? edit.renderTools(entry) : null}
              </div>
              <div className="al-comment-body">
                <Blocks blocks={entry.blocks} entry={entry} assetUrl={assetUrl} mode={mode} edit={edit} omitMissing={doc.view.missingImages === "omit"} />
              </div>
              {(doc.view.show.date && entry.time) || (doc.view.show.reactions && reactionKnown(entry.reactions)) ? (
                <div className="al-sub">
                  {doc.view.show.date && entry.time ? <time>{entry.time.raw}</time> : null}
                  {doc.view.show.reactions && reactionKnown(entry.reactions) ? <Reactions r={entry.reactions!} /> : null}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
      {kids.length ? (
        <div className="al-replies">
          {kids.map((k) => {
            const ke = doc.entries[k];
            return ke ? <CommentNode key={k} doc={doc} entry={ke} depth={depth + 1} assetUrl={assetUrl} mode={mode} edit={edit} /> : null;
          })}
        </div>
      ) : null}
    </div>
  );
}

function MemberCommentCard({ doc, entry, assetUrl, mode, edit }: NodeProps) {
  const idn = identityOf(doc, entry);
  if (idn?.hidden && mode === "export") return null;
  return (
    <article {...entryWrapperProps(entry, mode, edit, `al-entry al-mc-card${idn?.hidden ? " is-hidden" : ""}`)}>
      <div className="al-name-row">
        <Avatar identity={idn} size={24} assetUrl={assetUrl} />
        <Name identity={idn} />
        {mode === "edit" && edit ? edit.renderTools(entry) : null}
      </div>
      <div className="al-comment-body">
        <Blocks blocks={entry.blocks} entry={entry} assetUrl={assetUrl} mode={mode} edit={edit} omitMissing={doc.view.missingImages === "omit"} />
      </div>
      {doc.view.show.excerpt && entry.excerpt?.length ? (
        <blockquote className="al-excerpt">
          <span className="al-excerpt-label">원글 발췌</span>
          <Blocks blocks={entry.excerpt} entry={entry} assetUrl={assetUrl} mode="export" omitMissing={doc.view.missingImages === "omit"} />
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

function reactionKnown(r: ReactionSnapshot | undefined): boolean {
  return !!r && (r.status === "value" || r.status === "confirmed-zero");
}

/** 보관 당시의 반응 표시. 실제 서비스 버튼처럼 동작하지 않는다 */
function Reactions({ r }: { r: ReactionSnapshot }) {
  const kinds = r.kinds.filter((k) => k.label).map((k) => (k.count !== null ? `${k.label} ${k.count}` : k.label));
  return (
    <span className="al-reactions" title={r.evidence}>
      표정 {r.total ?? "?"}
      {kinds.length ? ` (${kinds.join(", ")})` : ""}
    </span>
  );
}
