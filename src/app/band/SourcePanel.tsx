// 원문 보기: 이 글을 만든 원본 파일 정보·원문 텍스트(실행하지 않고 글자만)·편집으로 바뀐 항목 비교.
// 원본 HTML은 앱 안에서 실행하지 않는다(스크립트·링크를 살리지 않고 텍스트로만 보여 줌).
import { useEffect, useState } from "react";
import type { DocumentData, SourceImport } from "../../domain/types";
import { db } from "../../storage/db";
import { blocksToPlainText } from "../../importers/band/html";
import { downloadBlob } from "../download";
import { Icon } from "../../components/Icon";

const KIND_LABEL: Record<string, string> = {
  "band-collector-capture": "수집 확장",
  "band-saved-page": "저장 페이지",
  "band-html-fragment": "HTML 조각",
  "band-plain-text": "텍스트 복사",
};

export function SourcePanel({ doc, onClose, onRestore }: { doc: DocumentData; onClose(): void; onRestore?: (entryId: string) => void }) {
  const [src, setSrc] = useState<SourceImport | null | undefined>(undefined);
  const [text, setText] = useState<string | null>(null);
  const [tab, setTab] = useState<"changes" | "text">("changes");
  useEffect(() => {
    let alive = true;
    void db()
      .sources.get(doc.sourceId)
      .then(async (s) => {
        if (!alive) return;
        setSrc(s ?? null);
        if (!s) return;
        const raw = await s.blob.text();
        const plain = /html/.test(s.mime) ? new DOMParser().parseFromString(raw, "text/html").body?.innerText ?? new DOMParser().parseFromString(raw, "text/html").body?.textContent ?? "" : raw;
        if (alive) setText(plain.replace(/\n{3,}/g, "\n\n").slice(0, 200_000));
      });
    return () => {
      alive = false;
    };
  }, [doc.sourceId]);

  const changed = Object.values(doc.entries)
    .filter((e) => blocksToPlainText(e.originalBlocks) !== blocksToPlainText(e.blocks))
    .sort((a, b) => a.sourceOrder - b.sourceOrder);

  return (
    <aside className="source-panel" role="dialog" aria-modal="false" aria-label="원문 보기">
      <div className="panel-head">
        <strong>원문</strong>
        <span className="spacer" />
        <button type="button" className="ui-icon-btn" aria-label="원문 닫기" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="panel-body">
        {src === undefined ? <p className="small muted">불러오는 중…</p> : null}
        {src === null ? <p className="notice">이 글의 원본 파일이 프로젝트에 없습니다(공유용 저장으로 받은 프로젝트일 수 있음). 편집 전 내용은 항목별로 보관되어 있습니다.</p> : null}
        {src ? (
          <dl className="source-meta small">
            <dt>파일</dt>
            <dd className="mono">{src.fileName}</dd>
            <dt>종류</dt>
            <dd>{KIND_LABEL[src.kind ?? ""] ?? src.mime}</dd>
            <dt>가져온 때</dt>
            <dd>{new Date(src.importedAt).toLocaleString()}</dd>
            <dt>해석기</dt>
            <dd>{src.parserVersion}</dd>
            {src.sourceUrl ? (
              <>
                <dt>원래 주소</dt>
                <dd className="mono">{src.sourceUrl}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {src ? (
          <button type="button" className="ui-btn ui-btn-small" onClick={() => downloadBlob(src.blob, src.fileName)}>
            <Icon name="download" size={14} /> 원본 파일 받기
          </button>
        ) : null}
        <div className="seg source-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "changes"} aria-pressed={tab === "changes"} onClick={() => setTab("changes")}>
            편집으로 바뀐 항목 {changed.length}
          </button>
          <button type="button" role="tab" aria-selected={tab === "text"} aria-pressed={tab === "text"} onClick={() => setTab("text")} disabled={!src}>
            원문 텍스트
          </button>
        </div>
        {tab === "changes" ? (
          changed.length ? (
            <ul className="change-list">
              {changed.map((e) => (
                <li key={e.id}>
                  <b className="small">{e.authorId ? doc.identities[e.authorId]?.displayName : "?"}</b>
                  <div className="diff-old small">
                    <span>원래</span>
                    {blocksToPlainText(e.originalBlocks) || "(비어 있음)"}
                  </div>
                  <div className="diff-new small">
                    <span>지금</span>
                    {blocksToPlainText(e.blocks) || "(비어 있음)"}
                  </div>
                  {onRestore ? (
                    <button type="button" className="ui-link small" onClick={() => onRestore(e.id)}>
                      원래 내용으로 되돌리기
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">편집으로 바뀐 본문이 없습니다.</p>
          )
        ) : (
          <pre className="source-text">{text ?? "…"}</pre>
        )}
      </div>
    </aside>
  );
}

