import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChromeBrowser } from "./chromeBrowser";
import { COLLECTOR_VERSION } from "./config";
import { cdb, type Capture, type CommentObservation, type Job, type SelectedMember, type SelectReason, type Selection, type Task } from "./db";
import { createJob, DEFAULT_OPTIONS, Engine } from "./engine";
import { exportJob, exportJobHtml, profileStandaloneHtml } from "./exporter";
import { buildDiagnosticText, deleteDiagnostics, DiagRecorder } from "./diagnostics/recorder";
import { DIAG_FILE_NAME } from "./diagnostics/serializer";
import { parseBandUrl, parseMemberUrl, parsePostUrlList, parseSearchUrl, postKey } from "./urls";
import { describeSelection } from "./selection";
import { readArchive, type ArchiveReadResult } from "../../src/archive/reader";
import { summarizeArchive, type ArchiveSummary } from "./archiveImport";
import { computeOutcome, computeTotals, followUpText } from "./totals";
import { applyFollowScreen, logFollow, type FollowOutcome } from "./follow";
import { profileImages, profileSummary, type BandProfileRecord } from "../../src/importers/band/profile";
import { renderProfileHtml } from "../../src/exporters/profileHtml";
import { blobToDataUrl } from "../../src/exporters/html";
import { blocksToPlainText, parseBandHtml } from "../../src/importers/band/html";
import "./collector.css";

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "대기",
  running: "수집 중",
  paused: "일시정지",
  needsUser: "확인 필요",
  finished: "끝남",
  cancelled: "취소됨",
};
const TASK_LABEL: Record<Task["status"], string> = {
  pending: "대기",
  inFlight: "처리 중",
  succeeded: "확보",
  partial: "일부 확보",
  failed: "실패",
  skipped: "건너뜀",
};

function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 30_000);
}

/** 선택 수집은 선택 요약, 나머지는 밴드 이름 */
function jobTitle(j: Job) {
  return j.scope === "selection" ? j.label : j.bandName ?? j.label;
}

function fmtDuration(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 1) return "1분 미만";
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}

