import { useEffect, useState } from "react";
import type { Project } from "../../domain/types";
import { listProjects, purgeProject, renameProject, trashProject } from "../../storage/repo";
import { importProjectFile } from "../../exporters/afterlog";
import { pickFiles } from "../download";

export function ProjectDrawer({
  currentId,
  onOpen,
  onClose,
  onCurrentRemoved,
  refreshKey,
}: {
  currentId: string | null;
  onOpen(id: string): void;
  onClose(): void;
  onCurrentRemoved(): void;
  refreshKey: number;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = async () => setProjects(await listProjects());
  useEffect(() => {
    void reload();
  }, [refreshKey]);

  const active = projects.filter((p) => !p.deletedAt);
  const trashed = projects.filter((p) => p.deletedAt);

  const load = async () => {
    const [f] = await pickFiles(".afterlog,.zip", false);
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await importProjectFile(f);
      await reload();
      setMsg({ kind: "ok", text: `"${p.title}" 프로젝트를 새 사본으로 불러왔습니다.` });
      onOpen(p.id);
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="프로젝트">
        <div className="panel-head">
          <strong>프로젝트</strong>
          <button type="button" className="ui-icon-btn" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="panel-body">
          <button type="button" className="ui-btn" disabled={busy} onClick={load}>
            {busy ? "불러오는 중…" : "프로젝트 파일(.afterlog) 불러오기"}
          </button>
          <small className="muted">불러오면 항상 새 사본이 만들어지고 지금 프로젝트는 그대로 남습니다.</small>
          {msg ? <p className={`notice ${msg.kind}`}>{msg.text}</p> : null}
          <ul className="project-list">
            {active.map((p) => (
              <li key={p.id} className={p.id === currentId ? "is-current" : undefined}>
                <button type="button" className="project-open" onClick={() => onOpen(p.id)}>
                  <span className="ellipsis" title={p.title}>
                    {p.title}
                  </span>
                  <small className="muted">
                    문서 {p.documentIds.length} · {new Date(p.updatedAt).toLocaleString()}
                  </small>
                </button>
                <button
                  type="button"
                  className="ui-icon-btn"
                  aria-label={`${p.title} 이름 바꾸기`}
                  title="이름 바꾸기"
                  onClick={async () => {
                    const t = window.prompt("프로젝트 이름", p.title);
                    if (t && t.trim()) {
                      await renameProject(p.id, t.trim());
                      await reload();
                    }
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="ui-icon-btn"
                  aria-label={`${p.title} 휴지통으로`}
                  title="휴지통으로"
                  onClick={async () => {
                    await trashProject(p.id, true);
                    if (p.id === currentId) onCurrentRemoved();
                    await reload();
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
            {!active.length ? <li className="muted small">아직 프로젝트가 없습니다.</li> : null}
          </ul>
          {trashed.length ? (
            <details>
              <summary>휴지통 ({trashed.length})</summary>
              <ul className="project-list">
                {trashed.map((p) => (
                  <li key={p.id}>
                    <span className="ellipsis">{p.title}</span>
                    <button
                      type="button"
                      className="ui-btn ui-btn-small"
                      onClick={async () => {
                        await trashProject(p.id, false);
                        await reload();
                      }}
                    >
                      복원
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn-small is-danger"
                      onClick={async () => {
                        if (!window.confirm(`"${p.title}"을(를) 영구 삭제할까요? 원문·이미지까지 모두 지워지며 되돌릴 수 없습니다.`)) return;
                        await purgeProject(p.id);
                        await reload();
                      }}
                    >
                      영구 삭제
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
