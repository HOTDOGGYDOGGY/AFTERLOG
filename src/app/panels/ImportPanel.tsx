import { SITE } from "../shell/Shell";
import { useState } from "react";
import { analyzeFiles, commitImport, type PendingImport } from "../../importers/importFiles";
import { profileSummary } from "../../importers/band/profile";
import { blocksToPlainText } from "../../importers/band/html";
import { createProject } from "../../storage/repo";
import { describeStorageError } from "../../storage/db";
import type { DocumentData } from "../../domain/types";
import type { LineInfo } from "../../importers/band/text";
import { pickFiles } from "../download";
import { AFTERLOG_FORMAT } from "../../archive/format";

const FORMAT_LABEL = { "band-post": "글과 댓글", "band-member-comments": "댓글 모음" } as const;
const KIND_LABEL = { "band-collector-capture": "수집기", "band-saved-page": "저장 페이지", "band-html-fragment": "HTML 조각", "band-plain-text": "텍스트 복사" } as const;
const LINE_LABEL: Record<LineInfo["cls"], string> = { content: "내용", meta: "정보", ui: "UI", blank: "", unclassified: "미분류" };

/** 텍스트 입력의 줄별 분류. 사라진 줄이 없는지 확인할 수 있게 전부 보여준다. */
function LineReview({ lines }: { lines: LineInfo[] }) {
  const unc = lines.filter((l) => l.cls === "unclassified").length;
  return (
    <details className="line-review">
      <summary className="small">
        원문 줄 분류 보기 ({lines.length}줄{unc ? ` · 미분류 ${unc}` : ""})
      </summary>
      <ol className="line-list">
        {lines.map((l) => (
          <li key={l.n} className={`ln-${l.cls}`} title={l.note}>
            <span className="ln-n">{l.n}</span>
            <span className="ln-cls">{LINE_LABEL[l.cls]}</span>
            <span className="ln-t">{l.text || " "}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** .afterlog 프로젝트 파일인가(확장자, 또는 zip 안의 manifest.json 형식) */
async function isAfterlogFile(f: File): Promise<boolean> {
  if (/\.afterlog$/i.test(f.name)) return true;
  if (!/\.zip$/i.test(f.name)) return false;
  try {
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (x) => x.name === "manifest.json" });
    const m = files["manifest.json"];
    return !!m && JSON.parse(strFromU8(m))?.format === AFTERLOG_FORMAT;
  } catch {
    return false;
  }
}

export function ImportPanel({
  projectId,
  onImported,
  onOpenProjectFiles,
  mergeTargetTitle,
  compact,
  variant,
}: {
  projectId: string | null;
  onImported(projectId: string, docs: DocumentData[]): void;
  /** .afterlog(수집 확장·프로젝트 저장 파일)를 넣었을 때: 새 프로젝트로 열거나(new) 지금 프로젝트에 합친다(merge) */
  onOpenProjectFiles?(files: File[], mode: "new" | "merge" | "ask"): Promise<void>;
  /** 합칠 수 있는 지금 프로젝트 이름(없으면 합치기 선택지를 보이지 않음) */
  mergeTargetTitle?: string | null;
  compact?: boolean;
  /** start: 처음 화면(파일 열기·붙여넣기 두 동작만 주요 버튼) */
  variant?: "start";
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState("");
  const analyze = async (files: File[], pasted?: string) => {
    if (!files.length && !pasted?.trim()) return;
    setError(null);
    setBusy(true);
    try {
      // .afterlog는 밴드 저장 페이지가 아니라 프로젝트 파일: 프로젝트로 연다(수집 확장이 만든 파일 포함)
      const flags = await Promise.all(files.map(isAfterlogFile));
      const projectFiles = files.filter((_, i) => flags[i]);
      if (projectFiles.length) {
        if (!onOpenProjectFiles) throw new Error(".afterlog 파일은 상단 프로젝트 이름 → '파일 열기 (.afterlog)'로 여세요.");
        // 지금 프로젝트가 있으면 합칠 내용을 분석해 보여 주고 고르게 한다(합치기 / 새 프로젝트로 열기)
        await onOpenProjectFiles(projectFiles, mergeTargetTitle ? "ask" : "new");
        return;
      }
      const p = await analyzeFiles(files, projectId, pasted);
      setPending(p);
      // 게시글이 하나면 그것을 기본 선택. 여러 개면 임의로 고르지 않고 사용자가 고르게 한다.
      const posts = p.parse.documents.map((d, i) => (d.format === "band-post" ? i : -1)).filter((i) => i >= 0);
      if (posts.length === 1) setSelected(posts);
      else if (posts.length > 1) setSelected([]);
      else setSelected(p.parse.documents.length === 1 ? [0] : []);
      // 프로필은 모두 기본 선택
      setSelectedProfiles(p.profiles.map((_, i) => i));
      setPaste("");
    } catch (e) {
      setError((e as Error).message);
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      let pid = projectId;
      if (!pid) {
        const title = pending.parse.bandName ?? pending.parse.documents[selected[0]]?.title ?? (pending.profiles[selectedProfiles[0]] ? `${pending.profiles[selectedProfiles[0]].record.name ?? "인물"} 프로필` : "새 프로젝트");
        pid = (await createProject(title)).id;
      }
      const docs = await commitImport(pid, pending, selected, selectedProfiles);
      setPending(null);
      onImported(pid, docs);
    } catch (e) {
      setError(describeStorageError(e));
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    const { parse } = pending;
    return (
      <div className="import-review">
        <div className="panel-head">
          <strong>가져오기 검토</strong>
          <button type="button" className="ui-link" onClick={() => setPending(null)}>
            취소
          </button>
        </div>
        <p className="small">
          <span className="tag">{KIND_LABEL[pending.sourceKind]}</span> <b>{pending.fileName}</b>
          {parse.bandName ? ` · ${parse.bandName}` : ""}
        </p>
        {pending.sourceUrl ? <p className="small muted ellipsis">원래 주소: {pending.sourceUrl}</p> : null}
        {parse.documents.filter((d) => d.format === "band-post").length > 1 ? (
          <p className="notice warn">게시글이 여러 개 들어 있습니다. 가져올 게시글을 직접 골라 주세요.</p>
        ) : null}
        {pending.duplicateOf ? (
          <p className="notice warn">이 프로젝트에 같은 원문을 이미 가져온 적이 있습니다({new Date(pending.duplicateOf.importedAt).toLocaleString()}). 가져오면 새 문서로 추가되고 기존 문서는 그대로 남습니다.</p>
        ) : null}
        {parse.notes.map((n, i) => (
          <p key={i} className="notice warn">
            {n}
          </p>
        ))}
        {pending.warnings.map((n, i) => (
          <p key={i} className="notice">
            {n}
          </p>
        ))}
        {parse.documents.map((d, i) => {
          const comments = d.entries.filter((e) => e.kind === "comment").length;
          const unclassified = d.entries.filter((e) => e.kind === "unclassified").length;
          const replies = d.entries.filter((e) => e.kind === "comment" && e.parentTempId !== null && e.parentTempId !== d.entries[0]?.tempId).length;
          const first = d.entries[0];
          return (
            <label key={i} className={`import-doc${selected.includes(i) ? " is-selected" : ""}`}>
              <input
                type="checkbox"
                checked={selected.includes(i)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, i].sort() : s.filter((x) => x !== i)))}
              />
              <div>
                <div className="import-doc-title">
                  <span className="tag">{FORMAT_LABEL[d.format]}</span> {d.title}
                </div>
                <div className="small muted">
                  {d.format === "band-post" ? `게시글 1 · 댓글 ${comments - replies} · 답글 ${replies}` : `댓글 ${comments}`} · 인물 {d.identities.length}
                  {unclassified ? ` · 미분류 ${unclassified}` : ""} · 판정 {d.confidence === "high" ? "확실" : "검토 필요"}
                </div>
                {first ? <div className="small ellipsis">{blocksToPlainText(first.blocks).slice(0, 80)}</div> : null}
                {d.issues.length ? (
                  <ul className="issue-list small">
                    {d.issues.map((iss, k) => (
                      <li key={k}>{iss.message}</li>
                    ))}
                  </ul>
                ) : null}
                <details className="small muted">
                  <summary>판정 근거</summary>
                  <ul>
                    {d.evidence.map((ev, k) => (
                      <li key={k}>{ev}</li>
                    ))}
                  </ul>
                </details>
              </div>
            </label>
          );
        })}
        {pending.profiles.map((pr, i) => {
          const r = pr.record;
          return (
            <label key={`p${i}`} className={`import-doc${selectedProfiles.includes(i) ? " is-selected" : ""}`}>
              <input
                type="checkbox"
                checked={selectedProfiles.includes(i)}
                onChange={(e) => setSelectedProfiles((s) => (e.target.checked ? [...s, i].sort() : s.filter((x) => x !== i)))}
              />
              <div>
                <div className="import-doc-title">
                  <span className="tag">{r.surface === "profilePopup" ? "프로필 팝업" : "인물 프로필"}</span> {r.name ?? "이름 확인 못 함"}
                </div>
                <div className="small muted">
                  {profileSummary(r)} · {pr.fileName}
                </div>
                {r.notes.map((n) => (
                  <div key={n} className="small muted">
                    {n}
                  </div>
                ))}
              </div>
            </label>
          );
        })}
        <p className="small muted">
          이미지 파일 {parse.imageRefs.length - pending.missingImages.length}/{parse.imageRefs.length}개 확보
          {pending.linkOnlyImages.length ? ` · ${pending.linkOnlyImages.length}개는 링크만 있습니다(자동으로 내려받지 않음)` : ""}
          {pending.missingImages.length ? ` · 파일이 없는 이미지는 '미확보'로 남고 나중에 연결할 수 있습니다.` : ""}
        </p>
        {pending.lines ? <LineReview lines={pending.lines} /> : null}
        {error ? <p className="notice error">{error}</p> : null}
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy || (!selected.length && !selectedProfiles.length)} onClick={doImport}>
          {busy ? "가져오는 중…" : `선택한 ${selected.length + selectedProfiles.length}개 가져오기`}
        </button>
        <p className="small muted">원본 HTML은 프로젝트 안에 그대로 보관됩니다.</p>
      </div>
    );
  }

  if (variant === "start") {
    return (
      <div
        className={`import-start${over ? " is-over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void analyze(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="import-start-actions">
          <button type="button" className="ui-btn ui-btn-primary ui-btn-large" disabled={busy} onClick={async () => analyze(await pickFiles(".afterlog,.html,.htm,.zip,.txt,image/*", true))}>
            {busy ? "분석 중…" : "파일 열기"}
          </button>
          <button type="button" className="ui-btn ui-btn-large" aria-expanded={pasteOpen} onClick={() => setPasteOpen(!pasteOpen)}>
            텍스트 붙여넣기
          </button>
        </div>
        <p className="small muted">
          밴드 저장 페이지(.html + _files 폴더 또는 .zip) · 게시글 HTML·텍스트 복사(.txt) · 수집 확장·프로젝트 저장 파일(.afterlog, 여러 파트면 함께 선택) · 여기로 끌어다 놓아도 됩니다. 파일은 이 브라우저 안에서만 처리됩니다.
        </p>
        {pasteOpen ? (
          <div className="paste-box">
            <label className="field">
              <span>게시글 영역 HTML 또는 화면에서 복사한 글</span>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} autoFocus />
            </label>
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !paste.trim()} onClick={() => analyze([], paste)}>
              분석
            </button>
          </div>
        ) : null}
        {error ? <p className="notice error">{error}</p> : null}
        <details className="collector-box">
          <summary>글이 많다면: 수집 확장프로그램(크롬·PC)</summary>
          <p className="small">
            밴드에 로그인한 크롬에서 글 하나·여러 글·글 목록을 한 번에 모아 <b>.afterlog</b> 파일로 저장합니다. 그 파일은 상단 프로젝트 이름 → '파일 열기'로 엽니다.
          </p>
          <ol className="small">
            <li>
              <a href={`${SITE}afterlog-collector.zip`} download>
                수집 확장 받기 (afterlog-collector.zip)
              </a>{" "}
              → 압축 풀기
            </li>
            <li>크롬 주소창에 chrome://extensions → 오른쪽 위 '개발자 모드' 켜기</li>
            <li>'압축해제된 확장 프로그램 로드' → 압축을 푼 폴더 선택</li>
            <li>밴드 글이나 글 목록을 열고 확장 아이콘(A) → '이 글 저장' 또는 '이 목록의 글 모두 저장'</li>
          </ol>
          <p className="small muted">실제 밴드 화면에서의 동작은 아직 검증 전입니다. 문제가 생기면 수집 관리의 '문제 진단' 파일(본문·이름·주소 없음)을 전달해 주세요.</p>
        </details>
      </div>
    );
  }

  return (
    <div className={`import-panel${compact ? " is-compact" : ""}`}>
      <div
        className={`dropzone${over ? " is-over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void analyze(Array.from(e.dataTransfer.files));
        }}
      >
        <strong>밴드 기록 가져오기</strong>
        <p className="small">
          밴드에서 게시글을 연 상태로 <b>Ctrl+S (다른 이름으로 저장 → 웹페이지, 전체)</b>한 파일을 넣어 주세요.
          <br />
          .html 파일과 같이 생긴 <b>_files 폴더의 이미지</b>를 함께 선택하거나, 둘을 묶은 <b>.zip</b>을 넣으면 프로필·이미지까지 가져옵니다. 게시글 영역 HTML을 복사한 .txt나 화면 텍스트를 복사한 .txt도 됩니다.
        </p>
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={async () => analyze(await pickFiles(".afterlog,.html,.htm,.zip,.txt,image/*", true))}>
          {busy ? "분석 중…" : "파일 선택"}
        </button>
        <p className="small muted">파일은 이 브라우저 안에서만 처리되며 어디로도 전송되지 않습니다.</p>
      </div>
      <details className="collector-box" open={!compact}>
        <summary>
          <b>글이 많다면: 수집 확장프로그램</b> <span className="small muted">(크롬·PC)</span>
        </summary>
        <p className="small">
          밴드에 로그인한 크롬에서 글 하나, 여러 글, 글 목록 전체를 한 번에 모아 <b>.afterlog</b> 파일로 저장합니다. 그 파일을 '프로젝트 → 불러오기'로 열면 됩니다.
        </p>
        <ol className="small">
          <li>
            <a href={`${SITE}afterlog-collector.zip`} download>
              수집 확장 받기 (afterlog-collector.zip)
            </a>{" "}
            → 압축 풀기
          </li>
          <li>크롬 주소창에 chrome://extensions → 오른쪽 위 '개발자 모드' 켜기</li>
          <li>'압축해제된 확장 프로그램 로드' → 압축을 푼 폴더 선택</li>
          <li>밴드 글이나 글 목록을 열고 확장 아이콘(A) → '이 글 저장' 또는 '이 목록의 글 모두 저장'</li>
        </ol>
        <p className="small muted">실제 밴드 화면에서의 동작은 아직 검증 전입니다. 문제가 생기면 수집 관리의 '문제 진단'에서 진단 파일(본문·이름·주소 없음)을 저장해 전달해 주세요.</p>
      </details>
      <div className="paste-box">
        <label className="field">
          <span>또는 붙여넣기 (게시글 영역 HTML 또는 화면에서 복사한 글)</span>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={compact ? 3 : 5} placeholder="여기에 붙여넣고 '분석'을 누르세요" />
        </label>
        <button type="button" className="ui-btn" disabled={busy || !paste.trim()} onClick={() => analyze([], paste)}>
          분석
        </button>
      </div>
      {error ? <p className="notice error">{error}</p> : null}
      <details className="small muted support">
        <summary>지원 범위</summary>
        <ul>
          <li>밴드 글과 댓글 — 저장 페이지(HTML·ZIP): 지원, 실제 샘플로 검증</li>
          <li>밴드 글과 댓글 — 게시글 영역 HTML 조각(TXT·붙여넣기): 지원, 이미지는 링크만</li>
          <li>밴드 글과 댓글 — 화면 텍스트 복사: 지원(대체 경로). 답글 관계·정확한 시각·사진 없음</li>
          <li>멤버 댓글 모음(저장 페이지 뒤쪽 목록): 지원, 전체 목록인지는 확인 필요</li>
          <li>여러 글·글 목록 한꺼번에: 수집 확장프로그램으로 지원(가짜 밴드 화면에서 검증, 실제 밴드 미검증)</li>
          <li>프로필·스토리·표정 종류/반응자·인물별 댓글 목록·밴드 채팅: 아직 지원하지 않음 (실제 샘플 필요)</li>
          <li>카카오톡·네이버카페·트위터·DM: 위쪽 플랫폼 줄에서 기존 도구로 사용</li>
        </ul>
      </details>
    </div>
  );
}
