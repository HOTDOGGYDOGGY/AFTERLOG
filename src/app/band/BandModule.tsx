// 밴드 모듈: 원형 보기(밴드 홈 피드 → 글 상세 레이어 → 인물 프로필 → 해당 댓글)를 기본으로 하고,
// 꾸미기(오른쪽 패널)와 내용 편집(작업 화면)은 사용자가 명시적으로 열 때만 보여 준다(명세 v1.2 27절).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentData, ViewSettings } from "../../domain/types";
import { db } from "../../storage/db";
import { saveDocument } from "../../storage/repo";
import { normalizeDocument } from "../../domain/migrate";
import { nowIso } from "../../domain/ids";
import { buildPeople } from "../PersonArchive";
import { useAssets } from "../useAssets";
import { ShellSlot } from "../shell/Shell";
import { Icon } from "../../components/Icon";
import { backInApp, type BandRoute, type PersonTab } from "../nav";
import { BandHome } from "./BandHome";
import { DocSession, type BandViewMode } from "./DocSession";
import { PersonLayer } from "./PersonLayer";
import { ImportPanel } from "../panels/ImportPanel";
import { CaptureReports } from "../panels/CaptureReports";
import { ExportDialog } from "../panels/ExportDialog";
import type { AppThemeResolved } from "../../renderers/band/style";

