import { useCallback, useEffect, useState } from "react";
import type { DocumentData } from "../domain/types";
import { getDocuments, getProject } from "../storage/repo";
import { ImportPanel } from "./panels/ImportPanel";
import { ProjectDrawer } from "./panels/ProjectDrawer";
import { Workspace } from "./Workspace";
import { useEditorTheme } from "./useEditorTheme";

const LAST_PROJECT_KEY = "afterlog.lastProject";

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* 저장소를 못 쓰는 환경에서는 기억하지 않는다 */
  }
}

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState("");
  const [docs, setDocs] = useState<DocumentData[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const theme = useEditorTheme();

  const openProject = useCallback(async (id: string | null, preferDoc?: string) => {
    if (!id) {
      setProjectId(null);
      setDocs([]);
      setActiveDocId(null);
      writePref(LAST_PROJECT_KEY, null);
      return;
    }
    const p = await getProject(id);
    if (!p || p.deletedAt) {
      await openProject(null);
      return;
    }
    const list = await getDocuments(id);
    setProjectId(id);
    setProjectTitle(p.title);
    setDocs(list);
    setActiveDocId(preferDoc && list.some((d) => d.id === preferDoc) ? preferDoc : list[0]?.id ?? null);
    writePref(LAST_PROJECT_KEY, id);
  }, []);

  useEffect(() => {
    openProject(readPref(LAST_PROJECT_KEY))
      .catch((e) => setFatal(`저장소를 열 수 없습니다: ${(e as Error).message}. 사생활 보호 창이거나 브라우저가 저장을 막고 있을 수 있습니다.`))
      .finally(() => setLoading(false));
  }, [openProject]);

  const active = docs.find((d) => d.id === activeDocId) ?? null;

  const drawerEl = drawer ? (
    <ProjectDrawer
      currentId={projectId}
      refreshKey={refreshKey}
      onClose={() => setDrawer(false)}
      onOpen={(id) => {
        setDrawer(false);
        void openProject(id);
      }}
      onCurrentRemoved={() => void openProject(null)}
    />
  ) : null;

  if (loading) return <div className="boot">불러오는 중…</div>;

  if (!active || !projectId) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <span className="brand">AFTERLOG</span>
          {projectId ? <span className="muted">{projectTitle}</span> : null}
          <span className="spacer" />
          <button type="button" className="ui-btn" onClick={() => setDrawer(true)}>
            프로젝트
          </button>
          {theme.toggle}
        </header>
        <main className="empty-main">
          {fatal ? <p className="notice error">{fatal}</p> : null}
          <ImportPanel
            projectId={projectId}
            onImported={(pid, created) => {
              setRefreshKey((k) => k + 1);
              void openProject(pid, created[0]?.id);
            }}
          />
        </main>
        {drawerEl}
      </div>
    );
  }

  return (
    <>
      <Workspace
        key={active.id}
        initial={active}
        projectId={projectId}
        projectTitle={projectTitle}
        docs={docs}
        themeToggle={theme.toggle}
        onOpenDrawer={() => setDrawer(true)}
        initialSelected={pendingSelect}
        onSwitchDoc={async (id, entryId) => {
          // 저장된 최신 상태(저장 번호 포함)로 다시 읽는다
          setDocs(await getDocuments(projectId));
          setPendingSelect(entryId ?? null);
          setActiveDocId(id);
        }}
        onImported={(pid, created) => {
          setRefreshKey((k) => k + 1);
          void openProject(pid, created[0]?.id);
        }}
      />
      {drawerEl}
    </>
  );
}
