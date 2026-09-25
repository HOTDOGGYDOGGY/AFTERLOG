// AFTERLOG 앱: 공통 셸(상단바·플랫폼 전환줄) 안에 플랫폼 모듈을 둔다.
// 밴드 = 새 편집기(원형 보기 기본), 카톡·트위터·DM·카페 = RPBA 기존 도구 연결, 짓시 = 원문 보관.
// 기존 도구는 한 번 연 뒤 숨겨 두어 같은 창에서 오가도 입력·설정이 그대로 남고, 상태는 프로젝트에 자동 저장된다.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentData } from "../domain/types";
import { createProject, getDocuments, getProject } from "../storage/repo";
import { exportProjectFile } from "../exporters/afterlog";
import { ProjectDrawer } from "./panels/ProjectDrawer";
import { importProjectFiles, mergeProjectFiles } from "../exporters/afterlog";
import { Shell } from "./shell/Shell";
import { useAppTheme } from "./shell/useAppTheme";
import { PLATFORMS, platformOf, type PlatformId } from "./shell/platforms";
import { useRoute, type BandRoute } from "./nav";
import { BandModule } from "./band/BandModule";
import { LegacyHost } from "./legacy/LegacyHost";
import { ArchiveModule } from "./legacy/ArchiveModule";
import { downloadBlob } from "./download";
import { Icon } from "../components/Icon";

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
  const theme = useAppTheme();
  const { route, navigate } = useRoute();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState("");
  const [captureReports, setCaptureReports] = useState<unknown[]>([]);
  const [docs, setDocs] = useState<DocumentData[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // 한 번 연 기존 도구는 숨겨서 유지(같은 창 안의 입력·설정 보존)
  const [visited, setVisited] = useState<Set<PlatformId>>(() => new Set([route.platform]));
  const flushers = useRef(new Set<() => Promise<void>>());
  // 다른 플랫폼에 다녀와도 밴드에서 보던 화면(글·인물)으로 돌아온다
  const lastBand = useRef<BandRoute>(route.band);
  if (route.platform === "band") lastBand.current = route.band;

  const registerFlush = useCallback((fn: () => Promise<void>) => {
    flushers.current.add(fn);
    return () => void flushers.current.delete(fn);
  }, []);
  const flushAll = useCallback(async () => {
    for (const f of Array.from(flushers.current)) await f();
  }, []);

  const loadProject = useCallback(async (id: string | null): Promise<void> => {
    if (!id) {
      setProjectId(null);
      setProjectTitle("");
      setDocs([]);
      setCaptureReports([]);
      writePref(LAST_PROJECT_KEY, null);
      return;
    }
    const p = await getProject(id);
    if (!p || p.deletedAt) return loadProject(null);
    setProjectId(id);
    setProjectTitle(p.title);
    setCaptureReports(p.captureReports ?? []);
    setDocs(await getDocuments(id));
    writePref(LAST_PROJECT_KEY, id);
  }, []);

  const reloadDocs = useCallback(async () => {
    if (projectId) setDocs(await getDocuments(projectId));
  }, [projectId]);

  useEffect(() => {
    loadProject(readPref(LAST_PROJECT_KEY))
      .catch((e) => setFatal(`저장소를 열 수 없습니다: ${(e as Error).message}. 사생활 보호 창이거나 브라우저가 저장을 막고 있을 수 있습니다.`))
      .finally(() => setLoading(false));
  }, [loadProject]);

  useEffect(() => {
    setVisited((v) => (v.has(route.platform) ? v : new Set([...v, route.platform])));
  }, [route.platform]);

  /** 작은 자료를 넣기 위해 이름 입력부터 요구하지 않는다: 임시 제목으로 바로 만든다 */
  const ensureProject = useCallback(async () => {
    if (projectId) return projectId;
    const d = new Date();
    const p = await createProject(`새 프로젝트 ${d.getMonth() + 1}월 ${d.getDate()}일`);
    setProjectId(p.id);
    setProjectTitle(p.title);
    setDocs([]);
    setCaptureReports([]);
    writePref(LAST_PROJECT_KEY, p.id);
    setRefreshKey((k) => k + 1);
    return p.id;
  }, [projectId]);

  // .afterlog 열기: 새 사본 프로젝트(new) 또는 지금 프로젝트에 합치기(merge, 같은 글·프로필은 건너뜀)
  const openProjectFiles = async (files: File[], mode: "new" | "merge") => {
    if (mode === "merge" && projectId) {
      await flushAll();
      const r = await mergeProjectFiles(files, projectId);
      setRefreshKey((k) => k + 1);
      await loadProject(projectId);
      const parts = [
        `새 글 ${r.added}개`,
        r.updated ? `더 많이 확보한 글로 갱신 ${r.updated}개` : "",
        r.skipped ? `이미 있는 글 건너뜀 ${r.skipped}개${r.keptEdited ? `(고친 글이라 그대로 둔 ${r.keptEdited}개 포함)` : ""}` : "",
        r.profilesAdded ? `프로필 보관본 ${r.profilesAdded}개` : "",
        r.missingParts.length ? `빠진 파트 ${r.missingParts.join(", ")}번(그 파트의 이미지 없음)` : "",
      ].filter(Boolean);
      setNotice({ kind: "ok", text: `지금 프로젝트에 합쳤습니다: ${parts.join(" · ")}.` });
      return;
    }
    const r = await importProjectFiles(files);
    setRefreshKey((k) => k + 1);
    await switchProject(r.project.id);
    if (r.missingParts.length)
      setNotice({ kind: "error", text: `"${r.project.title}"을(를) 불러왔지만 ${r.partCount}개 파트 중 ${r.missingParts.join(", ")}번 파트가 없어 이미지 ${r.missingAssets}개가 빠졌습니다. 빠진 파트와 함께 다시 불러오면 채워집니다.` });
  };

  const switchProject = useCallback(
    async (id: string | null) => {
      await flushAll();
      await loadProject(id);
      navigate({ platform: route.platform, band: { screen: "home" } }, { replace: true });
    },
    [flushAll, loadProject, navigate, route.platform],
  );

  const saveProject = async (includeSources: boolean) => {
    try {
      await flushAll();
      if (!projectId) {
        setNotice({ kind: "error", text: "저장할 프로젝트가 없습니다. 먼저 자료를 가져오거나 입력하세요." });
        return;
      }
      const { files } = await exportProjectFile(projectId, { includeSources });
      for (const f of files) downloadBlob(f.blob, f.fileName);
      setNotice({
        kind: "ok",
        text: `${includeSources ? "프로젝트 파일" : "공유용 프로젝트 파일(원본 HTML/텍스트 제외)"}을 받았습니다: ${files.map((f) => f.fileName).join(", ")}${files.length > 1 ? " — 여러 파트로 나뉘었습니다. 불러올 때 모두 함께 선택하세요." : ""}`,
      });
    } catch (e) {
      setNotice({ kind: "error", text: `프로젝트 저장 실패: ${(e as Error).message}. 편집 내용은 브라우저에 남아 있습니다.` });
    }
  };

  const setPlatform = (p: PlatformId) => navigate({ platform: p, band: p === "band" ? lastBand.current : { screen: "home" } });
  const setBandRoute = useCallback((b: BandRoute, opts?: { replace?: boolean }) => navigate({ platform: "band", band: b }, opts), [navigate]);

  if (loading) return <div className="boot">불러오는 중…</div>;

  return (
    <Shell
      platform={route.platform}
      onPlatform={setPlatform}
      projectTitle={projectId ? projectTitle : null}
      onOpenProjects={() => setDrawer(true)}
      onHome={() => navigate({ platform: route.platform, band: { screen: "home" } })}
      canSave={!!projectId}
      saveItems={() => [
        { label: "전체 저장 (복구용 · 원본 포함)", disabled: !projectId, onSelect: () => void saveProject(true) },
        { label: "공유용 저장 (원본 HTML·텍스트 제외)", disabled: !projectId, onSelect: () => void saveProject(false) },
      ]}
      themeMode={theme.mode}
      onThemeMode={theme.setMode}
    >
      {fatal ? <p className="banner error">{fatal}</p> : null}
      {notice ? (
        <div className={`banner ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
          <button type="button" className="ui-icon-btn" aria-label="알림 닫기" onClick={() => setNotice(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
      <div className="module-area">
        {/* 밴드도 한 번 연 뒤 숨겨서 유지(다른 플랫폼에 다녀와도 편집 중인 글·읽던 위치 보존). 활성일 때만 단축키·상단 버튼 */}
        {visited.has("band") ? (
          <BandModule
            key={projectId ?? "none"}
            active={route.platform === "band"}
            projectId={projectId}
            projectTitle={projectTitle}
            docs={docs}
            captureReports={captureReports}
            route={route.platform === "band" ? route.band : lastBand.current}
            navigate={setBandRoute}
            reload={reloadDocs}
            appTheme={theme.resolved}
            registerFlush={registerFlush}
            onOpenProjectFiles={(files, mode) => openProjectFiles(files, mode)}
            onImported={(pid, created) => {
              setRefreshKey((k) => k + 1);
              // 주소를 먼저 새 글로 옮긴 뒤 프로젝트를 다시 읽는다(빈 홈을 거치며 기록이 꼬이지 않게)
              if (created[0]) setBandRoute({ screen: "post", docId: created[0].id });
              void loadProject(pid);
            }}
          />
        ) : null}
        {PLATFORMS.filter((m) => m.status === "legacy" && visited.has(m.id)).map((m) => (
          <LegacyHost
            key={m.id}
            module={m}
            projectId={projectId}
            active={route.platform === m.id}
            ensureProject={ensureProject}
            registerFlush={registerFlush}
            appTheme={theme.resolved}
          />
        ))}
        {visited.has("zitsi") ? (
          <ArchiveModule module={platformOf("zitsi")} projectId={projectId} active={route.platform === "zitsi"} ensureProject={ensureProject} registerFlush={registerFlush} />
        ) : null}
      </div>
      {drawer ? (
        <ProjectDrawer
          currentId={projectId}
          refreshKey={refreshKey}
          onClose={() => setDrawer(false)}
          onOpen={(id) => {
            setDrawer(false);
            void switchProject(id);
          }}
          onCurrentRemoved={() => void switchProject(null)}
          onRenamed={(id, title) => id === projectId && setProjectTitle(title)}
          onNew={() => {
            setDrawer(false);
            void switchProject(null);
          }}
          onMerge={(fs) => {
            setDrawer(false);
            void openProjectFiles(fs, "merge").catch((e) => setNotice({ kind: "error", text: `합치기 실패: ${(e as Error).message}` }));
          }}
        />
      ) : null}
    </Shell>
  );
}
