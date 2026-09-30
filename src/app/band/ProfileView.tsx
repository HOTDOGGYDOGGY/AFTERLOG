// 보관한 인물 프로필 보기(프로필 명세 7절). 구조 자료(band-profile-data)가 있으면 그것을, 없으면 보관 당시 화면(스냅숏)을 보여 준다.
// 프로필 자체의 표정·댓글과 스토리의 표정·댓글을 섞지 않고, 화면에 수가 없던 곳은 0이 아니라 '확인 못 함'으로 쓴다.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { DocumentData, SourceImport } from "../../domain/types";
import { BAND_PROFILE_SOURCE_KIND, isBandProfileRecord, type BandImageRef, type BandProfileComment, type BandProfileRecord } from "../../importers/band/profile";
import { blocksToPlainText } from "../../importers/band/html";
import { COMMENT_STATE_TEXT, shownText } from "../../exporters/profileHtml";
import { memberPhotosStatus, photoHistoryStatus, storyStatus, type SectionStatus } from "../../importers/band/profile";
import { listSources } from "../../storage/repo";
import { downloadBlob } from "../download";
import { Lightbox, type LightboxItem } from "./Lightbox";

export interface ProfileEntry {
  id: string;
  record: BandProfileRecord | null;
  data: SourceImport | null;
  snapshot: SourceImport | null;
  /** 원문만 보관한 화면(해석 못 한 레이어) */
  raws: SourceImport[];
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
      const rawSrc = src.filter((s) => String(s.kind ?? "") === "band-profile-raw");
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
        const raws = rawSrc.filter((x) => record?.rawArchives?.some((r) => r.fileName === x.fileName) && (!x.sourceUrl || !d.sourceUrl || x.sourceUrl === d.sourceUrl));
        out.push({ id: d.id, record, data: d, snapshot: snap ?? null, raws, name: record?.name ?? d.fileName.replace(/^프로필_/, "").replace(/\.json$/, "") });
      }
      for (const s of snaps) if (!used.has(s.id)) out.push({ id: s.id, record: null, data: null, snapshot: s, raws: [], name: s.fileName.replace(/^프로필_/, "").replace(/(_보관화면)?\.html$/, "").replace(/_/g, " ") });
      if (alive) setList(out);
    })();
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey]);
  return list;
}

type Tab = "profile" | "photos" | "stories" | "memberPhotos" | "posts" | "comments" | "snapshot" | "raw";

const HERO_KEY = "afterlog.profile.heroCollapsed";
const readHero = () => {
  try {
    return localStorage.getItem(HERO_KEY) === "1";
  } catch {
    return false;
  }
};
const writeHero = (v: boolean) => {
  try {
    localStorage.setItem(HERO_KEY, v ? "1" : "0");
  } catch {
    /* 저장 못 해도 동작 */
  }
};

/** 상태 표식: 색만으로 구분하지 않도록 글자 표식을 함께 쓴다 */
export const TONE_MARK: Record<SectionStatus["tone"], string> = { ok: "확보", muted: "참고", warn: "확인 필요" };

