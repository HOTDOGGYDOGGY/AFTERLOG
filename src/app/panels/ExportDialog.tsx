// 감상용 내보내기(명세 13.3). 범위(이 글/모든 글) · 형식(HTML/PNG/JPG/HTML 복사). 프로젝트 저장(.afterlog)과 분리.
// 출력은 원형 보기와 같은 렌더러·스타일 해석기를 쓰고, 편집 손잡이·메뉴·꾸미기 패널·딤 처리는 넣지 않는다.
import { useRef, useState } from "react";
import { zipSync } from "fflate";
import type { DocumentData } from "../../domain/types";
import { safeName } from "../../exporters/fileName";
import { docStyle, effectiveWidth } from "../../renderers/band/style";
import { downloadBlob } from "../download";
import { Icon } from "../../components/Icon";

type Kind = "html" | "png" | "jpeg" | "copy";

export function ExportDialog({
  doc,
  docs,
  getBlob,
  onClose,
  appTheme,
  projectTitle,
}: {
  /** 지금 연 글(없으면 모든 글만) */
  doc: DocumentData | null;
  docs: DocumentData[];
  getBlob(id: string): Promise<Blob | undefined>;
  onClose(): void;
  appTheme: "light" | "dark";
  projectTitle?: string;
}) {
  const [scope, setScope] = useState<"current" | "all">(doc ? "current" : "all");
  const [kind, setKind] = useState<Kind>("html");
  const [ratio, setRatio] = useState<1 | 2>(2);
  const [maxH, setMaxH] = useState(3000);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const targets = scope === "current" && doc ? [doc] : docs.map((d) => (doc && d.id === doc.id ? doc : d));
  const hiddenPeople = new Set(targets.flatMap((d) => Object.values(d.identities).filter((p) => p.hidden).map((p) => p.displayName)));
  const missing = targets.reduce((n, d) => n + Object.values(d.entries).reduce((m, e) => m + e.blocks.filter((b) => b.type === "image" && !b.assetId).length, 0), 0);
  const multi = targets.length > 1;
  const followsApp = targets.some((d) => docStyle(d.view).documentTheme === "app");

  const run = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      if (kind === "copy") {
        const { documentHtmlSnippet } = await import("../../exporters/html");
        const parts: string[] = [];
        for (const d of targets) parts.push(await documentHtmlSnippet(d, getBlob, appTheme));
        await navigator.clipboard.writeText(parts.join("\n"));
        setProgress("HTML을 클립보드에 복사했습니다(이미지는 데이터로 포함).");
      } else if (kind === "html") {
        const { exportDocumentHtml } = await import("../../exporters/html");
        const files: { name: string; blob: Blob }[] = [];
        for (const d of targets) files.push({ name: `${safeName(d.title)}.html`, blob: await exportDocumentHtml(d, getBlob, appTheme) });
        await deliver(files, `${safeName(projectTitle ?? "AFTERLOG")}_html.zip`);
        setProgress(multi ? `HTML ${files.length}개를 ZIP으로 받았습니다.` : "HTML 파일을 받았습니다.");
      } else {
        abort.current = new AbortController();
        const { exportDocumentPng } = await import("../../exporters/png");
        const files: { name: string; blob: Blob }[] = [];
        let forced = 0;
        for (let i = 0; i < targets.length; i++) {
          const d = targets[i];
          const { pages, forcedCuts } = await exportDocumentPng(d, getBlob, {
            pixelRatio: ratio,
            maxPageHeight: maxH,
            format: kind,
            appTheme,
            signal: abort.current.signal,
            onProgress: (a, t) => setProgress(`${multi ? `글 ${i + 1}/${targets.length} · ` : ""}이미지 만드는 중 ${a}/${t}`),
          });
          forced += forcedCuts;
          const prefix = multi ? `${String(i + 1).padStart(3, "0")}_` : "";
          for (const p of pages) files.push({ name: prefix + p.fileName, blob: p.blob });
        }
        await deliver(files, `${safeName(multi ? projectTitle ?? "AFTERLOG" : targets[0].title)}_${kind === "jpeg" ? "jpg" : "png"}.zip`);
        setProgress(`${files.length}장을 받았습니다.${files.length > 1 ? " (ZIP)" : ""}${forced ? ` 항목·줄 경계를 찾지 못해 강제로 자른 곳이 ${forced}군데 있습니다.` : ""}`);
      }
    } catch (e) {
      const err = e as Error;
      setError(err.name === "AbortError" ? "취소했습니다." : `내보내기 실패: ${err.message}. HTML 저장이나 프로젝트 저장으로 자료를 먼저 확보해 주세요.`);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="panel-head">
          <strong id="export-title">감상용 파일 내보내기</strong>
          <button type="button" className="ui-icon-btn" aria-label="닫기" disabled={busy} onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="panel-body">
          <div className="ui-seg-row">
            <span className="ui-seg-label">범위</span>
            <div className="seg" role="radiogroup" aria-label="범위">
              <button type="button" role="radio" aria-checked={scope === "current"} aria-pressed={scope === "current"} disabled={!doc} onClick={() => setScope("current")}>
                이 글
              </button>
              <button type="button" role="radio" aria-checked={scope === "all"} aria-pressed={scope === "all"} onClick={() => setScope("all")}>
                모든 글 ({docs.length})
              </button>
            </div>
          </div>
          <div className="ui-seg-row">
            <span className="ui-seg-label">형식</span>
            <div className="seg" role="radiogroup" aria-label="형식">
              {(
                [
                  ["html", "HTML"],
                  ["png", "PNG"],
                  ["jpeg", "JPG"],
                  ["copy", "HTML 복사"],
                ] as [Kind, string][]
              ).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {kind === "html" ? (
            <p className="small muted">이미지와 스타일을 모두 담은 파일입니다. 인터넷 없이 열리며, 보는 기기에 같은 글꼴이 없으면 기본 글꼴로 보일 수 있습니다.</p>
          ) : kind === "copy" ? (
            <p className="small muted">스타일을 포함한 HTML을 클립보드에 복사합니다. 이미지는 데이터로 들어가 길어질 수 있습니다.</p>
          ) : (
            <>
              <div className="ui-seg-row">
                <span className="ui-seg-label">배율</span>
                <div className="seg">
                  {([1, 2] as const).map((r) => (
                    <button key={r} type="button" aria-pressed={ratio === r} onClick={() => setRatio(r)}>
                      {r}배
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>
                  한 장 최대 높이: {maxH}px (실제 이미지 {maxH * ratio}px)
                </span>
                <input type="range" min={1000} max={6000} step={250} value={maxH} onChange={(e) => setMaxH(Number(e.target.value))} />
              </label>
              <p className="small muted">
                긴 기록은 댓글 경계(없으면 줄 경계)에서 나눠 여러 장으로 저장하고 ZIP으로 묶습니다. 폭은 각 글의 설정({[...new Set(targets.map((d) => effectiveWidth(d.view)))].join("·")}px). 움직이는
                GIF는 첫 장면만 담깁니다(HTML에서는 움직임 유지).
              </p>
            </>
          )}
          {followsApp ? <p className="small muted">기록 테마가 '화면 테마 따름'인 글은 지금 화면 테마({appTheme === "dark" ? "다크" : "라이트"})로 저장됩니다.</p> : null}
          {hiddenPeople.size ? <p className="notice">숨긴 인물 {hiddenPeople.size}명의 본문은 파일에 포함되지 않습니다(HTML 숨김 데이터에도 없음).</p> : null}
          {missing ? <p className="notice">확보되지 않은 이미지 {missing}개는 '이미지 미확보' 자리로 표시됩니다.</p> : null}
          <p className="small muted">원문·숨긴 내용까지 보관하려면 상단의 '프로젝트 저장'(.afterlog)을 쓰세요.</p>
          {progress ? (
            <p className="notice ok" role="status">
              {progress}
            </p>
          ) : null}
          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            {busy && (kind === "png" || kind === "jpeg") ? (
              <button type="button" className="ui-btn" onClick={() => abort.current?.abort()}>
                취소
              </button>
            ) : null}
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !targets.length} onClick={run}>
              {busy ? "만드는 중…" : kind === "copy" ? "복사" : "내보내기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

async function deliver(files: { name: string; blob: Blob }[], zipName: string) {
  if (files.length === 1) return downloadBlob(files[0].blob, files[0].name);
  const out: Record<string, Uint8Array> = {};
  for (const f of files) out[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  downloadBlob(new Blob([zipSync(out, { level: 0 }) as BlobPart], { type: "application/zip" }), zipName);
}
