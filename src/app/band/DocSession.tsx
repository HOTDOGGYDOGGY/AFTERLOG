// 밴드 글 하나를 연 상태. 원형 보기(상세 레이어)·꾸미기(오른쪽 패널)·내용 편집(작업 화면)이 같은 문서 편집기를 공유한다.
// 상단바의 실행취소·저장 상태·꾸미기·편집·내보내기 버튼은 이 세션이 셸 슬롯에 넣는다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as C from "../../editor/commands";
import type { DocumentData, ReactionSnapshot, ViewSettings } from "../../domain/types";
import { BandView } from "../../renderers/band/BandView";
import { effectiveWidth, type AppThemeResolved } from "../../renderers/band/style";
import { Icon } from "../../components/Icon";
import { ShellSlot } from "../shell/Shell";
import { useDocEditor, type SaveStatus } from "../useDocEditor";
import type { useAssets } from "../useAssets";
import { Workspace } from "../Workspace";
import { DesignPanel } from "./DesignPanel";
import { ExportDialog } from "../panels/ExportDialog";
import { loadScroll, saveScroll } from "../nav";
import { SourcePanel } from "./SourcePanel";

export type BandViewMode = "original" | "customize" | "edit";

const STATUS_LABEL: Record<SaveStatus, string> = { saved: "자동 저장됨", dirty: "변경됨", saving: "저장 중…", error: "저장 실패" };

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