export function BandModule({
  active,
  projectId,
  projectTitle,
  docs,
  captureReports,
  route,
  navigate,
  reload,
  onImported,
  onOpenProjectFiles,
  appTheme,
  registerFlush,
}: {
  active: boolean;
  projectId: string | null;
  projectTitle: string;
  docs: DocumentData[];
  captureReports: unknown[];
  route: BandRoute;
  navigate(r: BandRoute, opts?: { replace?: boolean }): void;
  reload(): Promise<void>;
  onImported(projectId: string, docs: DocumentData[]): void;
  /** .afterlog 파일을 가져오기 칸에 넣었을 때 프로젝트로 열기 */
  onOpenProjectFiles?(files: File[]): Promise<void>;
  appTheme: AppThemeResolved;
  registerFlush(fn: () => Promise<void>): () => void;
}) {
  const [mode, setMode] = useState<BandViewMode>("original");
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const assets = useAssets(projectId);
  const people = useMemo(() => buildPeople(docs), [docs]);
  const sessionFlush = useRef<(() => Promise<void>) | null>(null);

  const register = useCallback(
    (fn: () => Promise<void>) => {
      sessionFlush.current = fn;
      const off = registerFlush(fn);
      return () => {
        if (sessionFlush.current === fn) sessionFlush.current = null;
        off();
      };
    },
    [registerFlush],
  );

  // 가져오기로 자산이 늘면 다시 읽는다
  useEffect(() => {
    void assets.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.length]);

  const openDoc = route.screen === "post" ? docs.find((d) => d.id === route.docId) ?? null : null;
  // 편집 모드인데 글이 열려 있지 않으면 첫 글로
  const editDoc = mode === "edit" ? openDoc ?? docs[0] ?? null : null;
  const sessionDoc = editDoc ?? openDoc;

  // 없는 글·인물 주소는 홈으로(삭제된 글 등)
  useEffect(() => {
    if (route.screen === "post" && docs.length && !openDoc) navigate({ screen: "home" }, { replace: true });
    if (route.screen === "person" && docs.length && !people.some((p) => p.key === route.person)) navigate({ screen: "home" }, { replace: true });
  }, [route, docs.length, openDoc, people, navigate]);

  // 글이 하나뿐이면 목록 대신 바로 상세(빈 목록을 넓게 강제하지 않음)
  // 처음 들어왔을 때 한 번만(닫고 나면 다시 열지 않음)
  const autoOpened = useRef(route.screen !== "home");
  useEffect(() => {
    if (autoOpened.current || route.screen !== "home" || docs.length !== 1) return;
    autoOpened.current = true;
    navigate({ screen: "post", docId: docs[0].id }, { replace: true });
  }, [docs, route.screen, navigate]);

  const closeLayer = useCallback(async () => {
    await sessionFlush.current?.();
    if (!backInApp()) navigate({ screen: "home" }, { replace: true });
    await reload();
  }, [navigate, reload]);

  const openPersonOf = useCallback(
    async (docId: string, identityId: string) => {
      const p = people.find((x) => x.identities.some((i) => i.docId === docId && i.identity.id === identityId));
      if (!p) return;
      await sessionFlush.current?.();
      await reload();
      navigate({ screen: "person", person: p.key });
    },
    [people, navigate, reload],
  );

  const switchDoc = useCallback(
    async (id: string, entryId?: string) => {
      await sessionFlush.current?.();
      await reload();
      navigate({ screen: "post", docId: id, entryId });
    },
    [navigate, reload],
  );

  const applyToAll = useCallback(
    async (view: ViewSettings) => {
      for (const d of docs) {
        if (sessionDoc && d.id === sessionDoc.id) continue;
        const cur = await db().documents.get(d.id);
        if (!cur) continue;
        const fresh = normalizeDocument(cur);
        await saveDocument({ ...fresh, view: { ...fresh.view, style: structuredClone(view.style), skinFamily: view.skinFamily, width: view.width, show: { ...view.show }, missingImages: view.missingImages } }, fresh.revision);
      }
      await reload();
    },
    [docs, sessionDoc, reload],
  );

  const saveProjectDefault = useCallback(
    async (view: ViewSettings) => {
      if (!projectId) return;
      await db().projects.update(projectId, { defaultView: structuredClone(view), updatedAt: nowIso() });
    },
    [projectId],
  );

  const importButton = !active ? null : (
    <ShellSlot name="platformTools">
      <button type="button" className="ui-btn ui-btn-quiet" onClick={() => setImportOpen(true)}>
        <Icon name="plus" size={16} /> 가져오기
      </button>
    </ShellSlot>
  );

  const importSheet = importOpen ? (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setImportOpen(false)}>
      <aside className="drawer drawer-left" role="dialog" aria-modal="true" aria-label="밴드 기록 가져오기">
        <div className="panel-head">
          <strong>밴드 기록 가져오기</strong>
          <button type="button" className="ui-icon-btn" aria-label="닫기" onClick={() => setImportOpen(false)}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="panel-body">
          <CaptureReports reports={captureReports} />
          <ImportPanel
            projectId={projectId}
            onOpenProjectFiles={onOpenProjectFiles}
            onImported={(pid, created) => {
              setImportOpen(false);
              onImported(pid, created);
            }}
          />
        </div>
      </aside>
    </div>
  ) : null;

  // ---------- 자료가 없을 때 ----------
  if (!projectId || docs.length === 0) {
    return (
      <div className="band-module" hidden={!active}>
        {importButton}
        <BandEmpty projectId={projectId} onImported={onImported} onOpenProjectFiles={onOpenProjectFiles} />
        {importSheet}
      </div>
    );
  }

  const personRoute = route.screen === "person" ? people.find((p) => p.key === route.person) ?? null : null;
  const layerOpen = mode !== "edit" && (!!openDoc || !!personRoute || route.screen === "chat");

  return (
    <div className="band-module" hidden={!active}>
      {importButton}
      {!sessionDoc && active ? (
        <>
          <ShellSlot name="actions">
            <button type="button" className="ui-btn ui-btn-quiet" disabled aria-label="꾸미기" title="글을 열면 그 글의 디자인을 바꿀 수 있습니다">
              <Icon name="brush" size={16} />
              <span className="hide-narrow">꾸미기</span>
            </button>
            <button type="button" className="ui-btn ui-btn-quiet" aria-label="내용 편집" onClick={() => setMode("edit")} title="본문·작성자·순서·답글 관계 고치기">
              <Icon name="edit" size={16} />
              <span className="hide-narrow">내용 편집</span>
            </button>
          </ShellSlot>
          <ShellSlot name="primary">
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setExportOpen(true)}>
              내보내기
            </button>
          </ShellSlot>
        </>
      ) : null}

      {mode !== "edit" ? (
        <BandHome
          title={projectTitle}
          docs={docs}
          people={people}
          assetUrl={assets.url}
          appTheme={appTheme}
          dimmed={layerOpen}
          captureCount={captureReports.length}
          onOpenDoc={(id) => navigate({ screen: "post", docId: id })}
          onOpenPerson={(key) => navigate({ screen: "person", person: key })}
          onOpenChat={() => navigate({ screen: "chat" })}
        />
      ) : null}

      {sessionDoc ? (
        <DocSession
          key={sessionDoc.id}
          initial={sessionDoc}
          docs={docs}
          projectId={projectId}
          projectTitle={projectTitle}
          captureReports={captureReports}
          active={active}
          mode={mode}
          setMode={setMode}
          entryId={route.screen === "post" ? route.entryId : undefined}
          appTheme={appTheme}
          assets={assets}
          onCloseDetail={closeLayer}
          onSwitchDoc={switchDoc}
          onImported={onImported}
          onOpenPerson={openPersonOf}
          registerFlush={register}
          onApplyToAll={applyToAll}
          onSaveProjectDefault={saveProjectDefault}
        />
      ) : null}

      {mode !== "edit" && personRoute ? (
        <div className="band-stage">
          <div className="band-dim" onClick={closeLayer} aria-hidden="true" />
          <div className="band-layer" role="dialog" aria-label={`인물 프로필: ${personRoute.identities[0].identity.displayName}`}>
            <PersonLayer
              person={personRoute}
              docs={docs}
              tab={(route.screen === "person" && route.tab) || (personRoute.posts.length || !personRoute.comments.length ? "posts" : "comments")}
              onTab={(t: PersonTab) => navigate({ screen: "person", person: personRoute.key, tab: t }, { replace: true })}
              assetUrl={assets.url}
              appTheme={appTheme}
              onJump={(docId, entryId) => navigate({ screen: "post", docId, entryId })}
            />
          </div>
          <button type="button" className="band-layer-close" aria-label="프로필 닫기" onClick={closeLayer}>
            <Icon name="close" size={26} />
          </button>
          {active ? <EscToClose onClose={closeLayer} /> : null}
        </div>
      ) : null}

      {mode !== "edit" && route.screen === "chat" ? (
        <div className="band-stage">
          <div className="band-dim" onClick={closeLayer} aria-hidden="true" />
          <div className="band-layer band-chat-layer" role="dialog" aria-label="밴드 채팅">
            <div className="empty-note">
              <p>
                <b>보관된 밴드 채팅이 없습니다.</b>
              </p>
              <p className="small muted">
                밴드 채팅 저장은 아직 지원하지 않습니다. 채팅방 화면의 구조(날짜 구분·첨부·답장·표정·과거 대화 불러오기)를 실제 샘플로 확인한 뒤 수집 확장에 추가합니다. 샘플만 보이는
                입력창이나 가짜 대화를 만들지 않습니다.
              </p>
            </div>
          </div>
          <button type="button" className="band-layer-close" aria-label="채팅 닫기" onClick={closeLayer}>
            <Icon name="close" size={26} />
          </button>
          {active ? <EscToClose onClose={closeLayer} /> : null}
        </div>
      ) : null}

      {exportOpen ? <ExportDialog doc={null} docs={docs} getBlob={assets.getBlob} appTheme={appTheme} projectTitle={projectTitle} onClose={() => setExportOpen(false)} /> : null}
      {importSheet}
    </div>
  );
}

function EscToClose({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector(".modal-backdrop, .drawer-backdrop, .lightbox")) return;
      onClose();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return null;
}

/** 처음 화면: 파일 열기·붙여넣기 두 동작만 주요 버튼으로(명세 4.3). 가짜 예시 자료를 프로젝트에 넣지 않는다 */
function BandEmpty({
  projectId,
  onImported,
  onOpenProjectFiles,
}: {
  projectId: string | null;
  onImported(pid: string, docs: DocumentData[]): void;
  onOpenProjectFiles?(files: File[]): Promise<void>;
}) {
  return (
    <div className="band-empty">
      <div className="band-empty-inner">
        <h1>밴드 기록을 가져오세요.</h1>
        <ImportPanel projectId={projectId} onImported={onImported} onOpenProjectFiles={onOpenProjectFiles} variant="start" />
      </div>
    </div>
  );
}
