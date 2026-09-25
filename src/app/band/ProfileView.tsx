// 보관한 인물 프로필 보기(프로필 명세 7절). 구조 자료(band-profile-data)가 있으면 그것을, 없으면 보관 당시 화면(스냅숏)을 보여 준다.
// 프로필 자체의 표정·댓글과 스토리의 표정·댓글을 섞지 않고, 화면에 수가 없던 곳은 0이 아니라 '확인 못 함'으로 쓴다.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { DocumentData, SourceImport } from "../../domain/types";
import { BAND_PROFILE_SOURCE_KIND, isBandProfileRecord, type BandImageRef, type BandProfileComment, type BandProfileRecord } from "../../importers/band/profile";
import { blocksToPlainText } from "../../importers/band/html";
import { COMMENT_STATE_TEXT, PHOTO_STATE_TEXT, STORY_STATE_TEXT, shownText } from "../../exporters/profileHtml";
import { listSources } from "../../storage/repo";
import { downloadBlob } from "../download";

export interface ProfileEntry {
  id: string;
  record: BandProfileRecord | null;
  data: SourceImport | null;
  snapshot: SourceImport | null;
  name: string;
}

const SNAPSHOT = "band-profile-snapshot";

/** 프로젝트의 프로필(구조 자료 + 보관 화면). 같은 주소·같은 보관 시각의 둘을 한 인물로 묶는다 */
export function useProfiles(projectId: string | null, refreshKey?: unknown): ProfileEntry[] | null {
  const [list, setList] = useState<ProfileEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (!projectId) {
      setList([]);
      return;
    }
    void (async () => {
      const src = await listSources(projectId);
      const datas = src.filter((s) => String(s.kind ?? "") === BAND_PROFILE_SOURCE_KIND);
      const snaps = src.filter((s) => String(s.kind ?? "") === SNAPSHOT);
      const used = new Set<string>();
      const out: ProfileEntry[] = [];
      for (const d of datas) {
        let record: BandProfileRecord | null = null;
        try {
          const j = JSON.parse(await d.blob.text());
          if (isBandProfileRecord(j)) record = j;
        } catch {
          /* 읽지 못한 자료는 아래에서 이름만 */
        }
        const snap = snaps.find((s) => !used.has(s.id) && s.importedAt === d.importedAt && (s.sourceUrl === d.sourceUrl || s.fileName.replace(/_보관화면\.html$/, "") === d.fileName.replace(/\.json$/, "")));
        if (snap) used.add(snap.id);
        out.push({ id: d.id, record, data: d, snapshot: snap ?? null, name: record?.name ?? d.fileName.replace(/^프로필_/, "").replace(/\.json$/, "") });
      }
      for (const s of snaps) if (!used.has(s.id)) out.push({ id: s.id, record: null, data: null, snapshot: s, name: s.fileName.replace(/^프로필_/, "").replace(/(_보관화면)?\.html$/, "").replace(/_/g, " ") });
      if (alive) setList(out);
    })();
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey]);
  return list;
}

type Tab = "profile" | "photos" | "stories" | "posts" | "comments" | "snapshot";

