// 기존 RPBA 도구(카톡·카페·트위터·DM)를 같은 출처 iframe으로 연결하는 부모 쪽 다리(명세 v1.2 15.3).
// 명령마다 protocol·requestId·moduleId를 붙이고, 응답은 출처(origin)와 보낸 창(source)을 확인한 뒤에만 받는다.
// 상태(원문·인물·설정·첨부·수정)는 모듈이 직렬화해 돌려주고, 부모가 프로젝트에 버전과 함께 저장한다.
// iframe은 CSS·스크립트 경계를 나누는 임시 구조이며 강한 보안 격리가 아니다(자체 코드만 싣는다).
import { useCallback, useEffect, useRef, useState } from "react";
import { getModuleState, putModuleState } from "../../storage/repo";
import { describeStorageError } from "../../storage/db";
import { ShellSlot } from "../shell/Shell";
import { Icon } from "../../components/Icon";
import { MenuButton } from "../../components/Menu";
import { downloadBlob, pickFiles } from "../download";
import type { PlatformModule } from "../shell/platforms";

export const LEGACY_PROTOCOL = "afterlog-legacy";
export const LEGACY_PROTOCOL_VERSION = 1;

interface Capabilities {
  undo: boolean;
  export: ("html" | "png" | "copy")[];
  importText: boolean;
}
type ChildMsg =
  | { protocol: typeof LEGACY_PROTOCOL; v: number; moduleId: string; type: "ready"; capabilities: Capabilities; stateVersion: number }
  | { protocol: typeof LEGACY_PROTOCOL; v: number; moduleId: string; type: "dirty" }
  | { protocol: typeof LEGACY_PROTOCOL; v: number; moduleId: string; type: "response"; requestId: string; ok: boolean; result?: unknown; error?: string };

type Status = "loading" | "saved" | "dirty" | "saving" | "error" | "empty";
const STATUS_LABEL: Record<Status, string> = { loading: "여는 중…", saved: "자동 저장됨", dirty: "변경됨", saving: "저장 중…", error: "저장 실패", empty: "새 초안" };
const SAVE_DELAY = 1200;

