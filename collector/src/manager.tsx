import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChromeBrowser } from "./chromeBrowser";
import { COLLECTOR_VERSION } from "./config";
import { cdb, type Capture, type Job, type Task } from "./db";
import { createJob, DEFAULT_OPTIONS, Engine } from "./engine";
import { exportJob } from "./exporter";
import { buildDiagnosticText, deleteDiagnostics, DiagRecorder } from "./diagnostics/recorder";
import { DIAG_FILE_NAME } from "./diagnostics/serializer";
import { parseBandUrl, parsePostUrlList, postKey } from "./urls";
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

function Manager() {
  const params = new URLSearchParams(location.search);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sel, setSel] = useState<string | null>(params.get("job"));
  const [creating, setCreating] = useState(!params.get("job"));
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
    if (kind !== "post" && kind !== "list") return;
    autostarted.current = true;
    void (async () => {
      const created = await jobFromPage(kind, params.get("url") ?? "", Number(params.get("tabId")) || undefined);
      if ("error" in created) {
        history.replaceState(null, "", location.pathname);
        setMessage({ kind: "error", text: created.error });
        return;
      }
      history.replaceState(null, "", `?job=${created.id}`);
      setSel(created.id);
      setCreating(false);
      await reload();
      void start(created.id);
    })();
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  const job = jobs.find((j) => j.id === sel) ?? null;

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
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setCreating(true)}>
            새 수집
          </button>
          <ul>
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  aria-current={j.id === sel && !creating}
                  onClick={() => {
                    setSel(j.id);
                    setCreating(false);
                  }}
                >
                  <span className="ellipsis">{j.bandName ?? j.label}</span>
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
          {creating || !job ? (
            <NewJob
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
            />
          )}
        </main>
      </div>
    </div>
  );
}

/** 밴드 화면의 저장 막대(content.js)가 연 요청을 작업으로 만든다. 주소는 밴드 주소만 받는다. */
export async function jobFromPage(kind: "post" | "list", rawUrl: string, tabId?: number): Promise<{ id: string } | { error: string }> {
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
  const job = await createJob({ scope: "list", label: member ? "멤버 작성글 목록" : "밴드 글 목록", options: DEFAULT_OPTIONS, bandNo: u.bandNo, lists: [list] });
  return { id: job.id };
}

