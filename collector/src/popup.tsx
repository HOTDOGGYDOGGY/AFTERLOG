import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createJob, DEFAULT_OPTIONS } from "./engine";
import { parseBandUrl, postKey, type BandUrl } from "./urls";
import "./collector.css";

type View = { kind: "loading" } | { kind: "not-band" } | { kind: "band"; url: BandUrl; hasPostCard: boolean; tabId: number };

function Popup() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // ?tabId= 는 수집 관리·자동 검사에서 특정 탭을 가리킬 때만 쓴다
      const forced = Number(new URLSearchParams(location.search).get("tabId"));
      const tab = forced ? await chrome.tabs.get(forced) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const url = tab?.url ? parseBandUrl(tab.url) : null;
      if (!tab?.id || !url) return setView({ kind: "not-band" });
      let hasPostCard = false;
      try {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.querySelectorAll(".cPostCard").length });
        hasPostCard = (r?.result as number) === 1;
      } catch {
        /* 권한 없는 화면 */
      }
      setView({ kind: "band", url, hasPostCard, tabId: tab.id });
    })();
  }, []);

  const openManager = async (jobId?: string) => {
    const u = chrome.runtime.getURL(`manager.html${jobId ? `?job=${jobId}&autostart=1` : ""}`);
    await chrome.tabs.create({ url: u });
    window.close();
  };

  const saveThisPost = async () => {
    if (view.kind !== "band") return;
    try {
      const u = view.url;
      const key = u.kind === "post" ? postKey(u.bandNo, u.postNo) : `tab:${view.tabId}:${Date.now()}`;
      const job = await createJob({
        scope: "current-post",
        label: u.kind === "post" ? `글 ${u.postNo}` : "지금 열린 글",
        options: { ...DEFAULT_OPTIONS, skipCaptured: false },
        bandNo: u.bandNo,
        posts: [{ url: u.canonical, key, tabId: view.tabId }],
      });
      await openManager(job.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveList = async () => {
    if (view.kind !== "band") return;
    const u = view.url;
    const job = await createJob({
      scope: "list",
      label: u.kind === "member-list" ? "멤버 작성글 목록" : "밴드 글 목록",
      options: DEFAULT_OPTIONS,
      bandNo: u.bandNo,
      lists: [u.canonical],
    });
    await openManager(job.id);
  };

  return (
    <div className="popup-body">
      <header className="popup-head">
        <strong>AFTERLOG</strong> <span className="muted">밴드 기록 저장</span>
      </header>
      {view.kind === "loading" ? <p className="muted">화면 확인 중…</p> : null}
      {view.kind === "not-band" ? <p className="muted">밴드(band.us) 게시글이나 글 목록 화면에서 눌러 주세요.</p> : null}
      {view.kind === "band" ? (
        <div className="popup-actions">
          {view.url.kind === "post" || view.hasPostCard ? (
            <button type="button" className="ui-btn ui-btn-primary" onClick={saveThisPost}>
              이 글 저장
            </button>
          ) : null}
          {view.url.kind === "feed" || (view.url.kind === "member-list" && view.url.list === "post") ? (
            <button type="button" className="ui-btn" onClick={saveList}>
              이 목록의 글 모두 저장
            </button>
          ) : null}
          {view.url.kind === "band-other" && !view.hasPostCard ? <p className="muted small">이 화면은 아직 저장할 수 없습니다. 게시글이나 글 목록을 열어 주세요.</p> : null}
          <p className="muted small">열린 탭은 읽기만 하고 다른 곳으로 이동시키지 않습니다. 접힌 댓글은 먼저 펼쳐 두세요.</p>
        </div>
      ) : null}
      {error ? <p className="notice error">{error}</p> : null}
      <button type="button" className="ui-link" onClick={() => openManager()}>
        수집 관리 열기 (여러 글·기간·진단)
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
