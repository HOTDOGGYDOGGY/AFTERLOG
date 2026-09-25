import { useRef, useState } from "react";
import { zipSync } from "fflate";
import type { DocumentData } from "../../domain/types";
import { safeName } from "../../exporters/fileName";
import { downloadBlob } from "../download";

export function ExportDialog({ doc, getBlob, onClose }: { doc: DocumentData; getBlob(id: string): Promise<Blob | undefined>; onClose(): void }) {
  const [kind, setKind] = useState<"html" | "png">("html");
  const [ratio, setRatio] = useState<1 | 2>(2);
  const [maxH, setMaxH] = useState(3000);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const hiddenPeople = Object.values(doc.identities).filter((p) => p.hidden);
  const missing = Object.values(doc.entries).reduce((n, e) => n + e.blocks.filter((b) => b.type === "image" && !b.assetId).length, 0);

  const run = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      if (kind === "html") {
        const { exportDocumentHtml } = await import("../../exporters/html");
        const blob = await exportDocumentHtml(doc, getBlob);
        downloadBlob(blob, `${safeName(doc.title)}.html`);
        setProgress("HTML 파일을 받았습니다.");
      } else {
        abort.current = new AbortController();
        const { exportDocumentPng } = await import("../../exporters/png");
        const { pages, forcedCuts } = await exportDocumentPng(doc, getBlob, {
          pixelRatio: ratio,
          maxPageHeight: maxH,
          signal: abort.current.signal,
          onProgress: (d, t) => setProgress(`이미지 만드는 중 ${d}/${t}`),
        });
        if (pages.length === 1) downloadBlob(pages[0].blob, pages[0].fileName);
        else {
          const files: Record<string, Uint8Array> = {};
          for (const p of pages) files[p.fileName] = new Uint8Array(await p.blob.arrayBuffer());
          downloadBlob(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" }), `${safeName(doc.title)}_png.zip`);
        }
        setProgress(
          `${pages.length}장을 받았습니다.${pages.length > 1 ? " (ZIP)" : ""}${forcedCuts ? ` 항목·줄 경계를 찾지 못해 강제로 자른 곳이 ${forcedCuts}군데 있습니다.` : ""}`,
        );
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
            ×
          </button>
        </div>
        <div className="panel-body">
          <div className="seg" role="radiogroup" aria-label="형식">
            <button type="button" role="radio" aria-checked={kind === "html"} aria-pressed={kind === "html"} onClick={() => setKind("html")}>
              HTML (단일 파일)
            </button>
            <button type="button" role="radio" aria-checked={kind === "png"} aria-pressed={kind === "png"} onClick={() => setKind("png")}>
              PNG 이미지
            </button>
          </div>
          {kind === "html" ? (
            <p className="small muted">이미지와 스타일을 모두 담은 파일 하나입니다. 인터넷 없이 더블클릭으로 열립니다.</p>
          ) : (
            <>
              <div className="size-row">
                <span>배율</span>
                <div className="seg">
                  {([1, 2] as const).map((r) => (
                    <button key={r} type="button" aria-pressed={ratio === r} onClick={() => setRatio(r)}>
                      {r}배
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>한 장 최대 높이: {maxH}px (실제 이미지 {maxH * ratio}px)</span>
                <input type="range" min={1000} max={6000} step={250} value={maxH} onChange={(e) => setMaxH(Number(e.target.value))} />
              </label>
              <p className="small muted">긴 기록은 댓글 경계(없으면 줄 경계)에서 나눠 여러 장으로 저장하고 ZIP으로 묶습니다. 너비 {doc.view.width}px.</p>
              <p className="small muted">움직이는 GIF는 PNG에 첫 장면만 담깁니다(HTML에서는 움직임 유지).</p>
            </>
          )}
          {hiddenPeople.length ? <p className="notice">숨긴 인물 {hiddenPeople.length}명({hiddenPeople.map((p) => p.displayName).join(", ")})의 본문은 파일에 포함되지 않습니다.</p> : null}
          {missing ? <p className="notice">확보되지 않은 이미지 {missing}개는 '이미지 미확보' 자리로 표시됩니다.</p> : null}
          <p className="small muted">원문·숨긴 내용까지 보관하려면 '프로젝트 저장'(.afterlog)을 쓰세요.</p>
          {progress ? <p className="notice ok">{progress}</p> : null}
          {error ? <p className="notice error">{error}</p> : null}
          <div className="modal-actions">
            {busy && kind === "png" ? (
              <button type="button" className="ui-btn" onClick={() => abort.current?.abort()}>
                취소
              </button>
            ) : null}
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={run}>
              {busy ? "만드는 중…" : "내보내기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