export function DocSession({
  initial,
  active,
  docs,
  projectId,
  projectTitle,
  captureReports,
  mode,
  setMode,
  entryId,
  appTheme,
  assets,
  onCloseDetail,
  onSwitchDoc,
  onImported,
  onOpenPerson,
  registerFlush,
  onApplyToAll,
  onSaveProjectDefault,
}: {
  initial: DocumentData;
  /** 밴드 플랫폼이 보이는 중인지(아니면 단축키·상단 버튼을 등록하지 않음) */
  active: boolean;
  docs: DocumentData[];
  projectId: string;
  projectTitle: string;
  captureReports?: unknown[];
  mode: BandViewMode;
  setMode(m: BandViewMode): void;
  entryId?: string;
  appTheme: AppThemeResolved;
  assets: ReturnType<typeof useAssets>;
  onCloseDetail(): void;
  onSwitchDoc(id: string, entryId?: string): void;
  onImported(projectId: string, docs: DocumentData[]): void;
  onOpenPerson(docId: string, identityId: string): void;
  registerFlush(fn: () => Promise<void>): () => void;
  onApplyToAll(view: ViewSettings): Promise<void>;
  onSaveProjectDefault(view: ViewSettings): Promise<void>;
}) {
  const editor = useDocEditor(initial);
  const { doc } = editor;
  const [compare, setCompare] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [reactions, setReactions] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(entryId ?? null);
  const layerScroll = useRef<HTMLDivElement>(null);

  useEffect(() => registerFlush(editor.flush), [registerFlush, editor.flush]);

  // 단축키: 입력 중에는 브라우저 편집 동작을 그대로 둔다. 이 세션이 활성일 때만 등록된다
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode !== "edit" && !reactions && !image && !exportOpen && !sourceOpen && !isTypingTarget(e.target)) {
        if (mode === "customize") setMode("original");
        else onCloseDetail();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void editor.flush();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        editor.undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        editor.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, editor, mode, setMode, onCloseDetail, reactions, image, exportOpen, sourceOpen]);

  // 원형 보기: 이동해 온 댓글로 스크롤하고 잠시 강조, 아니면 이 글에서 읽던 위치
  const scrollKey = `band:post:${doc.id}`;
  useLayoutEffect(() => {
    if (mode === "edit") return;
    const box = layerScroll.current;
    if (!box) return;
    if (entryId) {
      const el = box.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.focus({ preventScroll: true });
      }
      setHighlight(entryId);
      const t = window.setTimeout(() => setHighlight(null), 2600);
      return () => window.clearTimeout(t);
    }
    const top = loadScroll(scrollKey);
    if (top !== null) box.scrollTop = top;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, mode === "edit"]);

  // 원형과 비교: 누르는 동안만 원형으로 그린다(설정은 바꾸지 않음)
  const shown = useMemo(() => (compare ? { ...doc, view: { ...doc.view, skinFamily: "original" as const } } : doc), [compare, doc]);
  const reactionEntry = reactions ? doc.entries[reactions] : null;
  const onError = useCallback((text: string) => setNotice({ kind: "error", text }), []);

  const headerSlots = !active ? null : (
    <>
      <ShellSlot name="status">
        <span className={`save-status is-${editor.status}`} role="status" aria-live="polite" title={editor.error ?? undefined}>
          {editor.readOnly ? "읽기 전용" : STATUS_LABEL[editor.status]}
        </span>
      </ShellSlot>
      <ShellSlot name="actions">
        <button type="button" className="ui-icon-btn tb-optional" aria-label="실행취소 (Ctrl+Z)" title="실행취소 (Ctrl+Z)" disabled={!editor.canUndo || !!editor.readOnly} onClick={editor.undo}>
          <Icon name="undo" />
        </button>
        <button type="button" className="ui-icon-btn tb-optional" aria-label="다시실행 (Ctrl+Y)" title="다시실행 (Ctrl+Y)" disabled={!editor.canRedo || !!editor.readOnly} onClick={editor.redo}>
          <Icon name="redo" />
        </button>
        <span className="topbar-sep tb-optional" />
        <button type="button" className="ui-btn ui-btn-quiet tb-optional" aria-pressed={sourceOpen} aria-label="원문 보기" onClick={() => setSourceOpen(!sourceOpen)} title="가져온 원문 파일과 원래 내용 보기">
          <Icon name="source" size={16} />
          <span className="hide-narrow">원문 보기</span>
        </button>
        <button type="button" className="ui-btn ui-btn-quiet" aria-pressed={mode === "customize"} aria-label="꾸미기" onClick={() => setMode(mode === "customize" ? "original" : "customize")} title="폰트·인장·댓글 모양·색 바꾸기">
          <Icon name="brush" size={16} />
          <span className="hide-narrow">꾸미기</span>
        </button>
        <button type="button" className="ui-btn ui-btn-quiet" aria-pressed={mode === "edit"} aria-label={mode === "edit" ? "편집 끝내기" : "내용 편집"} onClick={() => setMode(mode === "edit" ? "original" : "edit")} title="본문·작성자·순서·답글 관계 고치기">
          <Icon name="edit" size={16} />
          <span className="hide-narrow">{mode === "edit" ? "편집 끝내기" : "내용 편집"}</span>
        </button>
      </ShellSlot>
      <ShellSlot name="primary">
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => setExportOpen(true)}>
          내보내기
        </button>
      </ShellSlot>
    </>
  );

  const banners = (
    <>
      {editor.readOnly ? (
        <div className="banner warn" role="alert">
          {editor.readOnly.message}
          <button type="button" className="ui-btn ui-btn-small" onClick={() => void editor.takeOver()}>
            이 탭에서 편집하기 (저장된 최신 상태로 다시 열기)
          </button>
        </div>
      ) : null}
      {editor.status === "error" && !editor.readOnly ? (
        <div className="banner error" role="alert">
          자동 저장 실패: {editor.error} 편집 내용은 이 창에 남아 있습니다.
          <button type="button" className="ui-btn ui-btn-small" onClick={() => void editor.flush()}>
            다시 저장
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className={`banner ${notice.kind}`} role="status">
          {notice.text}
          <button type="button" className="ui-icon-btn" aria-label="알림 닫기" onClick={() => setNotice(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
    </>
  );

  const allDocs = docs.map((d) => (d.id === doc.id ? doc : d));

  return (
    <>
      {headerSlots}
      {mode === "edit" ? (
        <div className="band-edit">
          {banners}
          <Workspace
            editor={editor}
            assets={assets}
            projectId={projectId}
            captureReports={captureReports}
            docs={docs}
            onSwitchDoc={onSwitchDoc}
            onImported={onImported}
            initialSelected={entryId ?? null}
            onError={onError}
            appTheme={appTheme}
          />
        </div>
      ) : (
        <div className={`band-stage${mode === "customize" ? " has-design" : ""}`} style={{ ["--detail-w" as string]: `${effectiveWidth(shown.view)}px` }}>
          <div className="band-dim" onClick={onCloseDetail} aria-hidden="true" />
          <div className="band-layer" role="dialog" aria-modal="false" aria-label={`글 상세: ${doc.title}`}>
            {banners}
            <div className="band-layer-scroll" ref={layerScroll} onScroll={(e) => saveScroll(scrollKey, (e.currentTarget as HTMLElement).scrollTop)}>
              <BandView
                doc={shown}
                mode="read"
                appTheme={appTheme}
                assetUrl={assets.url}
                actionStrip
                read={{
                  highlightId: highlight,
                  onOpenPerson: (idnId) => onOpenPerson(doc.id, idnId),
                  onShowReactions: (id) => setReactions(id),
                  onOpenImage: (src) => setImage(src),
                }}
              />
            </div>
            {compare ? <p className="compare-flag">원형 비교 중 · 설정은 바뀌지 않았습니다</p> : null}
          </div>
          <button type="button" className="band-layer-close" aria-label="글 닫기 (Esc)" title="글 닫기 (Esc)" onClick={onCloseDetail}>
            <Icon name="close" size={26} />
          </button>
          {mode === "customize" ? (
            <DesignPanel
              editor={editor}
              onClose={() => setMode("original")}
              onCompare={setCompare}
              otherDocs={docs.length - 1}
              onApplyToAll={async (v) => {
                await editor.flush();
                await onApplyToAll(v);
              }}
              onSaveProjectDefault={onSaveProjectDefault}
            />
          ) : null}
        </div>
      )}
      {sourceOpen ? <SourcePanel doc={doc} onClose={() => setSourceOpen(false)} onRestore={editor.readOnly ? undefined : (id) => editor.apply((d) => C.restoreOriginal(d, id))} /> : null}
      {reactionEntry ? <ReactionsDialog snapshot={reactionEntry.reactions} onClose={() => setReactions(null)} /> : null}
      {image ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="이미지 크게 보기" onClick={() => setImage(null)}>
          <img src={image} alt="" />
          <button type="button" className="band-layer-close" aria-label="닫기" onClick={() => setImage(null)} autoFocus>
            <Icon name="close" size={26} />
          </button>
        </div>
      ) : null}
      {exportOpen ? <ExportDialog doc={doc} docs={allDocs} getBlob={assets.getBlob} appTheme={appTheme} projectTitle={projectTitle} onClose={() => setExportOpen(false)} /> : null}
    </>
  );
}

/** 보관된 표정 내역. 실제 서비스에 표정을 남기지 않는다. 모르는 값은 만들지 않는다 */
function ReactionsDialog({ snapshot: r, onClose }: { snapshot: ReactionSnapshot | undefined; onClose(): void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="react-title">
        <div className="panel-head">
          <strong id="react-title">표정 내역 (보관된 기록)</strong>
          <button type="button" className="ui-icon-btn" aria-label="닫기" onClick={onClose} autoFocus>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="panel-body">
          {!r || r.status === "unknown" || r.status === "not-applicable" ? (
            <p>
              보관된 표정 정보가 없습니다 <b>(미확보)</b>. 저장할 때 화면에 표정 수가 보이지 않았거나 예전 방식으로 가져온 자료입니다. 0개라는 뜻이 아닙니다.
            </p>
          ) : (
            <>
              <p>
                총 <b>{r.total ?? "?"}</b>개{r.status === "confirmed-zero" ? " (0개로 확인됨)" : ""}
              </p>
              {r.kinds.length ? (
                <ul className="chips">
                  {r.kinds.map((k, i) => (
                    <li key={i} className="chip">
                      {k.label} {k.count ?? "?"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">종류별 수는 확보하지 못했습니다.</p>
              )}
              <p className="small">반응한 인물: {r.reactors === "unknown" ? "명단 미확보" : r.reactors.length ? r.reactors.join(", ") : "없음"}</p>
            </>
          )}
          {r?.evidence ? <p className="small muted">근거: {r.evidence}</p> : null}
          <p className="small muted">보관 기록을 보여 주기만 하며 실제 밴드에 표정을 남기지 않습니다.</p>
        </div>
      </div>
    </div>
  );
}