function Manager() {
  const params = new URLSearchParams(location.search);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sel, setSel] = useState<string | null>(params.get("job"));
  const [creating, setCreating] = useState(!params.get("job"));
  // 밴드 화면 저장 막대의 '골라서 저장…': 이 밴드(또는 멤버) 목록 주소를 채운 새 수집 화면
  const [formUrl] = useState(() => (params.get("new") === "form" ? params.get("url") : null));
  const [runningHere, setRunningHere] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const browserRef = useRef<ChromeBrowser | null>(null);

  const reload = useCallback(async () => {
    setJobs(await cdb().jobs.orderBy("createdAt").reverse().toArray());
  }, []);
  useEffect(() => {
    void reload();
    // 다른 창에서 진행 중인 작업도 보이도록 주기적으로 다시 읽는다
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [reload]);

  // ---- 직접 열며 수집: 사용자 탭의 화면 바뀜 알림을 받아 한 번에 하나씩 읽는다 ----
  const followRef = useRef<{ jobId: string; tabId: number; taskId: string; busy: boolean; again: boolean; last: string } | null>(null);
  const followNotify = (tabId: number, on: boolean, text: string) => {
    try {
      void chrome.tabs.sendMessage(tabId, { type: "afterlog-follow-state", on, text }).catch(() => undefined);
    } catch {
      /* 탭이 닫힘 */
    }
  };
  const followProcess = useCallback(async () => {
    const f = followRef.current;
    if (!f) return;
    if (f.busy) {
      f.again = true;
      return;
    }
    f.busy = true;
    try {
      do {
        f.again = false;
        browserRef.current ??= new ChromeBrowser();
        const at = new Date().toISOString();
        let out: FollowOutcome;
        try {
          const read = await browserRef.current.readProfileScreen(f.tabId);
          out = await applyFollowScreen(f.jobId, f.taskId, read, at);
        } catch (e) {
          out = { kind: "error", text: `화면을 읽지 못했습니다: ${(e as Error).message}`, images: [] };
        }
        await logFollow(f.jobId, out.kind, out.text, at);
        f.last = out.text;
        followNotify(f.tabId, true, out.text);
        const job = await cdb().jobs.get(f.jobId);
        if (out.images.length && job?.options.includeImages) {
          const engine = new Engine({ browser: browserRef.current, onEvent: () => void reload() });
          void engine.fetchAssets(out.images, f.taskId, new DiagRecorder(f.jobId, !!job.options.diagnostics)).then(() => reload());
        }
        await reload();
      } while (f.again && followRef.current === f);
    } finally {
      f.busy = false;
    }
  }, [reload]);
  const followStart = useCallback(
    async (jobId: string) => {
      const job = await cdb().jobs.get(jobId);
      const task = await cdb().tasks.where("jobId").equals(jobId).first();
      if (!job?.options.follow || !task) return;
      if (followRef.current && followRef.current.jobId !== jobId) {
        const prev = followRef.current;
        await stopFollow(prev.jobId);
        followNotify(prev.tabId, false, "");
      }
      await cdb().jobs.update(jobId, { status: "paused", pauseReason: null, finishedAt: null, options: { ...job.options, follow: { ...job.options.follow, active: true } } });
      followRef.current = { jobId, tabId: job.options.follow.tabId, taskId: task.id, busy: false, again: false, last: "" };
      followNotify(job.options.follow.tabId, true, "직접 열며 수집을 시작했습니다. 저장할 인물의 프로필·스토리·사진 화면을 여세요.");
      await reload();
      void followProcess();
    },
    [followProcess, reload],
  );
  const followStop = useCallback(async () => {
    const f = followRef.current;
    if (!f) return;
    followRef.current = null;
    await stopFollow(f.jobId);
    followNotify(f.tabId, false, "직접 열며 수집을 멈췄습니다");
    await reload();
  }, [reload]);
  useEffect(() => {
    const onMsg = (msg: { type?: string }, sender: chrome.runtime.MessageSender, reply: (r: unknown) => void) => {
      const f = followRef.current;
      const tabId = sender.tab?.id;
      if (!msg?.type?.startsWith("afterlog-follow-") || tabId === undefined) return;
      if (msg.type === "afterlog-follow-query") {
        if (f && f.tabId === tabId) reply({ on: true, text: f.last });
        return;
      }
      if (!f || f.tabId !== tabId) return;
      if (msg.type === "afterlog-follow-change") void followProcess();
      if (msg.type === "afterlog-follow-stop") void followStop();
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [followProcess, followStop]);
  // 관리 창을 다시 열면 켜져 있던 직접 열며 수집을 이어서
  useEffect(() => {
    void (async () => {
      const on = (await cdb().jobs.toArray()).find((j) => j.options.follow?.active);
      if (on && !followRef.current) await followStart(on.id);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(
    async (jobId: string) => {
      if (runningHere) return;
      browserRef.current ??= new ChromeBrowser();
      const engine = new Engine({ browser: browserRef.current, onEvent: () => void reload() });
      engineRef.current = engine;
      setRunningHere(jobId);
      setMessage(null);
      try {
        const r = await engine.run(jobId);
        if (r === "busy") setMessage({ kind: "error", text: "이 작업은 다른 수집 관리 창에서 이미 실행 중입니다." });
        if (r === "done") setMessage({ kind: "ok", text: "수집이 끝났습니다. 결과를 확인하고 '.afterlog로 저장'을 누르세요." });
      } catch (e) {
        setMessage({ kind: "error", text: `수집이 멈췄습니다: ${(e as Error).message}` });
        await cdb().jobs.update(jobId, { status: "paused", pauseReason: (e as Error).message });
      } finally {
        setRunningHere(null);
        engineRef.current = null;
        await reload();
      }
    },
    [runningHere, reload],
  );

  // 팝업·밴드 화면의 저장 막대에서 바로 시작
  const autostarted = useRef(false);
  useEffect(() => {
    if (autostarted.current) return;
    const id = params.get("job");
    if (id && params.get("autostart")) {
      autostarted.current = true;
      history.replaceState(null, "", `?job=${id}`);
      void start(id);
      return;
    }
    const kind = params.get("new");
    if (kind === "form") history.replaceState(null, "", location.pathname);
    if (kind !== "post" && kind !== "list" && kind !== "sel" && kind !== "search" && kind !== "popup" && kind !== "follow") return;
    autostarted.current = true;
    void (async () => {
      const created = await jobFromPage(kind, params.get("url") ?? "", Number(params.get("tabId")) || undefined, params.get("modes") ?? "");
      if ("error" in created) {
        history.replaceState(null, "", location.pathname);
        setMessage({ kind: "error", text: created.error });
        return;
      }
      history.replaceState(null, "", `?job=${created.id}`);
      setSel(created.id);
      setCreating(false);
      await reload();
      if (kind === "follow") void followStart(created.id);
      else void start(created.id);
    })();
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  const job = jobs.find((j) => j.id === sel) ?? null;
  const [archive, setArchive] = useState<{ r: ArchiveReadResult; summary: ArchiveSummary } | null>(null);

  return (
    <div className="mgr">
      <header className="mgr-top">
        <strong className="brand">AFTERLOG</strong>
        <span>수집 관리</span>
        <span className="muted small">v{COLLECTOR_VERSION}</span>
        <span className="spacer" />
        <a className="ui-link small" href="https://hotdoggydoggy.github.io/AFTERLOG/" target="_blank" rel="noreferrer">
          AFTERLOG 열기 (저장한 파일 보기)
        </a>
      </header>
      <div className="mgr-body">
        <aside className="mgr-jobs">
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => (setCreating(true), setArchive(null))}>
            새 수집
          </button>
          <label className="ui-btn archive-pick" title="사이트·로컬 실행판·확장이 만든 .afterlog를 열어 내용을 보고, 모자란 자료만 이어 수집합니다">
            보관 파일 가져오기
            <input
              type="file"
              accept=".afterlog,.zip"
              multiple
              hidden
              aria-label="보관 파일 가져오기"
              onChange={async (e) => {
                const fs = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (!fs.length) return;
                try {
                  const r = await readArchive(fs);
                  setArchive({ r, summary: summarizeArchive(r) });
                  setMessage(null);
                } catch (err) {
                  setMessage({ kind: "error", text: `보관 파일을 열지 못했습니다: ${(err as Error).message}` });
                }
              }}
            />
          </label>
          <ul>
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  aria-current={j.id === sel && !creating}
                  onClick={() => {
                    setSel(j.id);
                    setCreating(false);
                    setArchive(null);
                  }}
                >
                  <span className="ellipsis">{jobTitle(j)}</span>
                  <small className={`badge st-${runningHere === j.id ? "running" : j.status === "running" ? "stale" : j.status}`}>
                    {runningHere === j.id ? "수집 중" : j.status === "running" ? "중단됨" : STATUS_LABEL[j.status]}
                  </small>
                </button>
              </li>
            ))}
            {!jobs.length ? <li className="muted small">아직 작업이 없습니다.</li> : null}
          </ul>
        </aside>
        <main className="mgr-main">
          {message ? <p className={`notice ${message.kind}`}>{message.text}</p> : null}
          {archive ? (
            <ArchiveView
              archive={archive}
              onClose={() => setArchive(null)}
              onResume={async () => {
                const sm = archive.summary;
                const bands = new Set(sm.resume.posts.map((x) => x.key.split(":")[1]));
                const job = await createJob({
                  scope: "post-urls",
                  label: `이어 수집 · ${sm.title}`,
                  options: { ...DEFAULT_OPTIONS, skipCaptured: false },
                  bandNo: bands.size === 1 ? [...bands][0] : null,
                  posts: sm.resume.posts,
                  profiles: sm.resume.profiles.map((url) => ({ url })),
                });
                setArchive(null);
                await reload();
                setSel(job.id);
                setCreating(false);
                void start(job.id);
              }}
            />
          ) : creating || !job ? (
            <NewJob
              initialListUrl={formUrl}
              onCreated={async (id) => {
                await reload();
                setSel(id);
                setCreating(false);
                void start(id);
              }}
            />
          ) : (
            <JobView
              key={job.id}
              job={job}
              running={runningHere === job.id}
              busyElsewhere={!!runningHere && runningHere !== job.id}
              onStart={() => start(job.id)}
              onPause={() => engineRef.current?.requestStop()}
              onChanged={reload}
              setMessage={setMessage}
              engineForAssets={() => new Engine({ browser: (browserRef.current ??= new ChromeBrowser()), onEvent: () => void reload() })}
              followActive={followRef.current?.jobId === job.id}
              onFollowStart={() => void followStart(job.id)}
              onFollowStop={() => void followStop()}
              onFollowReadNow={() => void followProcess()}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/** 밴드 화면의 저장 막대(content.js)가 연 요청을 작업으로 만든다. 주소는 밴드 주소만 받는다. 같은 작업이 진행 중이면 그 작업으로 연결한다(6절) */
export async function jobFromPage(kind: "post" | "list" | "sel" | "search" | "popup" | "follow", rawUrl: string, tabId?: number, modes = ""): Promise<{ id: string } | { error: string }> {
  if (kind === "follow") {
    const u = parseBandUrl(rawUrl);
    if (!u || tabId === undefined) return { error: "밴드 화면에서만 쓸 수 있습니다." };
    // 같은 탭에서 켜져 있는 것이 있으면 그 작업으로
    const same = (await cdb().jobs.toArray()).find((j) => j.options.follow?.tabId === tabId && j.status !== "finished");
    if (same) return { id: same.id };
    const job = await createJob({
      scope: "profile",
      label: "직접 열며 수집",
      options: { ...DEFAULT_OPTIONS, skipCaptured: false, follow: { tabId, active: true, target: null, log: [] } },
      bandNo: u.bandNo,
      profiles: [{ url: rawUrl, tabId }],
    });
    // 자동 수집 과제로 돌지 않게(이 작업은 사용자가 연 화면을 따라 읽는다)
    const t = await cdb().tasks.where("jobId").equals(job.id).first();
    if (t) await cdb().tasks.update(t.id, { status: "skipped", errorCode: null, errorText: "직접 열며 수집: 아직 저장한 화면 없음" });
    return { id: job.id };
  }
  if (kind === "popup") {
    const u = parseBandUrl(rawUrl);
    if (!u || tabId === undefined) return { error: "밴드 화면의 프로필 팝업에서만 쓸 수 있습니다." };
    // 팝업은 주소로 다시 열 수 없어 지금 탭에서 한 번 읽는다(같은 작업으로 합치지 않음: 누를 때마다 그때 열린 인물)
    const job = await createJob({ scope: "profile", label: "프로필(팝업)", options: { ...DEFAULT_OPTIONS, skipCaptured: false }, bandNo: u.bandNo, profiles: [{ url: rawUrl, tabId }] });
    return { id: job.id };
  }
  if (kind === "search") {
    const q = parseSearchUrl(rawUrl);
    if (!q) return { error: "밴드 검색 결과 화면에서만 쓸 수 있습니다." };
    const selection: Selection = {
      members: [],
      authored: false,
      commentsOnly: false,
      commentedPosts: false,
      periodFrom: null,
      periodTo: null,
      search: { url: q.url, rows: [{ url: q.url, keywords: q.keywords }], keywords: [], match: "any", exclude: [], fields: "body" },
    };
    const same = await findSameJob((j) => j.scope === "selection" && JSON.stringify(j.options.selection) === JSON.stringify(selection));
    if (same) return { id: same.id };
    const job = await createJob({ scope: "selection", label: describeSelection(selection), options: { ...DEFAULT_OPTIONS, selection }, bandNo: q.bandNo });
    return { id: job.id };
  }
  if (kind === "sel") {
    const m = parseMemberUrl(rawUrl);
    if (!m) return { error: "인물(멤버) 화면에서만 인물 선택 저장을 쓸 수 있습니다." };
    const selection: Selection = {
      members: [{ ...m, name: null }],
      authored: modes.includes("A"),
      commentsOnly: modes.includes("B"),
      commentedPosts: modes.includes("C"),
      profile: modes.includes("P"),
      periodFrom: null,
      periodTo: null,
    };
    if (!selection.authored && !selection.commentsOnly && !selection.commentedPosts && !selection.profile) return { error: "수집할 항목을 고르지 않았습니다." };
    const same = await findSameJob((j) => j.scope === "selection" && JSON.stringify(j.options.selection) === JSON.stringify(selection));
    if (same) return { id: same.id };
    const job = await createJob({ scope: "selection", label: describeSelection(selection), options: { ...DEFAULT_OPTIONS, selection }, bandNo: m.bandNo });
    return { id: job.id };
  }
  const u = parseBandUrl(rawUrl);
  if (!u) return { error: "밴드 주소가 아니라서 시작하지 않았습니다." };
  if (kind === "post") {
    if (u.kind !== "post") return { error: "글 화면에서만 '이 글 저장'을 쓸 수 있습니다." };
    const job = await createJob({
      scope: "current-post",
      label: `글 ${u.postNo}`,
      options: { ...DEFAULT_OPTIONS, skipCaptured: false },
      bandNo: u.bandNo,
      posts: [{ url: u.canonical, key: postKey(u.bandNo, u.postNo), tabId }],
    });
    return { id: job.id };
  }
  const member = u.kind === "member-list" && u.list === "post";
  const list = member ? u.canonical : `${u.origin.replace("://www.", "://")}/band/${u.bandNo}/post`;
  const same = await findSameJob((j) => j.scope === "list" && j.bandNo === u.bandNo, list);
  if (same) return { id: same.id };
  const job = await createJob({ scope: "list", label: member ? "멤버 작성글 목록" : "밴드 글 목록", options: DEFAULT_OPTIONS, bandNo: u.bandNo, lists: [list] });
  return { id: job.id };
}

/** 끝나지 않은 같은 작업(반복 클릭 방지) */
async function findSameJob(match: (j: Job) => boolean, listUrl?: string): Promise<Job | undefined> {
  const open = await cdb().jobs.filter((j) => j.status !== "finished" && match(j)).toArray();
  for (const j of open) {
    if (!listUrl) return j;
    if (await cdb().tasks.where("[jobId+key]").equals([j.id, `list:${listUrl}`]).first()) return j;
  }
  return undefined;
}

type NewMode = "urls" | "list" | "person";

function NewJob({ onCreated, initialListUrl }: { onCreated(id: string): void; initialListUrl?: string | null }) {
  const initialMember = initialListUrl ? parseMemberUrl(initialListUrl) : null;
  // 검색 결과 화면에서 연 경우(경로에 search 또는 검색어 매개변수)
  const initialSearch = initialListUrl && !initialMember && /\/search|[?&](keyword|query|q|searchKeyword)=/.test(initialListUrl) ? parseSearchUrl(initialListUrl) : null;
  const [mode, setMode] = useState<NewMode>(initialMember || initialSearch ? "person" : initialListUrl ? "list" : "urls");
  const [searchUrl, setSearchUrl] = useState(initialSearch?.url ?? "");
  // 모든 검색 결과에 더 거는 공통 필터(선택). 주소마다의 검색어는 rowEdits
  const [keywords, setKeywords] = useState("");
  // 주소별 검색어를 직접 고친 행(주소 → 입력값). 고친 행은 주소를 다시 읽어도 덮어쓰지 않는다(행별 잠금)
  const [rowEdits, setRowEdits] = useState<Record<string, string>>({});
  const [exclude, setExclude] = useState("");
  const [matchAll, setMatchAll] = useState(false);
  const [withComments, setWithComments] = useState(false);
  const [combineAnd, setCombineAnd] = useState(false);
  const [urls, setUrls] = useState("");
  const [listUrl, setListUrl] = useState(() => {
    const u = initialListUrl && !initialMember && !initialSearch ? parseBandUrl(initialListUrl) : null;
    if (!u) return "";
    return u.kind === "member-list" ? u.canonical : `${u.origin.replace("://www.", "://")}/band/${u.bandNo}`;
  });
  const [people, setPeople] = useState(initialMember ? `${initialMember.origin}/band/${initialMember.bandNo}/member/${initialMember.memberKey}` : "");
  const [modes, setModes] = useState(
    initialSearch ? { authored: false, commentsOnly: false, commentedPosts: false, profile: false } : { authored: true, commentsOnly: false, commentedPosts: true, profile: false },
  );
  const [opts, setOpts] = useState({ ...DEFAULT_OPTIONS });
  const [err, setErr] = useState<string | null>(null);
  const parsed = useMemo(() => parsePostUrlList(urls), [urls]);
  const members = useMemo(() => {
    const out: SelectedMember[] = [];
    for (const line of people.split(/\s+/)) {
      const m = line ? parseMemberUrl(line) : null;
      if (m && !out.some((x) => x.bandNo === m.bandNo && x.memberKey === m.memberKey)) out.push({ ...m, name: null });
    }
    return out;
  }, [people]);
  const terms = (x: string) => [...new Set(x.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))];
  // 검색 결과 주소 여러 개(한 줄에 하나). 주소마다 검색어를 읽는다
  const searchLines = searchUrl.split(/\s+/).filter(Boolean);
  const parsedSearch = searchLines.map((line) => ({ line, q: parseSearchUrl(line) }));
  const goodSearch = parsedSearch.filter((x): x is { line: string; q: NonNullable<ReturnType<typeof parseSearchUrl>> } => !!x.q);
  const badSearch = parsedSearch.filter((x) => !x.q).length;
  // 주소마다: 주소에서 읽은 검색어(자동) 또는 사용자가 고친 값(잠금). 같은 주소는 한 번만
  const searchRows = goodSearch
    .filter((x, i) => goodSearch.findIndex((y) => y.q.url === x.q.url) === i)
    .map((x) => {
      const edited = rowEdits[x.q.url];
      return { url: x.q.url, detected: x.q.keywords, keywords: edited !== undefined ? terms(edited) : x.q.keywords, locked: edited !== undefined };
    });
  const sq = goodSearch.length ? { url: goodSearch[0].q.url, urls: searchRows.map((r) => r.url), bandNo: goodSearch[0].q.bandNo } : null;
  const onSearchUrls = (v: string) => setSearchUrl(v);
  const postConds = (members.length ? [modes.authored, modes.commentedPosts].filter(Boolean).length : 0) + (sq ? 1 : 0);
  const selection: Selection = {
    members: members.length && (modes.authored || modes.commentsOnly || modes.commentedPosts || modes.profile) ? members : [],
    ...(members.length ? modes : { authored: false, commentsOnly: false, commentedPosts: false, profile: false }),
    periodFrom: opts.periodFrom,
    periodTo: opts.periodTo,
    search: sq
      ? {
          url: sq.url,
          urls: sq.urls,
          rows: searchRows.map((r) => ({ url: r.url, keywords: r.keywords, ...(r.locked ? { locked: true } : {}) })),
          keywords: terms(keywords),
          match: matchAll ? "all" : "any",
          exclude: terms(exclude),
          fields: withComments ? "bodyAndComments" : "body",
        }
      : null,
    combine: combineAnd && postConds >= 2 ? "and" : "or",
  };

  const submit = async () => {
    setErr(null);
    if (opts.periodFrom && opts.periodTo && opts.periodFrom > opts.periodTo) return setErr("기간의 시작이 끝보다 늦습니다.");
    if (mode === "urls") {
      if (!parsed.posts.length) return setErr("밴드 글 주소(https://band.us/band/숫자/post/숫자)를 한 줄에 하나씩 넣어 주세요.");
      const bands = new Set(parsed.posts.map((p) => p.bandNo));
      const job = await createJob({
        scope: "post-urls",
        label: `글 ${parsed.posts.length}개`,
        options: opts,
        bandNo: bands.size === 1 ? [...bands][0] : null,
        posts: parsed.posts.map((p) => ({ url: p.canonical, key: `band:${p.bandNo}:post:${p.postNo}` })),
      });
      onCreated(job.id);
    } else if (mode === "list") {
      const u = parseBandUrl(listUrl);
      if (!u || !(u.kind === "feed" || (u.kind === "member-list" && u.list === "post")))
        return setErr("밴드 글 목록(https://band.us/band/숫자) 또는 멤버 작성글 목록 주소를 넣어 주세요.");
      const job = await createJob({ scope: "list", label: u.kind === "feed" ? "밴드 글 목록" : "멤버 작성글 목록", options: opts, bandNo: u.bandNo, lists: [u.canonical] });
      onCreated(job.id);
    } else {
      if (badSearch) return setErr(`검색 결과 주소 ${badSearch}개가 밴드 안의 주소가 아닙니다(밴드에서 검색한 뒤 주소창의 주소를 한 줄에 하나씩).`);
      if (!members.length && !sq) return setErr("인물 프로필 주소(https://band.us/band/숫자/member/…)나 검색 결과 주소를 넣어 주세요. 인물 주소는 밴드에서 인물 사진을 눌러 연 화면의 주소입니다.");
      if (members.length && !modes.authored && !modes.commentsOnly && !modes.commentedPosts && !modes.profile) return setErr("인물에 대해 수집할 항목을 하나 이상 골라 주세요.");
      // 선택 수집의 기간은 모드별 기준으로 판단하므로(5절) 일반 기간 조건은 쓰지 않는다
      const job = await createJob({
        scope: "selection",
        label: describeSelection(selection),
        options: { ...opts, periodFrom: null, periodTo: null, selection },
        bandNo: members[0]?.bandNo ?? sq!.bandNo,
      });
      onCreated(job.id);
    }
  };

  const summary =
    mode === "person" && (members.length || sq)
      ? `${describeSelection(selection)} · ${modes.commentedPosts || modes.authored || sq ? "원글 및 전체 댓글" : "댓글만"} · ${opts.includeImages ? "이미지는 뒤에서 받기" : "이미지 제외"}`
      : null;

  return (
    <section className="card">
      <h2>새 수집</h2>
      <p className="muted small">밴드에 로그인한 브라우저에서 실행하세요. 수집용 창(목록용·글용)이 열리고 그 안에서만 차례로 엽니다(요청 간격 1.5~3초).</p>
      <div className="seg" role="radiogroup" aria-label="수집 대상">
        {(
          [
            ["person", "인물·검색 선택"],
            ["list", "목록에서 글 찾기"],
            ["urls", "글 주소 여러 개"],
          ] as [NewMode, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} aria-pressed={mode === k} onClick={() => setMode(k)}>
            {l}
          </button>
        ))}
      </div>
      {mode === "urls" ? (
        <label className="field">
          <span>글 주소 (한 줄에 하나)</span>
          <textarea rows={6} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://band.us/band/12345/post/678" />
          <small className="muted">
            인식한 글 {parsed.posts.length}개{parsed.rejected.length ? ` · 글 주소가 아닌 줄 ${parsed.rejected.length}개는 건너뜀` : ""}
          </small>
        </label>
      ) : mode === "list" ? (
        <label className="field">
          <span>목록 주소 (밴드 글 목록 또는 멤버 작성글 목록)</span>
          <input value={listUrl} onChange={(e) => setListUrl(e.target.value)} placeholder="https://band.us/band/12345" />
          <small className="muted">목록을 끝까지 스크롤하며 글 주소를 모은 뒤 하나씩 저장합니다. 새 글이 더 나오지 않으면 멈추고 '끝 확인 불가'로 표시합니다.</small>
        </label>
      ) : (
        <>
          <label className="field">
            <span>인물 프로필 주소 (한 줄에 하나, 여러 명 가능 · 검색만 할 때는 비워 둠)</span>
            <textarea rows={3} value={people} onChange={(e) => setPeople(e.target.value)} placeholder="https://band.us/band/12345/member/…" />
            <small className="muted">
              인식한 인물 {members.length}명. 인물은 이름이 아니라 밴드의 멤버 식별자로 구분합니다(같은 이름의 다른 사람과 섞이지 않음). 한 계정을 여러 캐릭터가 함께 쓰면 계정 기준으로 모입니다.
            </small>
          </label>
          <fieldset className="filter-box">
            <legend>무엇을 모을까요 (여러 개 선택 가능, 같은 글은 한 번만 저장)</legend>
            <label className="check">
              <input type="checkbox" checked={modes.authored} onChange={(e) => setModes({ ...modes, authored: e.target.checked })} /> 이 인물이 쓴 글 — 글과 그 글의 전체 댓글
            </label>
            <label className="check">
              <input type="checkbox" checked={modes.commentsOnly} onChange={(e) => setModes({ ...modes, commentsOnly: e.target.checked })} /> 이 인물이 쓴 댓글만 — 인물의 댓글 목록 그대로(다른 사람의 글·댓글은 넣지 않음)
            </label>
            <label className="check">
              <input type="checkbox" checked={modes.commentedPosts} onChange={(e) => setModes({ ...modes, commentedPosts: e.target.checked })} /> 이 인물이 댓글 단 글 — 원글과 다른 인물 포함 전체 댓글
            </label>
            <label className="check">
              <input type="checkbox" checked={modes.profile} onChange={(e) => setModes({ ...modes, profile: e.target.checked })} /> 이 인물의 프로필 — 프로필·커버 사진, 이름·소개, 스토리(날짜·글·숫자·링크)를 보이는 모습 그대로 보관
            </label>
            <small className="muted">
              밴드 전체 목록을 먼저 훑지 않고, 인물의 작성글·작성댓글 목록에서 필요한 글만 찾아 엽니다. 댓글 단 글은 댓글 목록 항목을 눌러 원글을 확인합니다(누르기만 하고 아무것도 쓰지 않음).
            </small>
          </fieldset>
          <fieldset className="filter-box">
            <legend>검색어가 들어간 글 (선택)</legend>
            <label className="field">
              <span>검색 결과 주소 — 밴드에서 검색한 뒤 주소창의 주소 (한 줄에 하나, 여러 개 가능)</span>
              <textarea rows={3} value={searchUrl} onChange={(e) => onSearchUrls(e.target.value)} placeholder="밴드 검색 결과 화면의 주소" />
            </label>
            {parsedSearch.length ? (
              <ul className="plain-list search-detected">
                {parsedSearch.map((x, i) => {
                  const row = x.q ? searchRows.find((r) => r.url === x.q!.url) : null;
                  return (
                    <li key={i} className={x.q ? "search-row" : "search-row is-bad"}>
                      <span className="small">주소 {i + 1}</span>
                      {!x.q || !row ? (
                        <span className="small">밴드 안의 주소가 아님</span>
                      ) : (
                        <>
                          <input
                            aria-label={`주소 ${i + 1}의 검색어`}
                            value={rowEdits[row.url] ?? row.detected.join(", ")}
                            onChange={(e) => setRowEdits((m) => ({ ...m, [row.url]: e.target.value }))}
                            placeholder="검색어를 주소에서 읽지 못함(직접 넣거나 비워 두면 검색 결과 그대로)"
                          />
                          <small className="muted">
                            {row.locked ? "직접 고침" : row.detected.length ? "주소에서 읽음" : "읽지 못함"}
                            {row.locked ? (
                              <button
                                type="button"
                                className="ui-link small"
                                onClick={() =>
                                  setRowEdits((m) => {
                                    const n = { ...m };
                                    delete n[row.url];
                                    return n;
                                  })
                                }
                              >
                                {" "}
                                되돌리기
                              </button>
                            ) : null}
                          </small>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {searchRows.length > 1 ? <p className="small muted">주소가 여럿이면 각 주소에서 찾은 글을 그 주소의 검색어로 다시 확인하고 결과를 합칩니다(서로 다른 주소의 검색어를 '모두 포함'으로 묶지 않음). 같은 글은 한 번만 엽니다.</p> : null}
            <div className="row">
              <label className="field">
                <span>공통 필터 (선택 · 모든 검색 결과에 더 거는 검색어, 쉼표로 여러 개)</span>
                <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="비워 두면 주소별 검색어만" />
              </label>
              <label className="field">
                <span>제외어 (선택)</span>
                <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="예: 공지" />
              </label>
            </div>
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={matchAll} onChange={(e) => setMatchAll(e.target.checked)} /> 검색어 모두 포함(같은 본문·같은 댓글 안에서)
              </label>
              <label className="check">
                <input type="checkbox" checked={withComments} onChange={(e) => setWithComments(e.target.checked)} /> 댓글도 검사(더 오래 걸릴 수 있음)
              </label>
            </div>
            <small className="muted">
              검색 결과에서 찾은 글을 열어 본문(선택 시 댓글)에서 검색어를 다시 확인합니다. 인물 이름·소개에만 있는 단어는 일치로 보지 않고, 불러오지 못한 댓글은 '판단 불가'로 따로 둡니다. 결과는 그
              검색 결과에서 확보한 범위이며 밴드 전체 검색을 보장하지 않습니다.
            </small>
          </fieldset>
          {postConds >= 2 ? (
            <div className="ui-seg-row">
              <span className="small">조건 조합</span>
              <div className="seg" role="radiogroup" aria-label="조건 조합">
                <button type="button" role="radio" aria-checked={!combineAnd} aria-pressed={!combineAnd} onClick={() => setCombineAnd(false)}>
                  하나라도 맞으면 (합집합)
                </button>
                <button type="button" role="radio" aria-checked={combineAnd} aria-pressed={combineAnd} onClick={() => setCombineAnd(true)}>
                  모두 맞아야 (교집합)
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      <div className="row">
        <label className="field">
          <span>{mode === "person" ? "기간 시작 (선택)" : "작성일 시작 (선택)"}</span>
          <input type="date" value={opts.periodFrom ?? ""} onChange={(e) => setOpts({ ...opts, periodFrom: e.target.value || null })} />
        </label>
        <label className="field">
          <span>{mode === "person" ? "기간 끝 (선택, 이 날 포함)" : "작성일 끝 (선택, 이 날 포함)"}</span>
          <input type="date" value={opts.periodTo ?? ""} onChange={(e) => setOpts({ ...opts, periodTo: e.target.value || null })} />
        </label>
      </div>
      {mode === "person" && (opts.periodFrom || opts.periodTo) ? (
        <p className="small muted">기간 기준: 쓴 글은 글 작성일, 쓴 댓글·댓글 단 글은 이 인물의 댓글 작성일(1월 글에 9월 댓글을 달았다면 9월에 포함). 날짜를 못 읽은 댓글은 빼지 않고 '확인 필요'로 남깁니다.</p>
      ) : null}
      <label className="check">
        <input type="checkbox" checked={opts.includeImages} onChange={(e) => setOpts({ ...opts, includeImages: e.target.checked })} /> 이미지·프로필 사진 파일도 저장 (본문을 먼저 저장하고 뒤에서 받음)
      </label>
      <label className="check">
        <input type="checkbox" checked={opts.skipCaptured} onChange={(e) => setOpts({ ...opts, skipCaptured: e.target.checked })} /> 이미 저장한 글은 다시 열지 않고 저장본 재사용
      </label>
      <label className="check">
        <input type="checkbox" checked={opts.diagnostics} onChange={(e) => setOpts({ ...opts, diagnostics: e.target.checked })} /> 문제 진단 기록 남기기 (본문·이름·주소·검색어 없이 단계별 결과만, 이 컴퓨터에만 보관)
      </label>
      <label className="field narrow">
        <span>파일 나누기 기준 (MB)</span>
        <input type="number" min={10} max={1000} value={opts.maxPartMB} onChange={(e) => setOpts({ ...opts, maxPartMB: Math.max(10, Number(e.target.value) || 100) })} />
      </label>
      {summary ? <p className="notice">{summary}</p> : null}
      {err ? <p className="notice error">{err}</p> : null}
      <button type="button" className="ui-btn ui-btn-primary" onClick={submit}>
        수집 시작
      </button>
      <details className="small muted">
        <summary>지원 범위와 검증 수준</summary>
        <ul>
          <li>게시글 본문·작성자·시각·댓글·답글·이미지: 지원 — 저장 페이지 샘플로 구조 확인, 합성 화면에서 통과, 실제 밴드 화면 일부 확인</li>
          <li>글 목록 스크롤로 글 찾기: 지원 — 합성 화면에서 통과, 실제 밴드에서 목록 끝까지 확인</li>
          <li>인물 선택(쓴 글·쓴 댓글·댓글 단 글): 합성 화면에서 통과. 멤버 댓글 목록 구조는 저장 샘플로 확인했지만, 항목을 눌러 원글을 여는 동작은 <b>실제 밴드에서 미검증</b></li>
          <li>접힌 댓글 펼치기: '이전 댓글·답글 더보기'류 버튼만 눌러 불러오고, 누를 때마다 읽은 댓글을 누적 저장(화면에서 사라져도 유지). 멈춘 이유를 코드로 남기며, 원인을 확인하지 못한 부족분을 '삭제됨'으로 단정하지 않음</li>
          <li>검색 결과 수집: 사용자가 연 검색 결과 화면에서 글을 찾고 본문에서 검색어를 다시 확인. 실제 밴드 검색 화면 구조는 <b>미검증</b>(자동 검색 입력은 아직 없음)</li>
          <li>조건 교집합(AND): 모든 후보를 찾은 뒤 모든 조건에 든 글만 엶</li>
          <li>인물 프로필: 기본 정보(이름·소개·사진·커버·가입일·프로필 표정/댓글 수)와 스토리(상세를 열어 전문·표정 수·댓글)를 구조로 저장하고, 보관 당시 화면도 함께 보관. 구조는 사용자 저장 표본으로 확인했고 스토리 댓글 항목 구조와 '이전 댓글' 동작은 <b>실제 밴드에서 미검증</b>. 주소가 그대로인 프로필 팝업은 그 탭에서 기본 정보만 읽음(인물 연결 미확인). 프로필 사진 이력은 화면 표본이 없어 '확인 못 함'</li>
          <li>표정 종류·반응자, 채팅: 아직 미지원</li>
        </ul>
      </details>
    </section>
  );
}

function JobView({
  job,
  running,
  busyElsewhere,
  onStart,
  onPause,
  onChanged,
  setMessage,
  engineForAssets,
  followActive,
  onFollowStart,
  onFollowStop,
  onFollowReadNow,
}: {
  job: Job;
  running: boolean;
  busyElsewhere: boolean;
  onStart(): void;
  onPause(): void;
  onChanged(): Promise<void>;
  setMessage(m: { kind: "ok" | "error"; text: string } | null): void;
  engineForAssets(): Engine;
  followActive: boolean;
  onFollowStart(): void;
  onFollowStop(): void;
  onFollowReadNow(): void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [caps, setCaps] = useState<Capture[]>([]);
  const [obs, setObs] = useState<CommentObservation[]>([]);
  const [assetStat, setAssetStat] = useState({ stored: 0, failed: 0, thumb: 0, bytes: 0, waiting: 0 });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ts = await cdb().tasks.where("jobId").equals(job.id).sortBy("order");
      const cs = await cdb().captures.where("jobId").equals(job.id).toArray();
      setTasks(ts);
      setCaps(cs);
      setObs(await cdb().comments.where("jobId").equals(job.id).toArray());
      // 글 이미지 + 프로필·스토리·사진첩 이미지(자산 파일 수는 사진이 나온 횟수와 다르다)
      const ps = await cdb().profiles.where("jobId").equals(job.id).toArray();
      const urls = [...new Set([...cs.flatMap((c) => c.imageUrls), ...ps.flatMap((p) => [...p.imageUrls, ...(p.record ? profileImages(p.record).map((i) => i.src).filter((u) => /^https?:/.test(u)) : [])])])];
      const as = (await cdb().assets.bulkGet(urls)).filter(Boolean);
      setAssetStat({
        stored: as.filter((a) => a!.status === "stored").length,
        failed: as.filter((a) => a!.status === "failed").length,
        thumb: as.filter((a) => a!.status === "stored" && a!.quality === "thumbnail").length,
        bytes: as.reduce((n, a) => n + (a!.size || 0), 0),
        waiting: urls.length - as.filter((a) => a!.status === "stored" || a!.status === "failed").length,
      });
    })();
  }, [job]);

  const posts = tasks.filter((t) => t.kind === "post");
  const lists = tasks.filter((t) => t.kind === "list");
  const commentLists = tasks.filter((t) => t.kind === "comments");
  const profileTasks = tasks.filter((t) => t.kind === "profile");
  const count = (s: Task["status"]) => posts.filter((t) => t.status === s).length;
  const stale = job.status === "running" && !running;
  // 남은 시간: 이 창에서 수집을 시작한 뒤 끝난 글 수로 속도를 잰다
  const doneNow = count("succeeded") + count("partial") + count("failed") + count("skipped");
  const left = count("pending") + count("inFlight");
  const pace = useRef<{ t: number; n: number } | null>(null);
  if (!running) pace.current = null;
  else if (!pace.current && tasks.length) pace.current = { t: Date.now(), n: doneNow };
  const rate = pace.current && doneNow > pace.current.n ? (Date.now() - pace.current.t) / (doneNow - pace.current.n) : null;

  const exportNow = async () => {
    setBusy(true);
    try {
      const { parts, documents, report } = await exportJob(job.id);
      for (const p of parts) download(p.blob, p.fileName);
      setMessage({
        kind: "ok",
        text: `.afterlog 파일 ${parts.length}개를 받았습니다(문서 ${documents}개 · 글 ${report.posts.captured}개 · 댓글 ${report.totals?.comments ?? 0}개, 결과: ${report.outcome === "complete" ? "선택 범위 확인 완료" : report.outcome === "partial" ? "일부 미확보" : "끝 확인 불가"}). AFTERLOG(사이트·로컬 실행판)에서 '파일 열기'로 ${parts.length > 1 ? "모든 파트를 함께 " : ""}여세요.`,
      });
    } catch (e) {
      setMessage({ kind: "error", text: `파일 만들기 실패: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const exportHtml = async () => {
    setBusy(true);
    try {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      const { file, documents, report } = await exportJobHtml(job.id, dark ? "dark" : "light");
      download(file.blob, file.fileName);
      setMessage({
        kind: "ok",
        text:
          documents > 1
            ? `HTML ${documents}개와 목차(index.html)를 ZIP으로 받았습니다(글 ${report.posts.captured}개 · 댓글 ${report.totals?.comments ?? 0}개). 압축을 풀고 index.html을 여세요. 인터넷 없이 열립니다.`
            : `HTML 파일을 받았습니다(댓글 ${report.totals?.comments ?? 0}개). 더블클릭하면 브라우저에서 열립니다.`,
      });
    } catch (e) {
      setMessage({ kind: "error", text: `HTML 만들기 실패: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  // 수집 합계: 이 작업 파일에 들어가는 글(결과에서 뺀 글 제외)과 그 글들의 댓글, 인물 댓글 모음
  const totals = computeTotals(
    caps,
    obs,
    job.options.selection,
    profileTasks.filter((t) => t.status === "succeeded" || t.status === "partial").map((t) => (t.tabId !== undefined ? t.id : t.url)),
  );
  const { outcome, followUp } = computeOutcome(tasks, obs, assetStat.failed);
  const followText = followUpText(followUp);
  // 내보낼 수 있는 자료가 하나라도 있으면 저장할 수 있다(글이 0개여도 댓글 모음·프로필만으로, 명세 8.1·C07)
  const exportable = totals.posts > 0 || totals.memberComments > 0 || totals.profiles > 0;

  const openProfile = async (taskId: string, what: "data" | "snapshot") => {
    const p = await cdb().profiles.where("taskId").equals(taskId).first();
    if (!p) return;
    let html: string;
    if (what === "data" && p.record) {
      // 확보한 이미지는 데이터 주소로(인터넷 없이 보임), 못 받은 것은 '미확보'
      const urls = new Map<string, string>();
      for (const ref of profileImages(p.record)) {
        const a = /^https?:/.test(ref.src) ? await cdb().assets.get(ref.src) : undefined;
        if (a?.status === "stored" && a.blob && !urls.has(ref.src)) urls.set(ref.src, await blobToDataUrl(a.blob));
      }
      html = renderProfileHtml(p.record, (i) => urls.get(i.src) ?? null, { generator: `AFTERLOG Collector ${COLLECTOR_VERSION}` });
    } else html = await profileStandaloneHtml(p);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const retryPartial = async () => {
    const part = posts.filter((t) => t.status === "partial");
    await cdb().transaction("rw", cdb().tasks, async () => {
      for (const t of part) await cdb().tasks.update(t.id, { status: "pending", attempts: 0, notBefore: 0 });
    });
    if (job.status === "finished") await cdb().jobs.update(job.id, { status: "paused" });
    await onChanged();
    onStart();
  };

  const retryFailed = async () => {
    // 글뿐 아니라 목록·인물 댓글 목록·프로필 탐색의 실패도 다시
    const failed = tasks.filter((t) => t.status === "failed");
    await cdb().transaction("rw", cdb().tasks, async () => {
      for (const t of failed) await cdb().tasks.update(t.id, { status: "pending", attempts: 0, notBefore: 0, errorCode: null, errorText: null });
    });
    await onChanged();
    onStart();
  };

  const removeJob = async () => {
    if (!confirm("이 작업과 여기서 모은 글을 이 브라우저에서 지울까요? 이미 받은 .afterlog 파일은 그대로입니다.")) return;
    await cdb().transaction("rw", [cdb().jobs, cdb().tasks, cdb().captures, cdb().comments, cdb().profiles], async () => {
      await cdb().comments.where("jobId").equals(job.id).delete();
      await cdb().profiles.where("jobId").equals(job.id).delete();
      await cdb().tasks.where("jobId").equals(job.id).delete();
      await cdb().captures.where("jobId").equals(job.id).delete();
      await cdb().jobs.delete(job.id);
    });
    await deleteDiagnostics(job.id);
    await onChanged();
  };

  return (
    <section className="card">
      <div className="job-head">
        <h2>{jobTitle(job)}</h2>
        <span className={`badge st-${running ? "running" : stale ? "stale" : job.status}`}>{running ? "수집 중" : stale ? "중단됨" : STATUS_LABEL[job.status]}</span>
      </div>
      {job.pauseReason ? <p className="notice warn">{job.pauseReason}</p> : null}
      {running ? <p className="notice">수집은 이 관리 창에서 진행됩니다. 창을 닫으면 멈추며, 다시 열어 '이어받기'를 누르면 남은 글부터 계속합니다.</p> : null}
      {stale ? <p className="notice warn">창이 닫혀 수집이 중단됐습니다. 이미 모은 글은 남아 있습니다. '이어받기'로 계속하세요.</p> : null}
      {job.lastRunVersion && job.lastRunVersion !== COLLECTOR_VERSION ? (
        <p className="notice">확장이 v{job.lastRunVersion}에서 v{COLLECTOR_VERSION}로 업데이트됐습니다. 이어받으면 저장된 주소부터 새 버전으로 계속하며, 이미 모은 글은 그대로 둡니다.</p>
      ) : null}

      {job.options.follow ? (
        <section className="follow-panel" aria-label="직접 열며 수집">
          <p>
            <b>{followActive ? "직접 열며 수집 중" : "직접 열며 수집 멈춤"}</b>
            {job.options.follow.target ? ` · 대상: ${job.options.follow.target.name ?? "이름 모름"}${job.options.follow.target.memberKey ? "" : "(인물 확인 전)"}` : " · 대상: 첫 화면의 인물"}
          </p>
          <p className="small muted">
            이 관리 창을 연 채로, 밴드 탭에서 저장할 인물의 프로필·스토리(상세)·팝업·'사진' 탭을 직접 여세요. 화면이 바뀔 때마다 그대로 읽어 이 인물 아래에 보탭니다(누르거나 쓰지 않음). 다른 인물·밴드 화면은
            저장하지 않고, 같은 내용은 다시 늘리지 않습니다. 글은 막대의 '이 글 저장'으로.
          </p>
          <div className="row">
            {followActive ? (
              <>
                <button type="button" className="ui-btn" onClick={onFollowReadNow}>
                  지금 화면 읽기
                </button>
                <button type="button" className="ui-btn" onClick={onFollowStop}>
                  멈추기
                </button>
              </>
            ) : (
              <button type="button" className="ui-btn ui-btn-primary" onClick={onFollowStart}>
                다시 따라가기
              </button>
            )}
          </div>
          <ol className="follow-log small">
            {job.options.follow.log.map((l, i) => (
              <li key={i} className={`fl-${l.kind}`}>
                <time>{new Date(l.at).toLocaleTimeString()}</time> {l.text}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <div className="totals" aria-label="수집 합계">
        <span>
          저장한 글 <b>{totals.posts.toLocaleString()}</b>개
        </span>
        <span>
          댓글·답글 <b>{totals.comments.toLocaleString()}</b>개
          {totals.commentsShown || totals.commentsShownUnknown ? (
            <small className="muted">
              {" "}
              (밴드 표시 {totals.commentsShown.toLocaleString()}개{totals.commentsShownUnknown ? ` + 표시 수 모르는 글 ${totals.commentsShownUnknown}개` : ""})
            </small>
          ) : null}
        </span>
        {totals.memberComments ? (
          <span>
            인물 댓글 모음 <b>{totals.memberComments.toLocaleString()}</b>개
            {totals.memberCommentsOnlyInList ? <small className="muted"> (원글에서 확인 안 된 {totals.memberCommentsOnlyInList}개 포함)</small> : null}
          </span>
        ) : null}
        {totals.profiles ? (
          <span>
            프로필 <b>{totals.profiles}</b>명
          </span>
        ) : null}
      </div>
      {totals.commentsOverShown ? (
        <p className="small muted">표시 수보다 댓글을 많이 저장한 글 {totals.commentsOverShown}개: 표시 수를 본 시각·집계 범위(답글 포함 여부)가 다를 수 있어 확인이 필요합니다. 표시 수는 고치지 않았습니다.</p>
      ) : null}
      {job.status === "finished" || !running ? (
        <p className={`small ${outcome === "complete" ? "muted" : ""}`}>
          {outcome === "complete" ? "선택 범위 확인 완료" : outcome === "unknownEnd" ? "끝을 확인하지 못한 탐색이 있습니다" : "일부 미확보"}
          {followText ? ` · 보완 필요: ${followText}` : ""}
        </p>
      ) : null}
      <div className="stats">
        {lists.map((l) => (
          <div key={l.id} className="stat wide">
            <b>{l.result?.found ?? 0}</b>
            <span>
              {l.listReason === "authored" ? "인물이 쓴 글" : l.listReason === "search" ? "검색 결과에서 찾은 글" : "목록에서 찾은 글"} · {l.status === "succeeded" ? (l.result?.coverage === "unknown" ? "끝 확인 불가" : l.result?.coverage === "partial" ? "일부만 탐색" : "끝") : "찾는 중"}
            </span>
          </div>
        ))}
        {profileTasks.map((t) => {
          const done = t.status === "succeeded" || t.status === "partial";
          return (
            <div key={t.id} className="stat wide">
              <b>{done ? `스토리 ${t.result?.stories ?? 0}` : TASK_LABEL[t.status]}</b>
              <span>
                {t.result?.title ?? "프로필"}
                {done && t.result?.profileStatus ? <small className="muted"> · {t.result.profileStatus}</small> : null}
                {done ? ` · 이미지 ${t.result?.images ?? 0}개 · ` : " · "}
                {done ? (
                  <>
                    <button type="button" className="ui-link small" onClick={() => void openProfile(t.id, "data")}>
                      보관본 보기
                    </button>{" "}
                    {t.result?.hasSnapshot !== false ? (
                      <button type="button" className="ui-link small" onClick={() => void openProfile(t.id, "snapshot")}>
                        보관 당시 화면
                      </button>
                    ) : null}
                    {t.status === "partial" && t.errorText ? <small className="muted"> · {t.errorText}</small> : null}
                  </>
                ) : (
                  t.errorText ?? ""
                )}
              </span>
            </div>
          );
        })}
        {commentLists.map((l) => {
          const mine = obs.filter((o) => o.taskId === l.id);
          const inRange = mine.filter((o) => o.inRange !== false);
          return (
            <div key={l.id} className="stat wide">
              <b>{mine.length}</b>
              <span>
                {l.result?.memberName ?? "인물"}의 댓글 관측{inRange.length !== mine.length ? ` (기간 안 ${inRange.length})` : ""} ·{" "}
                {l.status === "succeeded" ? (l.result?.coverage === "partial" ? "일부만 탐색" : "끝 확인 불가") : "읽는 중"}
                {job.options.selection?.commentedPosts
                  ? ` · 원글 확인 ${mine.filter((o) => o.link === "linked").length}${mine.some((o) => o.link === "guessed") ? ` · 대조 대기 ${mine.filter((o) => o.link === "guessed").length}` : ""}${mine.some((o) => o.link === "failed") ? ` · 원글 못 찾음 ${mine.filter((o) => o.link === "failed").length}` : ""}`
                  : ""}
              </span>
            </div>
          );
        })}
        <div className="stat">
          <b>{count("succeeded")}</b>
          <span>확보</span>
        </div>
        <div className="stat">
          <b>{count("partial")}</b>
          <span>일부 확보</span>
        </div>
        <div className="stat">
          <b>{count("pending") + count("inFlight")}</b>
          <span>대기</span>
        </div>
        <div className="stat">
          <b>{count("failed")}</b>
          <span>실패</span>
        </div>
        <div className="stat">
          <b>{count("skipped")}</b>
          <span>건너뜀</span>
        </div>
        <div className="stat">
          <b>{assetStat.stored}</b>
          <span>
            이미지 저장{assetStat.thumb ? ` (축소본 ${assetStat.thumb})` : ""} · {(assetStat.bytes / 1048576).toFixed(1)}MB
          </span>
        </div>
        <div className="stat">
          <b>{assetStat.failed}</b>
          <span>이미지 실패</span>
        </div>
        {job.options.includeImages && assetStat.waiting ? (
          <div className="stat">
            <b>{assetStat.waiting}</b>
            <span>이미지 대기</span>
          </div>
        ) : null}
      </div>
      {running && job.current ? <p className="small muted ellipsis">지금: {job.current}</p> : null}
      {running && rate && left ? (
        <p className="small muted">
          글 하나에 약 {Math.round(rate / 1000)}초 · 남은 {left}개 약 {fmtDuration(rate * left)}
        </p>
      ) : null}
      {job.lastCheckpointAt ? <p className="small muted">마지막 저장 지점: {new Date(job.lastCheckpointAt).toLocaleString()}</p> : null}

      <div className="actions">
        {running ? (
          <button type="button" className="ui-btn" onClick={onPause}>
            일시정지
          </button>
        ) : (
          <button type="button" className="ui-btn ui-btn-primary" disabled={busyElsewhere || job.status === "finished"} onClick={onStart}>
            {job.status === "queued" ? "시작" : "이어받기"}
          </button>
        )}
        <button type="button" className="ui-btn" disabled={running || !followUp.failed} onClick={retryFailed}>
          실패만 다시
        </button>
        {count("partial") ? (
          <button type="button" className="ui-btn" disabled={running} onClick={retryPartial} title="댓글이 모자란 글을 다시 열어 '이전 댓글'을 펼쳐 봅니다">
            댓글 모자란 글 다시 ({count("partial")})
          </button>
        ) : null}
        <button
          type="button"
          className="ui-btn"
          disabled={busy || !assetStat.failed}
          onClick={async () => {
            setBusy(true);
            const n = await engineForAssets().retryFailedAssets(job.id);
            setBusy(false);
            setMessage({ kind: "ok", text: `이미지 ${n}개를 다시 시도했습니다.` });
            await onChanged();
          }}
        >
          이미지 실패 다시
        </button>
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !exportable} onClick={exportNow}>
          {job.status === "finished" ? ".afterlog로 저장" : "지금까지 .afterlog로 저장"}
        </button>
        <button type="button" className="ui-btn" disabled={busy || !exportable} onClick={exportHtml} title="앱 없이 브라우저에서 바로 보는 HTML(이미지 포함). 고치거나 다시 내보내려면 .afterlog를 쓰세요">
          HTML로 저장
        </button>
        <span className="spacer" />
        <button type="button" className="ui-btn is-danger" disabled={running} onClick={removeJob}>
          작업 지우기
        </button>
      </div>

      <table className="results">
        <thead>
          <tr>
            <th>#</th>
            <th>상태</th>
            <th>글</th>
            <th>댓글(표시/확보)</th>
            <th>메모</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((t, i) => (
            <PostRow key={t.id} n={i + 1} task={t} capture={caps.find((c) => c.taskId === t.id) ?? null} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} job={job} />
          ))}
        </tbody>
      </table>
      <Diagnostics job={job} />
    </section>
  );
}

const REASON_LABEL: Record<SelectReason, string> = { authored: "쓴 글", commented: "댓글 단 글", search: "검색", list: "목록", url: "주소" };

function PostRow({ n, task, capture, open, onToggle, job }: { n: number; task: Task; capture: Capture | null; open: boolean; onToggle(): void; job: Job }) {
  const [verified, setVerified] = useState(!!task.result?.userVerified);
  const preview = useMemo(() => {
    if (!open || !capture) return null;
    const d = parseBandHtml(capture.html).documents.find((x) => x.format === "band-post");
    if (!d) return null;
    const names = new Map(d.identities.map((i) => [i.key, i.name]));
    return d.entries.map((e) => ({ id: e.tempId, who: e.authorKey ? names.get(e.authorKey) ?? "?" : "?", reply: e.kind === "comment" && e.parentTempId !== d.entries[0].tempId, text: blocksToPlainText(e.blocks), time: e.time?.raw }));
  }, [open, capture]);
  const c = task.result;
  // 글 제목: 한 번 누르면 내용 펼치기, 두 번 누르면 밴드에서 열기(두 번 누를 때 펼침이 깜빡이지 않게 한 번 누름은 잠깐 기다렸다 처리)
  const clickTimer = useRef<number | null>(null);
  const openBand = () => window.open(task.url, "_blank", "noopener");
  return (
    <>
      <tr className={`st-${task.status}`}>
        <td>{n}</td>
        <td>{TASK_LABEL[task.status]}</td>
        <td className="ellipsis">
          {job.scope === "selection" && task.reasons?.length ? <span className="reason-tags">{task.reasons.map((r) => REASON_LABEL[r]).join(" · ")}</span> : null}
          <button
            type="button"
            className="post-title"
            title={`한 번 누르면 내용 보기 · 두 번 누르면 밴드에서 열기\n${task.url}`}
            aria-expanded={open}
            onClick={() => {
              if (clickTimer.current) window.clearTimeout(clickTimer.current);
              clickTimer.current = window.setTimeout(() => {
                clickTimer.current = null;
                onToggle();
              }, 250);
            }}
            onDoubleClick={() => {
              if (clickTimer.current) window.clearTimeout(clickTimer.current);
              clickTimer.current = null;
              openBand();
            }}
          >
            {c?.title ?? task.url}
          </button>
        </td>
        <td>{c?.commentsFound !== undefined ? `${c.commentsShown ?? "?"} / ${c.commentsFound}` : ""}</td>
        <td className="small">
          {c?.matches?.length ? (
            <span className="reason-tags">일치: {c.matches.map((m) => `${m.where === "body" ? "본문" : `댓글 ${m.index + 1}`} ${m.terms.join("·")}`).join(", ")}</span>
          ) : null}
          {task.errorText ?? (c?.outOfRange ? "기간 밖" : "")}
          {capture ? (
            <button type="button" className="ui-link small" onClick={onToggle}>
              {open ? "닫기" : "로컬 확인"}
            </button>
          ) : null}
          <a className="ui-link small band-link" href={task.url} target="_blank" rel="noreferrer">
            밴드에서 열기 ↗
          </a>
        </td>
      </tr>
      {open && !preview ? (
        <tr className="preview-row">
          <td colSpan={5}>
            <p className="small muted">아직 저장한 내용이 없습니다. 제목을 두 번 누르거나 '밴드에서 열기'로 원래 글을 확인하세요.</p>
          </td>
        </tr>
      ) : null}
      {open && preview ? (
        <tr className="preview-row">
          <td colSpan={5}>
            <p className="small muted">
              수집한 전체 내용을 이 컴퓨터에서만 보여 줍니다(글 1 · 댓글·답글 {preview.length - 1}개). 원래 화면과 비교해 맞으면 체크하세요(진단에는 체크 여부만 남습니다).{" "}
              <a className="ui-link" href={task.url} target="_blank" rel="noreferrer">
                밴드에서 원래 글 열기 ↗
              </a>
            </p>
            <ol className="capture-preview">
              {preview.map((p) => (
                <li key={p.id} className={p.reply ? "is-reply" : undefined}>
                  <b>{p.who}</b> <span className="muted small">{p.time}</span>
                  <div className="preview-text">{p.text}</div>
                </li>
              ))}
            </ol>
            <label className="check">
              <input
                type="checkbox"
                checked={verified}
                onChange={async (e) => {
                  setVerified(e.target.checked);
                  await cdb().tasks.update(task.id, { result: { ...task.result, userVerified: e.target.checked } });
                  await new DiagRecorder(job.id, job.options.diagnostics).event(task.id, { stage: "userCheck", state: e.target.checked ? "ok" : "unknown" });
                }}
              />
              원래 화면과 내용이 맞음
            </label>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Diagnostics({ job }: { job: Job }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [withStructure, setWithStructure] = useState(true);
  const make = async () => {
    setErr(null);
    try {
      // 방금 한 '내용 맞음' 체크까지 반영되도록 DB에서 새로 읽는다
      const fresh = await cdb().tasks.where("jobId").equals(job.id).toArray();
      setText(await buildDiagnosticText(job, fresh, { includeStructure: withStructure }));
    } catch (e) {
      setText(null);
      setErr((e as Error).message);
    }
  };
  return (
    <details className="diag">
      <summary>문제 진단 (개발자에게 보낼 파일 만들기)</summary>
      {!job.options.diagnostics ? <p className="small muted">이 작업은 진단 기록을 끄고 실행했습니다.</p> : null}
      <p className="small">
        수집 단계별 결과(화면 인식·필요한 부분 발견 여부·로딩 시간 구간·댓글 수 일치 여부·실패 코드)만 담습니다. <b>본문·이름·소개·밴드명·주소·글 번호·사진·파일명·원래 날짜와 시각은 들어가지 않습니다.</b>
        파일은 자동으로 보내지 않으며, 아래에 보이는 내용 그대로 저장됩니다. 완벽한 익명성을 보장한다는 뜻은 아니니 저장 전에 한 번 확인해 주세요.
      </p>
      <label className="check">
        <input type="checkbox" checked={withStructure} onChange={(e) => setWithStructure(e.target.checked)} /> 실패한 화면의 구조 표본 포함 (태그 종류와 뼈대만, 글자·클래스 이름 없음)
      </label>
      <div className="actions">
        <button type="button" className="ui-btn" onClick={make}>
          진단 내용 보기
        </button>
        {text ? (
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => download(new Blob([text], { type: "application/json" }), DIAG_FILE_NAME)}>
            진단 파일 저장 ({DIAG_FILE_NAME})
          </button>
        ) : null}
        <button
          type="button"
          className="ui-btn"
          onClick={async () => {
            await deleteDiagnostics(job.id);
            setText(null);
          }}
        >
          진단 기록 지우기
        </button>
      </div>
      {err ? <p className="notice error">{err}</p> : null}
      {text ? <pre className="diag-json" data-testid="diag-json">{text}</pre> : null}
      <p className="small muted">진단 기록은 최근 작업 3개·5MB·7일까지만 보관하고 자동으로 지웁니다. 지워도 수집한 글은 그대로입니다.</p>
    </details>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Manager />
  </StrictMode>,
);

/** 보관 파일 내용 보기 + 모자란 자료 이어 수집(가져오자마자 수집하지 않음) */
function ArchiveView({ archive, onClose, onResume }: { archive: { r: ArchiveReadResult; summary: ArchiveSummary }; onClose(): void; onResume(): void }) {
  const { r, summary: sm } = archive;
  const assetBySha = useMemo(() => new Map(r.manifest.assets.map((a) => [a.sha256, a])), [r]);
  const dataUrlOf = async (path: string, mime: string) => {
    const bytes = r.files[path];
    return bytes ? blobToDataUrl(new Blob([bytes as BlobPart], { type: mime })) : null;
  };
  const openHtml = (html: string) => {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const openDoc = async (id: string) => {
    const doc = r.data.documents.find((d) => d.id === id);
    if (!doc) return;
    const { renderDocumentHtml, usedAssetIds } = await import("../../src/exporters/html");
    const urls = new Map<string, string>();
    for (const aid of usedAssetIds(doc)) {
      const m = r.manifest.assets.find((a) => a.id === aid);
      const u = m ? await dataUrlOf(m.path, m.mime) : null;
      if (u) urls.set(aid, u);
    }
    openHtml(renderDocumentHtml(doc, urls, "light"));
  };
  const openProfile = async (rec: BandProfileRecord) => {
    const urls = new Map<string, string>();
    for (const ref of profileImages(rec)) {
      const m = ref.sha256 ? assetBySha.get(ref.sha256) : undefined;
      const u = m ? await dataUrlOf(m.path, m.mime) : null;
      if (u) urls.set(ref.src, u);
    }
    openHtml(renderProfileHtml(rec, (i) => urls.get(i.src) ?? null, { generator: `AFTERLOG Collector ${COLLECTOR_VERSION}` }));
  };
  const nResume = sm.resume.posts.length + sm.resume.profiles.length;
  return (
    <section className="card archive-view">
      <div className="job-head">
        <h2>보관 파일: {sm.title}</h2>
        <button type="button" className="ui-link" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="small muted">
        {sm.producer === "afterlog-collector" ? "수집 확장" : sm.producer === "afterlog-web" ? "AFTERLOG 사이트·로컬 실행판" : sm.producer || "만든 곳 모름"} v{sm.appVersion} · {new Date(sm.exportedAt).toLocaleString()} 저장
        {sm.missingParts.length ? ` · 빠진 파트 ${sm.missingParts.join(", ")}번(그 파트의 이미지 없음)` : ""}
      </p>
      <p>
        글 {sm.docs.filter((d) => d.format === "band-post").length}개 · 댓글 모음 {sm.docs.filter((d) => d.format === "band-member-comments").length}개 · 프로필 {sm.profiles.length}명
      </p>
      <div className="row">
        <button type="button" className="ui-btn ui-btn-primary" disabled={!nResume} onClick={onResume} title="댓글이 모자란 글·실패한 글·스토리를 다 못 모은 프로필만 다시 엽니다">
          부족한 자료 이어 수집 ({sm.resume.posts.length ? `글 ${sm.resume.posts.length}` : ""}
          {sm.resume.posts.length && sm.resume.profiles.length ? " · " : ""}
          {sm.resume.profiles.length ? `프로필 ${sm.resume.profiles.length}` : ""}
          {!nResume ? "없음" : ""})
        </button>
      </div>
      {sm.notResumable ? <p className="small muted">모자란 자료 {sm.notResumable}개는 원래 주소가 파일에 없어 이어 수집할 수 없습니다(열람은 됩니다).</p> : null}
      <p className="small muted">이어 수집으로 새로 받은 자료는 새 작업으로 저장됩니다. AFTERLOG에서 기존 프로젝트에 '지금 프로젝트에 합치기'로 넣으면 같은 글에는 새 댓글만 보태집니다.</p>
      {sm.profiles.length ? (
        <>
          <h3>프로필</h3>
          <ul className="plain-list">
            {sm.profiles.map((p, i) => (
              <li key={i}>
                <button type="button" className="ui-link" onClick={() => void openProfile(p.record)}>
                  {profileSummary(p.record)}
                </button>
                {p.needsMore ? <small className="muted"> · 보완 필요</small> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {sm.docs.length ? (
        <>
          <h3>글·댓글 모음</h3>
          <ul className="plain-list archive-docs">
            {sm.docs.map((d) => (
              <li key={d.id}>
                <button type="button" className="ui-link" onClick={() => void openDoc(d.id)}>
                  {d.title}
                </button>
                <small className="muted">
                  {" "}
                  · 댓글 {d.comments}
                  {d.short ? " · 댓글 모자람" : ""}
                </small>
                {d.url ? (
                  <a className="ui-link small" href={d.url} target="_blank" rel="noreferrer">
                    {" "}
                    밴드에서 열기 ↗
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

async function stopFollow(jobId: string) {
  const job = await cdb().jobs.get(jobId);
  if (!job?.options.follow) return;
  await cdb().jobs.update(jobId, { status: "finished", finishedAt: new Date().toISOString(), options: { ...job.options, follow: { ...job.options.follow, active: false } } });
}
