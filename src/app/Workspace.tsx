import { useCallback, useEffect, useState, type ReactNode } from "react";
import * as C from "../editor/commands";
import type { DocumentData } from "../domain/types";
import { exportProjectFile } from "../exporters/afterlog";
import { addAsset } from "../storage/repo";
import { downloadBlob, pickFiles } from "./download";
import { AssetsPanel } from "./panels/AssetsPanel";
import { DisplayPanel } from "./panels/DisplayPanel";
import { ExportDialog } from "./panels/ExportDialog";
import { ImportPanel } from "./panels/ImportPanel";
import { Inspector } from "./panels/Inspector";
import { PeoplePanel } from "./panels/PeoplePanel";
import { Preview } from "./Preview";
import { PersonArchive } from "./PersonArchive";
import { MenuButton } from "../components/Menu";
import { useAssets } from "./useAssets";
import { useDocEditor, type SaveStatus } from "./useDocEditor";
import { usePanelWidths } from "./usePanelWidths";

type Tab = "import" | "people" | "display" | "assets";
const TABS: [Tab, string][] = [
  ["import", "가져오기·검토"],
  ["people", "인물"],
  ["display", "표시"],
  ["assets", "첨부"],
];

const STATUS_LABEL: Record<SaveStatus, string> = { saved: "저장됨", dirty: "변경됨", saving: "저장 중…", error: "저장 실패" };

interface Props {
  initial: DocumentData;
  projectId: string;
  projectTitle: string;
  docs: DocumentData[];
  themeToggle: ReactNode;
  onOpenDrawer(): void;
  onSwitchDoc(id: string, entryId?: string): void;
  initialSelected?: string | null;
  onImported(projectId: string, docs: DocumentData[]): void;
}

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

