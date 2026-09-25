import { useEffect, useMemo, useState } from "react";
import type { Project } from "../../domain/types";
import { listProjects, purgeProject, renameProject, trashProject } from "../../storage/repo";
import { exportProjectFile, importProjectFiles } from "../../exporters/afterlog";
import { db } from "../../storage/db";
import { pickFiles } from "../download";
import { Icon } from "../../components/Icon";
import { platformOf } from "../shell/platforms";

export function ProjectDrawer({
  currentId,
  onOpen,
  onClose,
  onCurrentRemoved,
  refreshKey,
  onRenamed,
  onNew,
  onMerge,
}: {
  currentId: string | null;
  onOpen(id: string): void;
  onClose(): void;
  onCurrentRemoved(): void;
  refreshKey: number;
  onRenamed?(id: string, title: string): void;
  /** 빈 상태로 새로 시작(다음에 자료를 넣으면 임시 이름으로 만들어짐) */
  onNew?(): void;
  /** 고른 .afterlog를 지금 프로젝트에 합치기 */
  onMerge?(files: File[]): void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [modules, setModules] = useState<Map<string, string[]>>(new Map());
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    setProjects(await listProjects());
    const m = new Map<string, string[]>();
    for (const r of await db().modules.toArray()) m.set(r.projectId, [...(m.get(r.projectId) ?? []), r.moduleId]);
    setModules(m);
  };
  useEffect(() => {
    void reload();
  }, [refreshKey]);

  const active = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = projects.filter((p) => !p.deletedAt && (!needle || p.title.toLowerCase().includes(needle)));
    return sort === "name" ? [...list].sort((a, b) => a.title.localeCompare(b.title, "ko")) : list;
  }, [projects, q, sort]);
  const trashed = projects.filter((p) => p.deletedAt);

  const load = async () => {
    const fs = await pickFiles(".afterlog,.zip", true);
    if (!fs.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await importProjectFiles(fs);
      const p = r.project;
      await reload();
      setMsg({
        kind: r.missingParts.length ? "error" : "ok",
        text: r.missingParts.length
          ? `"${p.title}"을(를) 불러왔지만 ${r.partCount}개 파트 중 ${r.missingParts.join(", ")}번 파트가 없어 이미지 ${r.missingAssets}개가 빠졌습니다. 빠진 파트와 함께 다시 불러오면 채워집니다.`
          : `"${p.title}" 프로젝트를 새 사본으로 불러왔습니다${r.partCount > 1 ? ` (파트 ${r.partCount}개)` : ""}.`,
      });
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
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="panel-body">
          <div className="row-actions">
            {onNew ? (
              <button type="button" className="ui-btn" onClick={onNew}>
                <Icon name="plus" size={14} /> 새 프로젝트
              </button>
            ) : null}
            <button type="button" className="ui-btn" disabled={busy} onClick={load}>
              <Icon name="folder" size={14} /> {busy ? "불러오는 중…" : "파일 열기 (.afterlog)"}
            </button>
            {currentId && onMerge ? (
              <button
                type="button"
                className="ui-btn"
                disabled={busy}
                onClick={async () => {
                  const fs = await pickFiles(".afterlog,.zip", true);
                  if (fs.length) onMerge(fs);
                }}
              >
                <Icon name="plus" size={14} /> 지금 프로젝트에 합치기
              </button>
            ) : null}
          </div>
          <small className="muted">
            '파일 열기'는 새 사본 프로젝트로 엽니다. '지금 프로젝트에 합치기'는 같은 글·프로필 보관본은 건너뛰고(댓글을 더 많이 확보한 새 자료면 갱신, 고친 글은 그대로) 새 것만 더합니다. 여러
            파트로 나뉜 파일은 한꺼번에 선택하세요.
          </small>
          {msg ? <p className={`notice ${msg.kind}`}>{msg.text}</p> : null}
          <div className="project-filter">
            <input type="search" placeholder="프로젝트 이름으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="프로젝트 찾기" />
            <select value={sort} onChange={(e) => setSort(e.target.value as "recent" | "name")} aria-label="정렬">
              <option value="recent">최근 작업</option>
              <option value="name">이름</option>
            </select>
          </div>
          <ul className="project-list">
            {active.map((p) => (
              <li key={p.id} className={p.id === currentId ? "is-current" : undefined}>
                <button type="button" className="project-open" onClick={() => onOpen(p.id)}>
                  <span className="ellipsis" title={p.title}>
                    {p.title}
                  </span>
                  <small className="muted">
                    {[p.documentIds.length ? `밴드 글 ${p.documentIds.length}` : "", ...(modules.get(p.id) ?? []).map((m) => platformOf(m).label)].filter(Boolean).join(" · ") || "비어 있음"} ·{" "}
                    {new Date(p.updatedAt).toLocaleString()} · 이 브라우저에 저장됨
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
                      onRenamed?.(p.id, t.trim());
                      await reload();
                    }
                  }}
                >
                  <Icon name="edit" size={15} />
                </button>
                <button
                  type="button"
                  className="ui-icon-btn"
                  aria-label={`${p.title} 복제`}
                  title="복제(새 사본)"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const { files } = await exportProjectFile(p.id);
                      const r = await importProjectFiles(files.map((f) => f.blob));
                      await renameProject(r.project.id, `${p.title} 사본`);
                      await reload();
                      setMsg({ kind: "ok", text: `"${p.title} 사본"을 만들었습니다.` });
                    } catch (e) {
                      setMsg({ kind: "error", text: `복제 실패: ${(e as Error).message}` });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Icon name="plus" size={15} />
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
                  <Icon name="close" size={15} />
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