/** 이름 첫 글자(사진을 확보하지 못했을 때 자리) */
export const initialOf = (name: string | null | undefined) => (name ?? "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?";

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
  const [rawSel, setRawSel] = useState(0);
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [heroCollapsed, setHeroCollapsed] = useState(readHero);
  const [lb, setLb] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  useEffect(() => {
    let alive = true;
    setRawHtml(null);
    const cur = entry.raws[Math.min(rawSel, entry.raws.length - 1)];
    if (tab === "raw" && cur) void cur.blob.text().then((t) => alive && setRawHtml(t));
    return () => {
      alive = false;
    };
  }, [tab, rawSel, entry.raws]);
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

  const urlOf = (i: BandImageRef | null | undefined) => {
    if (!i?.sha256) return undefined;
    const id = assetIdBySha(i.sha256);
    return id ? assetUrl(id) : undefined;
  };
  const online = (i: BandImageRef) => (/^https?:/.test(i.src) ? i.src : undefined);
  const openOne = (u: string, caption: string, i?: BandImageRef | null) => setLb({ items: [{ url: u, caption, links: i && online(i) ? [{ label: "온라인 주소 ↗", href: online(i) }] : [] }], index: 0 });
  const missing = (i: BandImageRef, label = "사진") =>
    online(i) ? (
      <a className="pv-missing" href={online(i)} target="_blank" rel="noreferrer">
        {label} 미확보 · 온라인 원본 링크
      </a>
    ) : (
      <span className="pv-missing">{label} 미확보</span>
    );
  /** 본문 속 사진: 누르면 크게(원본 비율) */
  const img = (i: BandImageRef | null, cls: string, caption: string) => {
    if (!i) return null;
    const u = urlOf(i);
    if (!u) return missing(i);
    return (
      <button type="button" className="pv-img-btn" onClick={() => openOne(u, caption, i)} aria-label={`${caption} 크게 보기`}>
        <img className={cls} src={u} alt="" />
      </button>
    );
  };
  const name = r?.name ?? entry.name;
  const avatarUrl = urlOf(r?.avatar);
  const coverUrl = urlOf(r?.cover);
  const photos = r?.memberPhotos?.state === "collected" ? r.memberPhotos.items : [];
  const stStory = r ? storyStatus(r) : null;
  const stPhotos = r ? memberPhotosStatus(r) : null;
  const stHistory = r ? photoHistoryStatus(r) : null;

  const tabs: [Tab, string][] = [
    ...(r
      ? ([
          ["profile", "프로필"],
          ["stories", `스토리 ${r.stories.items.length}`],
          ["memberPhotos", `사진첩${photos.length ? ` ${photos.length}` : ""}`],
          ["photos", "사진 이력"],
        ] as [Tab, string][])
      : []),
    ["posts", `작성글 ${mine.posts.length}`],
    ["comments", `작성댓글 ${mine.comments.length}`],
    ...(entry.raws.length ? ([["raw", `원문 보관 ${entry.raws.length}`]] as [Tab, string][]) : []),
    ...(entry.snapshot ? ([["snapshot", "보관 당시 화면"]] as [Tab, string][]) : []),
  ];

  const commentTree = (c: BandProfileComment, all: BandProfileComment[]): ReactElement => {
    const kids = all.filter((x) => x.parentKey === c.key);
    const face = urlOf(c.authorAvatar);
    return (
      <li key={c.key} className="pv-comment">
        <div className="pv-c-head">
          {face ? <img className="pv-c-face" src={face} alt="" /> : <span className="pv-c-face pv-initial" aria-hidden="true">{initialOf(c.author)}</span>}
          <b>{c.author ?? "이름 확인 못 함"}</b> <time>{c.timeText ?? ""}</time>
        </div>
        <div className="pv-c-body">
          {c.text}
          {c.images.map((x, i) => (
            <span key={i}>{img(x, "pv-img", `${c.author ?? ""} 댓글 사진`)}</span>
          ))}
        </div>
        {kids.length ? <ul className="pv-replies">{kids.map((k) => commentTree(k, all))}</ul> : null}
      </li>
    );
  };

  const albumItems: LightboxItem[] = photos.flatMap((p, i) => {
    const full = urlOf(p.image);
    const small = urlOf(p.thumb);
    const u = full ?? small;
    return u ? [{ url: u, caption: `${name} 사진첩 ${i + 1}번째`, note: full ? "목록에 보이던 크기(원본 크기인지 확인 못 함)" : "축소본", links: online(p.image) ? [{ label: "온라인 주소 ↗", href: online(p.image) }] : [] }] : [];
  });

  const chip = (label: string, st: SectionStatus, t: Tab) => (
    <button type="button" className={`pv-chip is-${st.tone}`} onClick={() => setTab(t)} title={st.text}>
      <b>{label}</b>
      <span className="pv-chip-mark">{TONE_MARK[st.tone]}</span>
      <span className="pv-chip-text">{st.text}</span>
    </button>
  );

  return (
    <article className="profile-view" aria-label={`${entry.name} 프로필`}>
      <header className={`pv-hero${heroCollapsed ? " is-collapsed" : ""}`}>
        {!heroCollapsed ? (
          <div className={`pv-cover${coverUrl ? "" : " is-empty"}`}>
            {coverUrl ? (
              <button type="button" className="pv-cover-btn" onClick={() => openOne(coverUrl, `${name} 커버 사진`, r?.cover)} aria-label="커버 사진 크게 보기">
                <img className="pv-cover-img" src={coverUrl} alt="" />
              </button>
            ) : (
              <span className="pv-cover-empty">{r?.cover ? "커버 사진 미확보" : r ? "커버 사진 없음(확인된 것 없음)" : ""}</span>
            )}
          </div>
        ) : null}
        <div className="pv-head">
          {avatarUrl ? (
            <button type="button" className="pv-face-btn" onClick={() => openOne(avatarUrl, `${name} 프로필 사진(보관 시점)`, r?.avatar)} aria-label="프로필 사진 크게 보기">
              <img className="pv-face" src={avatarUrl} alt="프로필 사진" />
            </button>
          ) : (
            <span className="pv-face pv-initial" role="img" aria-label={r?.avatar ? "프로필 사진 미확보" : "프로필 사진 없음"} title={r?.avatar ? "프로필 사진 미확보" : "프로필 사진 없음"}>
              {initialOf(name)}
            </span>
          )}
          <div className="pv-who">
            <h2 className="pv-name">{name}</h2>
            {r?.description ? <p className="pv-desc">{r.description}</p> : null}
            <p className="pv-meta">
              <span>보관 {new Date((r?.observedAt ?? entry.data?.importedAt ?? entry.snapshot?.importedAt) || Date.now()).toLocaleString()}</span>
              {r?.identity === "unconfirmed" ? <span className="pv-badge is-warn">원본 인물 연결 미확인</span> : null}
              {r && !r.avatar ? null : r && !avatarUrl ? <span className="pv-badge">프로필 사진 미확보</span> : null}
              {r?.profileUrl ? (
                <a href={r.profileUrl} target="_blank" rel="noreferrer">
                  밴드에서 열기 ↗
                </a>
              ) : r?.sourceUrl ? (
                <a href={r.sourceUrl} target="_blank" rel="noreferrer" title="팝업은 주소로 다시 열리지 않아 인물을 다시 골라야 할 수 있습니다">
                  원래 화면 열기 ↗
                </a>
              ) : null}
            </p>
          </div>
          {r ? (
            <button
              type="button"
              className="ui-btn ui-btn-quiet ui-btn-small pv-hero-toggle"
              aria-expanded={!heroCollapsed}
              onClick={() => {
                setHeroCollapsed(!heroCollapsed);
                writeHero(!heroCollapsed);
              }}
            >
              {heroCollapsed ? "커버 펼치기" : "커버 접기"}
            </button>
          ) : null}
        </div>
        {r && stStory && stPhotos && stHistory ? (
          <div className="pv-chips" aria-label="수집 상태">
            {chip("스토리", stStory, "stories")}
            {chip("사진첩", stPhotos, "memberPhotos")}
            {chip("사진 이력", stHistory, "photos")}
          </div>
        ) : null}
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
            <p className="small muted">프로필 자체의 표정·댓글 수입니다. 스토리·사진의 표정·댓글과 섞지 않습니다.</p>
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
        {tab === "photos" && r ? (
          <>
            <StatusLine st={photoHistoryStatus(r)} />
            {r.photoHistory.state === "collected" ? (
              <div className="pv-grid">
                {r.photoHistory.items.map((p, i) => (
                  <figure key={i} className="pv-grid-item">
                    {img(p.image, "", `${name} 사진 이력 ${i + 1}`)}
                    {p.timeText ? <figcaption className="small muted">{p.timeText}</figcaption> : null}
                  </figure>
                ))}
              </div>
            ) : (
              <p className="small muted">
                현재 프로필 사진만 저장했습니다. 이전 프로필 사진은 밴드에서 사진을 눌렀을 때 뜨는 화면의 구조를 아직 확인하지 못해 따로 읽지 않습니다.
                {entry.raws.length ? " 그 화면을 원문 그대로 보관한 것은 '원문 보관' 탭에서 봅니다." : " 수집 확장의 '직접 열며 수집' 중 그 화면을 열면 원문 그대로 보관됩니다."}
              </p>
            )}
          </>
        ) : null}
        {tab === "stories" && r ? (
          <>
            <StatusLine st={storyStatus(r)} />
            {r.stories.items.map((s) => {
              const top = s.comments.filter((c) => !c.parentKey || !s.comments.some((x) => x.key === c.parentKey));
              return (
                <section key={s.key} className="pv-story">
                  <header className="pv-story-head">
                    {avatarUrl ? <img className="pv-c-face" src={avatarUrl} alt="" /> : <span className="pv-c-face pv-initial" aria-hidden="true">{initialOf(name)}</span>}
                    <div>
                      <b>{name}</b>
                      <div className="small muted">
                        {s.timeText ?? "시각 확인 못 함"}
                        {s.textSource === "list" ? <span className="pv-badge">목록 글 · 전문인지 확인 못 함</span> : null}
                      </div>
                    </div>
                  </header>
                  <p className="pv-story-text">{s.text}</p>
                  {s.images.length ? (
                    <div className={`pv-imgs n-${Math.min(s.images.length, 3)}`}>
                      {s.images.map((x, i) => (
                        <span key={i}>{img(x, "pv-img", `${name} 스토리 사진 ${i + 1}`)}</span>
                      ))}
                    </div>
                  ) : null}
                  {s.links.length ? (
                    <ul className="pv-links small">
                      {s.links.map((l) => (
                        <li key={l}>
                          <a href={l} target="_blank" rel="noreferrer">
                            {l}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="pv-story-counts small muted">
                    이 스토리의 표정 {shownText(s.reactionsShown)} · 댓글 {shownText(s.commentsShown)}
                    {COMMENT_STATE_TEXT[s.commentsState] ? <span className={s.commentsState === "none" ? "pv-badge" : "pv-badge is-warn"}>{COMMENT_STATE_TEXT[s.commentsState]}</span> : null}
                  </p>
                  {top.length ? <ul className="pv-comments">{top.map((c) => commentTree(c, s.comments))}</ul> : null}
                </section>
              );
            })}
          </>
        ) : null}
        {tab === "memberPhotos" && r ? (
          <>
            <StatusLine st={memberPhotosStatus(r)} />
            {photos.length ? (
              <>
                <p className="small muted">이 인물 화면 '사진' 탭에 있던 사진입니다(프로필 사진 이력과 다른 범주). 누르면 원래 비율로 크게 봅니다.</p>
                <div className="pv-album">
                  {photos.map((p, i) => {
                    const full = urlOf(p.image);
                    const small = urlOf(p.thumb);
                    const u = full ?? small;
                    const at = albumItems.findIndex((x) => x.url === u);
                    return u ? (
                      <button key={i} type="button" className="pv-album-item" onClick={() => setLb({ items: albumItems, index: Math.max(0, at) })} aria-label={`사진첩 ${i + 1}번째 크게 보기`}>
                        <img src={u} alt="" loading="lazy" />
                        {!full ? <small>축소본</small> : null}
                      </button>
                    ) : (
                      <span key={i} className="pv-album-item is-missing">
                        {missing(p.image)}
                      </span>
                    );
                  })}
                </div>
              </>
            ) : null}
          </>
        ) : null}
        {tab === "posts" || tab === "comments" ? (
          <>
            <p className="small muted">지금 프로젝트에 보관한 자료 중 이름이 같은 작성자의 {tab === "posts" ? "글" : "댓글"}입니다(인물 식별자로 확인한 목록이 아니며, 이 인물의 전체 활동이 아님).</p>
            <ul className="pv-list">
              {(tab === "posts" ? mine.posts : mine.comments).map((it) => (
                <li key={`${it.docId}:${it.entryId}`}>
                  <button type="button" className="pv-row" onClick={() => onOpenDoc?.(it.docId)}>
                    <span className="pv-row-text">{it.text || "(내용 없음)"}</span>
                    <small className="muted">
                      {it.title}
                      {it.time ? ` · ${it.time}` : ""}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            {!(tab === "posts" ? mine.posts : mine.comments).length ? <p className="muted">보관한 자료가 없습니다(수집 안 함).</p> : null}
          </>
        ) : null}
        {tab === "raw" && entry.raws.length ? (
          <>
            <p className="small muted">아직 구조를 해석하지 못한 화면(예: 프로필 사진 보기)을 보이던 그대로 보관한 것입니다. 스토리·사진 수에는 넣지 않습니다.</p>
            {entry.raws.length > 1 ? (
              <div className="profile-main-tabs">
                {entry.raws.map((r, i) => (
                  <button key={r.id} type="button" className={i === rawSel ? "is-on" : ""} onClick={() => setRawSel(i)}>
                    {r.fileName.replace(/\.html$/, "")}
                  </button>
                ))}
              </div>
            ) : null}
            {rawHtml === null ? <p className="muted">불러오는 중…</p> : <iframe className="profile-main-frame" title="원문 보관" sandbox="" srcDoc={rawHtml} />}
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
      {lb ? <Lightbox items={lb.items} index={lb.index} onIndex={(i) => setLb({ ...lb, index: i })} onClose={() => setLb(null)} /> : null}
    </article>
  );
}

/** 사람 목록의 한 사람 얼굴(확보 못 했으면 이름 첫 글자) */
export function ProfileFace({ entry, assetUrl, assetIdBySha, size = 32 }: { entry: ProfileEntry; assetUrl(id: string): string | undefined; assetIdBySha(sha: string): string | undefined; size?: number }) {
  const sha = entry.record?.avatar?.sha256;
  const id = sha ? assetIdBySha(sha) : undefined;
  const u = id ? assetUrl(id) : undefined;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  return u ? <img className="pv-mini-face" style={style} src={u} alt="" /> : <span className="pv-mini-face pv-initial" style={style} aria-hidden="true">{initialOf(entry.name)}</span>;
}

/** 프로필 목록 한 줄 요약(색 없이 읽히는 글자) */
export const profileRowText = (p: ProfileEntry) => (p.record ? `${storyStatus(p.record).text}${p.record.identity === "unconfirmed" ? " · 연결 미확인" : ""}` : "보관 화면만");

/** 프로필이 여럿이면 사람 목록 + 선택한 프로필 */
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
        <nav className="pv-people" aria-label="인물">
          {profiles.map((p) => (
            <button key={p.id} type="button" aria-pressed={p === cur} className={p === cur ? "is-on" : ""} onClick={() => setSel(p.id)} title={profileRowText(p)}>
              <ProfileFace entry={p} assetUrl={assetUrl} assetIdBySha={assetIdBySha} size={28} />
              <span className="ellipsis">{p.name}</span>
              {p.record?.identity === "unconfirmed" ? <small>(연결 미확인)</small> : null}
            </button>
          ))}
        </nav>
      ) : null}
      <ProfileView entry={cur} assetUrl={assetUrl} assetIdBySha={assetIdBySha} docs={docs} onOpenDoc={onOpenDoc} />
    </section>
  );
}

/** 상태 한 줄(HTML 목차·상세·확장과 같은 계산). 색과 함께 글자 표식 */
function StatusLine({ st }: { st: SectionStatus }) {
  return (
    <p className={`pv-status is-${st.tone}`}>
      <span className="pv-chip-mark">{TONE_MARK[st.tone]}</span> {st.text}
    </p>
  );
}