export function ProfileView({
  entry,
  assetUrl,
  assetIdBySha,
  docs,
  onOpenDoc,
}: {
  entry: ProfileEntry;
  assetUrl(id: string): string | undefined;
  assetIdBySha(sha: string): string | undefined;
  docs: DocumentData[];
  onOpenDoc?(docId: string): void;
}) {
  const r = entry.record;
  const [tab, setTab] = useState<Tab>(r ? "profile" : "snapshot");
  const [snapHtml, setSnapHtml] = useState<string | null>(null);
  useEffect(() => setTab(r ? "profile" : "snapshot"), [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setSnapHtml(null);
    if (tab === "snapshot" && entry.snapshot) void entry.snapshot.blob.text().then((t) => alive && setSnapHtml(t));
    return () => {
      alive = false;
    };
  }, [tab, entry.snapshot]);

  // 작성글·작성댓글: 지금 프로젝트에 보관한 자료 중 이름이 같은 작성자(인물 식별자로 확인한 것이 아님)
  const mine = useMemo(() => {
    const name = r?.name ?? entry.name;
    const posts: { docId: string; entryId: string; text: string; time: string; title: string }[] = [];
    const comments: typeof posts = [];
    if (!name) return { posts, comments };
    for (const d of docs)
      for (const e of Object.values(d.entries)) {
        const who = e.authorId ? d.identities[e.authorId]?.originalName : null;
        if (who !== name) continue;
        const item = { docId: d.id, entryId: e.id, text: blocksToPlainText(e.blocks).slice(0, 200), time: e.time?.raw ?? "", title: d.title };
        (e.kind === "post" ? posts : comments).push(item);
      }
    return { posts, comments };
  }, [docs, r, entry.name]);

  const img = (i: BandImageRef | null, cls: string, alt = "") => {
    if (!i) return null;
    const id = i.sha256 ? assetIdBySha(i.sha256) : undefined;
    const u = id ? assetUrl(id) : undefined;
    if (u) return <img className={cls} src={u} alt={alt} />;
    return /^https?:/.test(i.src) ? (
      <a className="pv-missing" href={i.src} target="_blank" rel="noreferrer">
        사진(온라인 원본 링크, 미확보)
      </a>
    ) : (
      <span className="pv-missing">사진 미확보</span>
    );
  };
  const tabs: [Tab, string][] = [
    ...(r
      ? ([
          ["profile", "프로필"],
          ["photos", "사진 이력"],
          ["stories", `스토리 ${r.stories.items.length}`],
        ] as [Tab, string][])
      : []),
    ["posts", `작성글 ${mine.posts.length}`],
    ["comments", `작성댓글 ${mine.comments.length}`],
    ...(entry.snapshot ? ([["snapshot", "보관 당시 화면"]] as [Tab, string][]) : []),
  ];

  const commentTree = (c: BandProfileComment, all: BandProfileComment[]): ReactElement => {
    const kids = all.filter((x) => x.parentKey === c.key);
    return (
      <li key={c.key} className="pv-comment">
        <div className="pv-c-head">
          {img(c.authorAvatar, "pv-c-face")}
          <b>{c.author ?? "이름 확인 못 함"}</b> <time>{c.timeText ?? ""}</time>
        </div>
        <div className="pv-c-body">
          {c.text}
          {c.images.map((x, i) => (
            <span key={i}>{img(x, "pv-img")}</span>
          ))}
        </div>
        {kids.length ? <ul className="pv-replies">{kids.map((k) => commentTree(k, all))}</ul> : null}
      </li>
    );
  };

  return (
    <article className="profile-view" aria-label={`${entry.name} 프로필`}>
      {r?.cover ? <div className="pv-cover">{img(r.cover, "pv-cover-img")}</div> : null}
      <header className="pv-head">
        {r ? img(r.avatar, "pv-face", "프로필 사진") : null}
        <div>
          <h2 className="pv-name">{r?.name ?? entry.name}</h2>
          {r?.description ? <p className="pv-desc">{r.description}</p> : null}
          <p className="small muted">
            보관 {new Date((r?.observedAt ?? entry.data?.importedAt ?? entry.snapshot?.importedAt) || Date.now()).toLocaleString()}
            {r?.identity === "unconfirmed" ? <span className="pv-warn"> · 원본 인물 연결 미확인</span> : null}
            {r?.profileUrl ? (
              <>
                {" · "}
                <a href={r.profileUrl} target="_blank" rel="noreferrer">
                  밴드에서 열기 ↗
                </a>
              </>
            ) : r?.sourceUrl ? (
              <>
                {" · "}
                <a href={r.sourceUrl} target="_blank" rel="noreferrer" title="팝업은 주소로 다시 열리지 않아 인물을 다시 골라야 할 수 있습니다">
                  원래 화면 열기 ↗
                </a>
              </>
            ) : null}
          </p>
        </div>
      </header>
      <nav className="tabs pv-tabs" role="tablist" aria-label="프로필 자료">
        {tabs.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="pv-body">
        {tab === "profile" && r ? (
          <>
            <dl className="pv-dl">
              {r.info ? (
                <>
                  <dt>추가 소개</dt>
                  <dd>{r.info}</dd>
                </>
              ) : null}
              {r.joinInfo ? (
                <>
                  <dt>가입</dt>
                  <dd>{r.joinInfo}</dd>
                </>
              ) : null}
              <dt>프로필 표정</dt>
              <dd>{shownText(r.reactionsShown)}</dd>
              <dt>프로필 댓글</dt>
              <dd>{shownText(r.commentsShown)}</dd>
              {r.storyCountShown !== null ? (
                <>
                  <dt>표시된 스토리 수</dt>
                  <dd>{r.storyCountShown}</dd>
                </>
              ) : null}
            </dl>
            {r.history?.length ? (
              <details className="small">
                <summary>앞선 관측 {r.history.length}개</summary>
                <ul>
                  {r.history.map((h, i) => (
                    <li key={i}>
                      {h.observedAt ? new Date(h.observedAt).toLocaleString() : ""}: {h.name ?? ""}
                      {h.description ? ` · ${h.description}` : ""} · 표정 {shownText(h.reactionsShown)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {r.notes.map((n) => (
              <p key={n} className="small muted">
                {n}
              </p>
            ))}
          </>
        ) : null}
        {tab === "photos" && r ? <p className="muted">{PHOTO_STATE_TEXT[r.photoHistory.state] || `사진 ${r.photoHistory.items.length}장`}</p> : null}
        {tab === "stories" && r ? (
          <>
            {STORY_STATE_TEXT[r.stories.state] ? (
              <p className="muted">
                {STORY_STATE_TEXT[r.stories.state]}
                {r.storyCountShown ? `(표시 ${r.storyCountShown}개)` : ""}
              </p>
            ) : null}
            {r.stories.items.map((s) => {
              const top = s.comments.filter((c) => !c.parentKey || !s.comments.some((x) => x.key === c.parentKey));
              return (
                <section key={s.key} className="pv-story">
                  <header className="small muted">
                    {s.timeText ?? "시각 확인 못 함"}
                    {s.textSource === "list" ? " · 목록 글(전문인지 확인 못 함)" : ""}
                  </header>
                  <p className="pv-story-text">{s.text}</p>
                  {s.images.length ? (
                    <div className="pv-imgs">
                      {s.images.map((x, i) => (
                        <span key={i}>{img(x, "pv-img")}</span>
                      ))}
                    </div>
                  ) : null}
                  <p className="small muted">
                    이 스토리의 표정 {shownText(s.reactionsShown)} · 댓글 {shownText(s.commentsShown)}
                    {COMMENT_STATE_TEXT[s.commentsState] ? <span className={s.commentsState === "none" ? "" : "pv-warn"}> · {COMMENT_STATE_TEXT[s.commentsState]}</span> : null}
                  </p>
                  {top.length ? <ul className="pv-comments">{top.map((c) => commentTree(c, s.comments))}</ul> : null}
                </section>
              );
            })}
          </>
        ) : null}
        {tab === "posts" || tab === "comments" ? (
          <>
            <p className="small muted">지금 프로젝트에 보관한 자료 중 이름이 같은 작성자의 {tab === "posts" ? "글" : "댓글"}입니다(인물 식별자로 확인한 목록이 아니며, 이 인물의 전체 활동이 아님).</p>
            <ul className="pv-list">
              {(tab === "posts" ? mine.posts : mine.comments).map((it) => (
                <li key={`${it.docId}:${it.entryId}`}>
                  <button type="button" className="ui-link" onClick={() => onOpenDoc?.(it.docId)}>
                    {it.text || "(내용 없음)"}
                  </button>
                  <small className="muted">
                    {" "}
                    {it.time} · {it.title}
                  </small>
                </li>
              ))}
            </ul>
            {!(tab === "posts" ? mine.posts : mine.comments).length ? <p className="muted">보관한 자료가 없습니다(수집 안 함).</p> : null}
          </>
        ) : null}
        {tab === "snapshot" && entry.snapshot ? (
          <>
            <p className="small muted">
              보관 당시 보이던 모습 그대로입니다(누르는 기능은 동작하지 않음).{" "}
              <button type="button" className="ui-link" onClick={() => downloadBlob(entry.snapshot!.blob, entry.snapshot!.fileName)}>
                받기
              </button>
            </p>
            {snapHtml === null ? <p className="muted">불러오는 중…</p> : <iframe className="profile-main-frame" title={`${entry.name} 보관 당시 화면`} sandbox="" srcDoc={snapHtml} />}
          </>
        ) : null}
      </div>
    </article>
  );
}

/** 프로필이 여럿이면 이름 목록 + 선택한 프로필 */
export function ProfilePanel({
  profiles,
  assetUrl,
  assetIdBySha,
  docs,
  onOpenDoc,
  initialId,
}: {
  profiles: ProfileEntry[];
  assetUrl(id: string): string | undefined;
  assetIdBySha(sha: string): string | undefined;
  docs: DocumentData[];
  onOpenDoc?(docId: string): void;
  initialId?: string | null;
}) {
  const [sel, setSel] = useState<string | null>(initialId ?? null);
  const cur = profiles.find((p) => p.id === sel) ?? profiles[0];
  if (!cur) return null;
  return (
    <section className="profile-panel" aria-label="보관한 인물 프로필">
      {profiles.length > 1 ? (
        <nav className="profile-main-tabs" aria-label="인물">
          {profiles.map((p) => (
            <button key={p.id} type="button" aria-pressed={p === cur} className={p === cur ? "is-on" : ""} onClick={() => setSel(p.id)}>
              {p.name}
              {p.record?.identity === "unconfirmed" ? " (연결 미확인)" : ""}
            </button>
          ))}
        </nav>
      ) : null}
      <ProfileView entry={cur} assetUrl={assetUrl} assetIdBySha={assetIdBySha} docs={docs} onOpenDoc={onOpenDoc} />
    </section>
  );
}
