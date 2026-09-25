// 밴드 '내용 편집' 모드의 작업 화면: 왼쪽 작업 패널(문서·가져오기·인물·첨부) + 가운데 편집 미리보기 + 선택했을 때만 오른쪽 검사 패널.
// 상단바·저장·내보내기는 공통 셸이 담당한다. 원형 보기와 같은 문서 편집기(editor)를 받아 쓴다.
import { useCallback, useEffect, useState } from "react";
import * as C from "../editor/commands";
import type { DocumentData } from "../domain/types";
import { addAsset } from "../storage/repo";
import { pickFiles } from "./download";
import { AssetsPanel } from "./panels/AssetsPanel";
import { ImportPanel } from "./panels/ImportPanel";
import { Inspector } from "./panels/Inspector";
import { PeoplePanel } from "./panels/PeoplePanel";
import { Preview } from "./Preview";
import { ReactionsView } from "./ReactionsView";
import { DocList } from "./panels/DocList";
import { CaptureReports } from "./panels/CaptureReports";
import type { useAssets } from "./useAssets";
import type { DocEditor } from "./useDocEditor";
import { usePanelWidths } from "./usePanelWidths";
import { Icon } from "../components/Icon";

type Tab = "docs" | "import" | "people" | "assets";
const TABS: [Tab, string][] = [
  ["docs", "문서"],
  ["import", "가져오기·검토"],
  ["people", "인물"],
  ["assets", "첨부"],
];

interface Props {
  editor: DocEditor;
  assets: ReturnType<typeof useAssets>;
  projectId: string;
  captureReports?: unknown[];
  docs: DocumentData[];
  onSwitchDoc(id: string, entryId?: string): void;
  initialSelected?: string | null;
  onImported(projectId: string, docs: DocumentData[]): void;
  onError(text: string): void;
  appTheme: "light" | "dark";
}

export function Workspace({ editor, assets, projectId, captureReports, docs, onSwitchDoc, onImported, initialSelected, onError, appTheme }: Props) {
  const { doc } = editor;
  const [tab, setTab] = useState<Tab>(() => (docs.length > 1 ? "docs" : doc.issues.some((i) => !i.resolved) ? "import" : "people"));
  const [selected, setSelected] = useState<string | null>(initialSelected ?? null);
  const [view, setView] = useState<"document" | "reactions">("document");
  const [scrollTo, setScrollTo] = useState<string | null>(initialSelected ?? null);
  const [sheet, setSheet] = useState<"left" | null>(null);
  const panels = usePanelWidths();

  useEffect(() => {
    if (selected && !doc.entries[selected]) setSelected(null);
  }, [doc, selected]);

  useEffect(() => {
    if (!scrollTo || view !== "document") return;
    const el = document.querySelector(`.center [data-entry-id="${CSS.escape(scrollTo)}"]`);
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

  const openIssues = doc.issues.filter((i) => !i.resolved);
  const allDocs = docs.map((d) => (d.id === doc.id ? doc : d));

  return (
    <div
      className={`workspace${panels.widths.leftCollapsed ? " left-collapsed" : ""}${selected ? " has-inspector" : ""}${sheet ? " sheet-open" : ""}`}
      style={{ ["--left-w" as string]: `${panels.widths.left}px`, ["--right-w" as string]: `${panels.widths.right}px` }}
    >
      <aside className="left-panel" aria-label="작업 패널">
        <div className="tabs" role="tablist">
          {TABS.filter(([k]) => k !== "docs" || docs.length > 1).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
              {k === "import" && openIssues.length ? <span className="badge">{openIssues.length}</span> : null}
            </button>
          ))}
          <button type="button" className="ui-icon-btn sheet-close" aria-label="작업 패널 닫기" onClick={() => setSheet(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="panel-body" role="tabpanel">
          {tab === "docs" ? (
            <DocList
              docs={allDocs}
              currentId={doc.id}
              onOpen={async (id, entryId) => {
                if (entryId) return void jump(id, entryId);
                if (id === doc.id) return;
                await editor.flush();
                onSwitchDoc(id);
              }}
            />
          ) : null}
          {tab === "import" ? (
            <>
              <CaptureReports reports={captureReports ?? []} />
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
                  <span>
                    확인할 점 · 남은 {openIssues.length}개 / 전체 {doc.issues.length}개
                  </span>
                  <ul className="issue-list">
                    {doc.issues.map((i) => (
                      <li key={i.id} className={i.resolved ? "is-resolved" : undefined}>
                        <label>
                          <input type="checkbox" checked={i.resolved} disabled={!!editor.readOnly} onChange={(e) => editor.apply((d) => C.resolveIssue(d, i.id, e.target.checked))} />
                          {i.message}
                        </label>
                        {i.entryId && doc.entries[i.entryId] ? (
                          <button type="button" className="ui-link small" onClick={() => jump(doc.id, i.entryId!)}>
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
          {tab === "assets" ? (
            <AssetsPanel editor={editor} allDocs={allDocs} assets={assets.assets} assetUrl={assets.url} projectId={projectId} onAssetsChanged={assets.reload} onError={onError} />
          ) : null}
        </div>
      </aside>

      <div
        className="resize-handle is-left"
        role="separator"
        aria-orientation="vertical"
        aria-label="작업 패널 너비"
        aria-valuenow={panels.widths.left}
        tabIndex={0}
        onPointerDown={(e) => panels.startDrag("left", e)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") panels.nudge("left", -16);
          if (e.key === "ArrowRight") panels.nudge("left", 16);
        }}
      />
      <main className="center" aria-label="편집 미리보기">
        <div className="center-toolbar">
          <button
            type="button"
            className="ui-icon-btn"
            aria-label={panels.widths.leftCollapsed ? "작업 패널 펼치기" : "작업 패널 접기"}
            title={panels.widths.leftCollapsed ? "작업 패널 펼치기" : "작업 패널 접기"}
            aria-expanded={!panels.widths.leftCollapsed}
            onClick={() => (window.innerWidth < 1100 ? setSheet(sheet ? null : "left") : panels.toggleLeft())}
          >
            <Icon name="menu" size={16} />
          </button>
          <div className="seg" role="tablist" aria-label="보기">
            <button type="button" role="tab" aria-selected={view === "document"} aria-pressed={view === "document"} onClick={() => setView("document")}>
              문서
            </button>
            <button type="button" role="tab" aria-selected={view === "reactions"} aria-pressed={view === "reactions"} onClick={() => setView("reactions")}>
              표정·반응 목록
            </button>
          </div>
          <span className="spacer" />
          <span className="small muted hide-narrow">편집 중 · 항목을 누르면 오른쪽에서 작성자·부모·원문을 고칩니다</span>
        </div>
        {view === "document" ? (
          <Preview editor={editor} assetUrl={assets.url} selectedId={selected} onSelect={setSelected} onInsertImage={insertImage} appTheme={appTheme} />
        ) : (
          <ReactionsView docs={allDocs} onJump={jump} />
        )}
      </main>

      {selected ? (
        <>
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
          <Inspector editor={editor} entryId={selected} onClose={() => setSelected(null)} />
        </>
      ) : null}
    </div>
  );
}