export function LegacyHost({
  module: m,
  projectId,
  active,
  ensureProject,
  registerFlush,
  appTheme,
}: {
  module: PlatformModule;
  projectId: string | null;
  active: boolean;
  ensureProject(): Promise<string>;
  registerFlush(fn: () => Promise<void>): () => void;
  appTheme: "light" | "dark";
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [stateVersion, setStateVersion] = useState(1);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pending = useRef(new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>());
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const pid = useRef(projectId);
  const adopted = useRef<string | null>(null);
  const saving = useRef<Promise<void> | null>(null);

  const post = useCallback(
    (type: string, payload?: unknown): Promise<unknown> => {
      const win = frame.current?.contentWindow;
      if (!win || !caps) return Promise.reject(new Error("도구가 아직 준비되지 않았습니다."));
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        pending.current.set(requestId, { resolve, reject });
        win.postMessage({ protocol: LEGACY_PROTOCOL, v: LEGACY_PROTOCOL_VERSION, moduleId: m.id, requestId, type, payload }, location.origin);
        window.setTimeout(() => {
          if (pending.current.delete(requestId)) reject(new Error("도구가 응답하지 않습니다."));
        }, 60_000);
      });
    },
    [caps, m.id],
  );

  /** 지금 상태를 받아 프로젝트에 저장. 실패하면 성공으로 표시하지 않는다 */
  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (saving.current) await saving.current;
    if (!dirty.current || !caps) return;
    const run = (async () => {
      setStatus("saving");
      try {
        dirty.current = false;
        const snapshot = await post("snapshot");
        let id = pid.current;
        if (!id) {
          id = await ensureProject();
          adopted.current = id;
          pid.current = id;
        }
        await putModuleState({ projectId: id, moduleId: m.id, stateVersion, payload: snapshot });
        setError(null);
        setStatus(dirty.current ? "dirty" : "saved");
      } catch (e) {
        dirty.current = true;
        setError(describeStorageError(e));
        setStatus("error");
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [caps, post, ensureProject, m.id, stateVersion]);

  useEffect(() => registerFlush(save), [registerFlush, save]);

  // 모듈 메시지 받기: 출처·보낸 창·규격 확인
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as ChildMsg;
      if (!d || d.protocol !== LEGACY_PROTOCOL || d.moduleId !== m.id) return;
      if (d.type === "ready") {
        setCaps(d.capabilities);
        setStateVersion(d.stateVersion);
      } else if (d.type === "dirty") {
        dirty.current = true;
        setStatus("dirty");
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void save(), SAVE_DELAY);
      } else if (d.type === "response") {
        const p = pending.current.get(d.requestId);
        if (!p) return;
        pending.current.delete(d.requestId);
        if (d.ok) p.resolve(d.result);
        else p.reject(new Error(d.error || "도구 오류"));
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [m.id, save]);

  // 준비되면(또는 프로젝트가 바뀌면) 저장된 상태를 넣는다. 우리가 방금 만든 프로젝트로 옮긴 경우는 다시 넣지 않는다
  useEffect(() => {
    if (!caps) return;
    if (projectId && projectId === adopted.current) {
      pid.current = projectId;
      return;
    }
    pid.current = projectId;
    let alive = true;
    void (async () => {
      setStatus("loading");
      try {
        const stored = projectId ? await getModuleState(projectId, m.id) : undefined;
        if (!alive) return;
        if (stored && stored.stateVersion > stateVersion) {
          setNote(`이 프로젝트의 ${m.label} 자료는 더 새 버전(상태 ${stored.stateVersion})에서 저장됐습니다. 덮어쓰지 않도록 읽기만 합니다.`);
        }
        await post("load", stored?.payload ?? null);
        dirty.current = false;
        setStatus(stored ? "saved" : "empty");
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          setStatus("error");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [caps, projectId, m.id, m.label, post, stateVersion]);

  useEffect(() => {
    if (caps) void post("setTheme", appTheme).catch(() => undefined);
  }, [caps, appTheme, post]);

  // 창을 닫기 전 남은 변경 저장 시도
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        void save();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [save]);

  const doExport = async (format: "html" | "png" | "copy") => {
    setNote(null);
    try {
      const r = (await post("export", { format })) as { files?: { name: string; blob: Blob }[]; text?: string };
      if (format === "copy" && typeof r.text === "string") {
        await navigator.clipboard.writeText(r.text);
        setNote("HTML을 클립보드에 복사했습니다.");
      } else if (r.files?.length) {
        for (const f of r.files) downloadBlob(f.blob, f.name);
        setNote(`${r.files.length}개 파일을 받았습니다.`);
      } else setNote("내보낼 내용이 없습니다.");
    } catch (e) {
      setNote(`내보내기 실패: ${(e as Error).message}`);
    }
  };

  const src = `${import.meta.env.BASE_URL}${m.legacyEntry}${m.legacyEntry!.includes("?") ? "&" : "?"}moduleId=${m.id}`;

  return (
    <div className="legacy-host" hidden={!active}>
      {active ? (
        <>
          <ShellSlot name="status">
            <span className={`save-status is-${status}`} role="status" aria-live="polite" title={error ?? undefined}>
              {STATUS_LABEL[status]}
            </span>
          </ShellSlot>
          <ShellSlot name="actions">
            <button
              type="button"
              className="ui-icon-btn"
              aria-label="실행취소"
              title={caps?.undo ? "실행취소" : "이 도구는 상단 실행취소를 지원하지 않습니다. 입력칸 안에서는 Ctrl+Z가 동작합니다."}
              disabled={!caps?.undo}
              onClick={() => void post("undo")}
            >
              <Icon name="undo" />
            </button>
            <button type="button" className="ui-icon-btn" aria-label="다시실행" title={caps?.undo ? "다시실행" : "이 도구는 상단 다시실행을 지원하지 않습니다."} disabled={!caps?.undo} onClick={() => void post("redo")}>
              <Icon name="redo" />
            </button>
          </ShellSlot>
          <ShellSlot name="primary">
            <MenuButton
              className="ui-btn ui-btn-primary"
              label="내보내기"
              align="right"
              items={() => [
                { label: "HTML 파일", disabled: !caps?.export.includes("html"), onSelect: () => void doExport("html") },
                { label: "PNG 이미지", disabled: !caps?.export.includes("png"), onSelect: () => void doExport("png") },
                { label: "HTML 복사", disabled: !caps?.export.includes("copy"), onSelect: () => void doExport("copy") },
              ]}
            >
              내보내기
            </MenuButton>
          </ShellSlot>
          <ShellSlot name="platformTools">
            <span className="legacy-badge" title={m.support}>
              기존 편집기
            </span>
            <button
              type="button"
              className="ui-btn ui-btn-quiet"
              disabled={!caps?.importText}
              onClick={async () => {
                const [f] = await pickFiles(".txt,text/plain", false);
                if (!f) return;
                await post("importText", await f.text());
              }}
            >
              <Icon name="plus" size={16} /> 텍스트 파일 열기
            </button>
          </ShellSlot>
        </>
      ) : null}
      {active && (error || note) ? (
        <div className={`banner ${error ? "error" : "ok"}`} role={error ? "alert" : "status"}>
          {error ? `${m.label}: ${error} 입력한 내용은 도구 안에 남아 있습니다.` : note}
          {error ? (
            <button type="button" className="ui-btn ui-btn-small" onClick={() => void save()}>
              다시 저장
            </button>
          ) : null}
          <button type="button" className="ui-icon-btn" aria-label="알림 닫기" onClick={() => (setError(null), setNote(null))}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
      <iframe ref={frame} className="legacy-frame" title={`${m.longLabel} (기존 편집기)`} src={src} />
    </div>
  );
}