export function Workspace({ initial, projectId, projectTitle, docs, themeToggle, onOpenDrawer, onSwitchDoc, onImported, initialSelected }: Props) {
  const editor = useDocEditor(initial);
  const { doc } = editor;
  const assets = useAssets(projectId);
  const [tab, setTab] = useState<Tab>(() => (initial.issues.some((i) => !i.resolved) ? "import" : "people"));
  const [selected, setSelected] = useState<string | null>(initialSelected ?? null);
  const [view, setView] = useState<"document" | "people">("document");
  const [scrollTo, setScrollTo] = useState<string | null>(initialSelected ?? null);
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState<"left" | "preview" | "right">("preview");
  const panels = usePanelWidths();

  useEffect(() => {
    if (selected && !doc.entries[selected]) setSelected(null);
  }, [doc, selected]);

  // 인물 보기에서 항목으로 이동했을 때 그 위치로 스크롤
  useEffect(() => {
    if (!scrollTo || view !== "document") return;
    const el = document.querySelector(`[data-entry-id="${CSS.escape(scrollTo)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      (el as HTMLElement).focus({ preventScroll: true });
      setScrollTo(null);
    }
  }, [scrollTo, view, doc]);

  const jump = async (docId: string, entryId: string) => {
    if (docId === doc.id) {
      setView("document");
      setSelected(entryId);
      setScrollTo(entryId);
      return;
    }
    await editor.flush();
    onSwitchDoc(docId, entryId);
  };

  // 단축키: 입력 중에는 브라우저 편집 동작을 그대로 둔다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [editor]);

  const onError = useCallback((text: string) => setNotice({ kind: "error", text }), []);

  const insertImage = useCallback(
    async (entryId: string) => {
      const files = await pickFiles("image/png,image/jpeg,image/gif,image/webp", true);
      if (!files.length) return;
      try {
        const ids: string[] = [];
        for (const f of files) ids.push((await addAsset(projectId, f, f.name)).id);
        await assets.reload();
        editor.apply((d) => ids.reduce((acc, id) => C.insertImage(acc, entryId, id), d));
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [projectId, assets, editor, onError],
  );

  const saveProject = async (includeSources = true) => {
    try {
      await editor.flush();
      const { blob, fileName } = await exportProjectFile(projectId, { includeSources });
      downloadBlob(blob, fileName);
      setNotice({
        kind: "ok",
        text: includeSources
          ? `프로젝트 파일(${fileName})을 받았습니다. 원문·편집 내용·이미지가 모두 들어 있습니다.`
          : `공유용 프로젝트 파일(${fileName})을 받았습니다. 원본 HTML/텍스트는 빠져 있고 편집 내용·이미지는 들어 있습니다.`,
      });
    } catch (e) {
      onError(`프로젝트 저장 실패: ${(e as Error).message}`);
    }
  };

  const openIssues = doc.issues.filter((i) => !i.resolved);
  const allDocs = docs.map((d) => (d.id === doc.id ? doc : d));

  return (
    <div className={`app-shell show-${panelOpen}`}>
      <header className="topbar">
        <button type="button" className="brand ui-link" onClick={onOpenDrawer} title="프로젝트 목록">
          AFTERLOG
        </button>
        <span className="muted ellipsis project-name" title={projectTitle}>
          {projectTitle}
        </span>
        <input
          className="doc-title"
          aria-label="문서 제목"
          value={doc.title}
          disabled={!!editor.readOnly}
          onChange={(e) => editor.apply((d) => C.setTitle(d, e.target.value), "title")}
        />
        <span className={`save-status is-${editor.status}`} role="status" aria-live="polite" title={editor.error ?? undefined}>
          {STATUS_LABEL[editor.status]}
        </span>
        <span className="spacer" />
        <button type="button" className="ui-icon-btn" aria-label="실행취소 (Ctrl+Z)" title="실행취소 (Ctrl+Z)" disabled={!editor.canUndo || !!editor.readOnly} onClick={editor.undo}>
          ↶
        </button>
        <button type="button" className="ui-icon-btn" aria-label="다시실행 (Ctrl+Y)" title="다시실행 (Ctrl+Y)" disabled={!editor.canRedo || !!editor.readOnly} onClick={editor.redo}>
          ↷
        </button>
        <MenuButton
          className="ui-btn"
          label="프로젝트 저장"
          items={() => [
            { label: "전체 저장 (복구용 · 원본 포함)", onSelect: () => void saveProject(true) },
            { label: "공유용 저장 (원본 HTML·텍스트 제외)", onSelect: () => void saveProject(false) },
          ]}
        >
          프로젝트 저장 ▾
        </MenuButton>
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => setExportOpen(true)}>
          내보내기
        </button>
        <button type="button" className="ui-btn" onClick={onOpenDrawer}>
          프로젝트
        </button>
        {themeToggle}
      </header>

      {docs.length > 1 ? (
        <nav className="doc-tabs" aria-label="문서">
          {docs.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-current={d.id === doc.id}
              onClick={async () => {
                if (d.id === doc.id) return;
                await editor.flush();
                onSwitchDoc(d.id);
              }}
            >
              <span className="ellipsis">{d.id === doc.id ? doc.title : d.title}</span>
            </button>
          ))}
        </nav>
      ) : null}

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
          <button type="button" className="ui-btn ui-btn-small" onClick={() => void saveProject(true)}>
            프로젝트 파일로 받기
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className={`banner ${notice.kind}`} role="status">
          {notice.text}
          <button type="button" className="ui-icon-btn" aria-label="알림 닫기" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      ) : null}

      <nav className="mobile-switch" aria-label="패널 전환">
        {(["left", "preview", "right"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={panelOpen === p} onClick={() => setPanelOpen(p)}>
            {p === "left" ? "설정" : p === "preview" ? "미리보기" : "선택 항목"}
          </button>
        ))}
      </nav>

      <div
        className={`workspace${panels.widths.leftCollapsed ? " left-collapsed" : ""}`}
        style={{ ["--left-w" as string]: `${panels.widths.left}px`, ["--right-w" as string]: `${panels.widths.right}px` }}
      >
        <button
          type="button"
          className="collapse-btn ui-icon-btn"
          aria-label={panels.widths.leftCollapsed ? "설정 패널 펼치기" : "설정 패널 접기"}
          title={panels.widths.leftCollapsed ? "설정 패널 펼치기" : "설정 패널 접기"}
          aria-expanded={!panels.widths.leftCollapsed}
          onClick={panels.toggleLeft}
        >
          {panels.widths.leftCollapsed ? "»" : "«"}
        </button>
        <aside className="left-panel" aria-label="설정 패널">
          <div className="tabs" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {label}
                {k === "import" && openIssues.length ? <span className="badge">{openIssues.length}</span> : null}
              </button>
            ))}
          </div>
          <div className="panel-body" role="tabpanel">
            {tab === "import" ? (
              <>
                {Object.values(doc.entries).some((x) => x.suggestedParentId) ? (
                  <div className="notice warn">
                    답글 연결 제안 {Object.values(doc.entries).filter((x) => x.suggestedParentId).length}개가 있습니다(확정 아님).
                    <div className="row-actions">
                      <button type="button" className="ui-btn ui-btn-small" disabled={!!editor.readOnly} onClick={() => editor.apply((d) => C.applyAllParentSuggestions(d))}>
                        제안 모두 적용
                      </button>
                    </div>
                  </div>
                ) : null}
                {doc.issues.length ? (
                  <section className="field">
                    <span>확인할 점 · 남은 {openIssues.length}개 / 전체 {doc.issues.length}개</span>
                    <ul className="issue-list">
                      {doc.issues.map((i) => (
                        <li key={i.id} className={i.resolved ? "is-resolved" : undefined}>
                          <label>
                            <input
                              type="checkbox"
                              checked={i.resolved}
                              disabled={!!editor.readOnly}
                              onChange={(e) => editor.apply((d) => C.resolveIssue(d, i.id, e.target.checked))}
                            />
                            {i.message}
                          </label>
                          {i.entryId && doc.entries[i.entryId] ? (
                            <button type="button" className="ui-link small" onClick={() => setSelected(i.entryId!)}>
                              항목 보기
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : (
                  <p className="small muted">가져오면서 확인이 필요한 점은 없었습니다.</p>
                )}
                <hr />
                <ImportPanel projectId={projectId} onImported={onImported} compact />
              </>
            ) : null}
            {tab === "people" ? <PeoplePanel editor={editor} assetUrl={assets.url} projectId={projectId} onAssetsChanged={assets.reload} onError={onError} /> : null}
            {tab === "display" ? <DisplayPanel editor={editor} /> : null}
            {tab === "assets" ? (
              <AssetsPanel
                editor={editor}
                allDocs={allDocs}
                assets={assets.assets}
                assetUrl={assets.url}
                projectId={projectId}
                onAssetsChanged={assets.reload}
                onError={onError}
              />
            ) : null}
          </div>
        </aside>

        <div
          className="resize-handle is-left"
          role="separator"
          aria-orientation="vertical"
          aria-label="설정 패널 너비"
          aria-valuenow={panels.widths.left}
          tabIndex={0}
          onPointerDown={(e) => panels.startDrag("left", e)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") panels.nudge("left", -16);
            if (e.key === "ArrowRight") panels.nudge("left", 16);
          }}
        />
        <main className="center" aria-label="미리보기">
          <div className="center-switch seg" role="tablist" aria-label="보기">
            <button type="button" role="tab" aria-selected={view === "document"} aria-pressed={view === "document"} onClick={() => setView("document")}>
              문서
            </button>
            <button type="button" role="tab" aria-selected={view === "people"} aria-pressed={view === "people"} onClick={() => setView("people")}>
              인물별
            </button>
          </div>
          {view === "document" ? (
            <Preview editor={editor} assetUrl={assets.url} selectedId={selected} onSelect={setSelected} onInsertImage={insertImage} />
          ) : (
            <PersonArchive docs={allDocs} currentDocId={doc.id} assetUrl={assets.url} onJump={jump} />
          )}
        </main>

        <div
          className="resize-handle is-right"
          role="separator"
          aria-orientation="vertical"
          aria-label="검사 패널 너비"
          aria-valuenow={panels.widths.right}
          tabIndex={0}
          onPointerDown={(e) => panels.startDrag("right", e)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") panels.nudge("right", 16);
            if (e.key === "ArrowRight") panels.nudge("right", -16);
          }}
        />
        {selected ? (
          <Inspector editor={editor} entryId={selected} onClose={() => setSelected(null)} />
        ) : (
          <aside className="inspector is-empty" aria-label="선택한 항목">
            <p className="small muted">미리보기에서 항목을 누르면 작성자·부모·원문을 여기서 고칠 수 있습니다. 항목의 ⋯ 메뉴나 우클릭으로 이동·나누기·합치기·삭제를 할 수 있습니다.</p>
          </aside>
        )}
      </div>

      {exportOpen ? <ExportDialog doc={doc} getBlob={assets.getBlob} onClose={() => setExportOpen(false)} /> : null}
    </div>
  );
}