function NewJob({ onCreated }: { onCreated(id: string): void }) {
  const [mode, setMode] = useState<"urls" | "list">("urls");
  const [urls, setUrls] = useState("");
  const [listUrl, setListUrl] = useState("");
  const [opts, setOpts] = useState({ ...DEFAULT_OPTIONS });
  const [err, setErr] = useState<string | null>(null);
  const parsed = useMemo(() => parsePostUrlList(urls), [urls]);

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
    } else {
      const u = parseBandUrl(listUrl);
      if (!u || !(u.kind === "feed" || (u.kind === "member-list" && u.list === "post")))
        return setErr("밴드 글 목록(https://band.us/band/숫자) 또는 멤버 작성글 목록 주소를 넣어 주세요.");
      const job = await createJob({ scope: "list", label: u.kind === "feed" ? "밴드 글 목록" : "멤버 작성글 목록", options: opts, bandNo: u.bandNo, lists: [u.canonical] });
      onCreated(job.id);
    }
  };

  return (
    <section className="card">
      <h2>새 수집</h2>
      <p className="muted small">밴드에 로그인한 브라우저에서 실행하세요. 수집용 창이 하나 열리고 그 안에서만 글을 차례로 엽니다(1.5~3초 간격).</p>
      <div className="seg" role="radiogroup" aria-label="수집 대상">
        <button type="button" role="radio" aria-checked={mode === "urls"} aria-pressed={mode === "urls"} onClick={() => setMode("urls")}>
          글 주소 여러 개
        </button>
        <button type="button" role="radio" aria-checked={mode === "list"} aria-pressed={mode === "list"} onClick={() => setMode("list")}>
          목록에서 글 찾기
        </button>
      </div>
      {mode === "urls" ? (
        <label className="field">
          <span>글 주소 (한 줄에 하나)</span>
          <textarea rows={6} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://band.us/band/12345/post/678" />
          <small className="muted">
            인식한 글 {parsed.posts.length}개{parsed.rejected.length ? ` · 글 주소가 아닌 줄 ${parsed.rejected.length}개는 건너뜀` : ""}
          </small>
        </label>
      ) : (
        <label className="field">
          <span>목록 주소 (밴드 글 목록 또는 멤버 작성글 목록)</span>
          <input value={listUrl} onChange={(e) => setListUrl(e.target.value)} placeholder="https://band.us/band/12345" />
          <small className="muted">목록을 끝까지 스크롤하며 글 주소를 모은 뒤 하나씩 저장합니다. 새 글이 더 나오지 않으면 멈추고 '끝 확인 불가'로 표시합니다.</small>
        </label>
      )}
      <div className="row">
        <label className="field">
          <span>작성일 시작 (선택)</span>
          <input type="date" value={opts.periodFrom ?? ""} onChange={(e) => setOpts({ ...opts, periodFrom: e.target.value || null })} />
        </label>
        <label className="field">
          <span>작성일 끝 (선택, 이 날 포함)</span>
          <input type="date" value={opts.periodTo ?? ""} onChange={(e) => setOpts({ ...opts, periodTo: e.target.value || null })} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={opts.includeImages} onChange={(e) => setOpts({ ...opts, includeImages: e.target.checked })} /> 이미지·프로필 사진 파일도 저장
      </label>
      <label className="check">
        <input type="checkbox" checked={opts.skipCaptured} onChange={(e) => setOpts({ ...opts, skipCaptured: e.target.checked })} /> 이 확장으로 이미 저장한 글은 건너뛰기
      </label>
      <label className="check">
        <input type="checkbox" checked={opts.diagnostics} onChange={(e) => setOpts({ ...opts, diagnostics: e.target.checked })} /> 문제 진단 기록 남기기 (본문·이름·주소 없이 단계별 결과만, 이 컴퓨터에만 보관)
      </label>
      <label className="field narrow">
        <span>파일 나누기 기준 (MB)</span>
        <input type="number" min={10} max={1000} value={opts.maxPartMB} onChange={(e) => setOpts({ ...opts, maxPartMB: Math.max(10, Number(e.target.value) || 100) })} />
      </label>
      {err ? <p className="notice error">{err}</p> : null}
      <button type="button" className="ui-btn ui-btn-primary" onClick={submit}>
        수집 시작
      </button>
      <details className="small muted">
        <summary>지원 범위와 검증 수준</summary>
        <ul>
          <li>게시글 본문·작성자·시각·댓글·답글·이미지: 지원 — 저장 페이지 샘플로 구조 확인, 합성 화면에서 통과, <b>실제 밴드 화면에서는 미검증</b></li>
          <li>글 목록 스크롤로 글 찾기: 지원 — 합성 화면에서 통과, 실제 밴드 미검증</li>
          <li>접힌 댓글 자동 펼치기: 미지원(실제 버튼 구조 확인 전이라 누르지 않음). 표시 댓글 수와 비교해 '일부 확보'로 알려 줍니다</li>
          <li>표정 종류·반응자, 프로필·스토리, 인물별 댓글 목록, 채팅: 아직 미지원(실제 화면 샘플 필요)</li>
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
}: {
  job: Job;
  running: boolean;
  busyElsewhere: boolean;
  onStart(): void;
  onPause(): void;
  onChanged(): Promise<void>;
  setMessage(m: { kind: "ok" | "error"; text: string } | null): void;
  engineForAssets(): Engine;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [caps, setCaps] = useState<Capture[]>([]);
  const [assetStat, setAssetStat] = useState({ stored: 0, failed: 0, thumb: 0, bytes: 0 });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ts = await cdb().tasks.where("jobId").equals(job.id).sortBy("order");
      const cs = await cdb().captures.where("jobId").equals(job.id).toArray();
      setTasks(ts);
      setCaps(cs);
      const urls = [...new Set(cs.flatMap((c) => c.imageUrls))];
      const as = (await cdb().assets.bulkGet(urls)).filter(Boolean);
      setAssetStat({
        stored: as.filter((a) => a!.status === "stored").length,
        failed: as.filter((a) => a!.status === "failed").length,
        thumb: as.filter((a) => a!.status === "stored" && a!.quality === "thumbnail").length,
        bytes: as.reduce((n, a) => n + (a!.size || 0), 0),
      });
    })();
  }, [job]);

  const posts = tasks.filter((t) => t.kind === "post");
  const lists = tasks.filter((t) => t.kind === "list");
  const count = (s: Task["status"]) => posts.filter((t) => t.status === s).length;
  const stale = job.status === "running" && !running;

  const exportNow = async () => {
    setBusy(true);
    try {
      const { parts, documents, report } = await exportJob(job.id);
      for (const p of parts) download(p.blob, p.fileName);
      setMessage({
        kind: "ok",
        text: `.afterlog 파일 ${parts.length}개를 받았습니다(글 ${documents}개, 결과: ${report.outcome === "complete" ? "선택 범위 확인 완료" : report.outcome === "partial" ? "일부 미확보" : "끝 확인 불가"}). AFTERLOG의 '프로젝트 → 불러오기'에서 ${parts.length > 1 ? "모든 파트를 함께" : ""} 여세요.`,
      });
    } catch (e) {
      setMessage({ kind: "error", text: `파일 만들기 실패: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const retryFailed = async () => {
    const failed = posts.filter((t) => t.status === "failed");
    await cdb().transaction("rw", cdb().tasks, async () => {
      for (const t of failed) await cdb().tasks.update(t.id, { status: "pending", attempts: 0, notBefore: 0, errorCode: null, errorText: null });
    });
    await onChanged();
    onStart();
  };

  const removeJob = async () => {
    if (!confirm("이 작업과 여기서 모은 글을 이 브라우저에서 지울까요? 이미 받은 .afterlog 파일은 그대로입니다.")) return;
    await cdb().transaction("rw", [cdb().jobs, cdb().tasks, cdb().captures], async () => {
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
        <h2>{job.bandName ?? job.label}</h2>
        <span className={`badge st-${running ? "running" : stale ? "stale" : job.status}`}>{running ? "수집 중" : stale ? "중단됨" : STATUS_LABEL[job.status]}</span>
      </div>
      {job.pauseReason ? <p className="notice warn">{job.pauseReason}</p> : null}
      {running ? <p className="notice">수집은 이 관리 창에서 진행됩니다. 창을 닫으면 멈추며, 다시 열어 '이어받기'를 누르면 남은 글부터 계속합니다.</p> : null}
      {stale ? <p className="notice warn">창이 닫혀 수집이 중단됐습니다. 이미 모은 글은 남아 있습니다. '이어받기'로 계속하세요.</p> : null}
      {job.lastRunVersion && job.lastRunVersion !== COLLECTOR_VERSION ? (
        <p className="notice">확장이 v{job.lastRunVersion}에서 v{COLLECTOR_VERSION}로 업데이트됐습니다. 이어받으면 저장된 주소부터 새 버전으로 계속하며, 이미 모은 글은 그대로 둡니다.</p>
      ) : null}

      <div className="stats">
        {lists.map((l) => (
          <div key={l.id} className="stat wide">
            <b>{l.result?.found ?? 0}</b>
            <span>
              목록에서 찾은 글 · {l.status === "succeeded" ? (l.result?.coverage === "unknown" ? "끝 확인 불가" : l.result?.coverage === "partial" ? "일부만 탐색" : "끝") : "찾는 중"}
            </span>
          </div>
        ))}
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
      </div>
      {running && job.current ? <p className="small muted ellipsis">지금: {job.current}</p> : null}
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
        <button type="button" className="ui-btn" disabled={running || !count("failed")} onClick={retryFailed}>
          실패만 다시
        </button>
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
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !caps.length} onClick={exportNow}>
          {job.status === "finished" ? ".afterlog로 저장" : "지금까지 .afterlog로 저장"}
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
  return (
    <>
      <tr className={`st-${task.status}`}>
        <td>{n}</td>
        <td>{TASK_LABEL[task.status]}</td>
        <td className="ellipsis" title={task.url}>
          {c?.title ?? task.url}
        </td>
        <td>{c?.commentsFound !== undefined ? `${c.commentsShown ?? "?"} / ${c.commentsFound}` : ""}</td>
        <td className="small">
          {task.errorText ?? (c?.outOfRange ? "기간 밖" : "")}
          {capture ? (
            <button type="button" className="ui-link small" onClick={onToggle}>
              {open ? "닫기" : "로컬 확인"}
            </button>
          ) : null}
        </td>
      </tr>
      {open && preview ? (
        <tr className="preview-row">
          <td colSpan={5}>
            <p className="small muted">수집한 내용을 이 컴퓨터에서만 보여 줍니다. 원래 화면과 비교해 맞으면 체크하세요(진단에는 체크 여부만 남습니다).</p>
            <ol className="capture-preview">
              {preview.map((p) => (
                <li key={p.id} className={p.reply ? "is-reply" : undefined}>
                  <b>{p.who}</b> <span className="muted small">{p.time}</span>
                  <div>{p.text.slice(0, 300)}</div>
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
