// 원문 보관 모듈(짓시 채팅). RPBA에 짓시 도구가 없어 '복원'하지 않았다(명세 3.2·15.5).
// 넣은 텍스트와 파일을 그대로 보관하고 검색 가능한 평문으로 보여 준다. 작성자·시각을 추측해 채팅으로 바꾸지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { getModuleState, putModuleState } from "../../storage/repo";
import { describeStorageError } from "../../storage/db";
import { blobToDataUrl } from "../../exporters/html";
import { ShellSlot } from "../shell/Shell";
import { Icon } from "../../components/Icon";
import { downloadBlob, pickFiles } from "../download";
import type { PlatformModule } from "../shell/platforms";

interface ArchiveItem {
  id: string;
  name: string;
  addedAt: string;
  mime: string;
  /** 텍스트면 본문, 아니면 data URL */
  text?: string;
  dataUrl?: string;
}
interface ArchivePayload {
  items: ArchiveItem[];
}
const STATE_VERSION = 1;

export function ArchiveModule({
  module: m,
  projectId,
  active,
  ensureProject,
  registerFlush,
}: {
  module: PlatformModule;
  projectId: string | null;
  active: boolean;
  ensureProject(): Promise<string>;
  registerFlush(fn: () => Promise<void>): () => void;
}) {
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [status, setStatus] = useState<"saved" | "saving" | "error" | "empty">("empty");
  const [error, setError] = useState<string | null>(null);
  const pid = useRef(projectId);
  pid.current = projectId;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = projectId ? await getModuleState(projectId, m.id) : undefined;
      if (!alive) return;
      const list = (s?.payload as ArchivePayload | undefined)?.items ?? [];
      setItems(list);
      setSel(list[0]?.id ?? null);
      setStatus(list.length ? "saved" : "empty");
    })();
    return () => {
      alive = false;
    };
  }, [projectId, m.id]);

  const persist = useCallback(
    async (next: ArchiveItem[]) => {
      setItems(next);
      setStatus("saving");
      try {
        const id = pid.current ?? (await ensureProject());
        await putModuleState({ projectId: id, moduleId: m.id, stateVersion: STATE_VERSION, payload: { items: next } satisfies ArchivePayload });
        setStatus("saved");
        setError(null);
      } catch (e) {
        setStatus("error");
        setError(describeStorageError(e));
      }
    },
    [ensureProject, m.id],
  );

  useEffect(() => registerFlush(async () => undefined), [registerFlush]);

  const addText = async (name: string, text: string) => {
    const it: ArchiveItem = { id: crypto.randomUUID(), name, addedAt: new Date().toISOString(), mime: "text/plain", text };
    await persist([...items, it]);
    setSel(it.id);
  };

  const addFiles = async () => {
    const fs = await pickFiles("", true);
    const next = [...items];
    for (const f of fs) {
      const isText = f.type.startsWith("text/") || /\.(txt|log|json|csv|md)$/i.test(f.name);
      next.push({ id: crypto.randomUUID(), name: f.name, addedAt: new Date().toISOString(), mime: f.type || "application/octet-stream", ...(isText ? { text: await f.text() } : { dataUrl: await blobToDataUrl(f) }) });
    }
    if (fs.length) await persist(next);
  };

  const cur = items.find((i) => i.id === sel) ?? null;
  const lines = cur?.text?.split("\n") ?? [];
  const needle = q.trim().toLowerCase();

  return (
    <div className="archive-module" hidden={!active}>
      {active ? (
        <>
          <ShellSlot name="status">
            <span className={`save-status is-${status}`} role="status">
              {{ saved: "자동 저장됨", saving: "저장 중…", error: "저장 실패", empty: "보관한 자료 없음" }[status]}
            </span>
          </ShellSlot>
          <ShellSlot name="platformTools">
            <span className="legacy-badge is-archive" title={m.support}>
              원문 보관
            </span>
            <button type="button" className="ui-btn ui-btn-quiet" onClick={addFiles}>
              <Icon name="plus" size={16} /> 파일 보관
            </button>
          </ShellSlot>
        </>
      ) : null}
      <aside className="archive-side">
        <p className="notice">
          <b>짓시 채팅은 아직 전용 편집기가 없습니다.</b> 예전 RPBA에도 짓시 도구가 없어 복원하지 않았습니다. 넣은 텍스트·파일을 그대로 보관하고 평문으로 보여 줍니다. 작성자·시각을 추측해 채팅
          모양으로 바꾸지 않습니다.
        </p>
        {error ? <p className="notice error">{error}</p> : null}
        <ul className="plain-list doc-rows">
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" aria-current={it.id === sel} onClick={() => setSel(it.id)}>
                <span className="ellipsis">{it.name}</span>
                <span className="small muted">{new Date(it.addedAt).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
        <label className="field">
          <span>텍스트 붙여넣어 보관</span>
          <textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={!draft.trim()}
          onClick={async () => {
            await addText(`붙여넣기 ${items.length + 1}`, draft);
            setDraft("");
          }}
        >
          보관하기
        </button>
      </aside>
      <section className="archive-view" aria-label="보관한 원문">
        {cur ? (
          <>
            <div className="archive-view-head">
              <b className="ellipsis">{cur.name}</b>
              <span className="spacer" />
              {cur.text !== undefined ? <input type="search" placeholder="원문에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="원문 검색" /> : null}
              <button
                type="button"
                className="ui-btn ui-btn-small"
                onClick={async () => {
                  const blob = cur.text !== undefined ? new Blob([cur.text], { type: "text/plain;charset=utf-8" }) : await (await fetch(cur.dataUrl!)).blob();
                  downloadBlob(blob, cur.name.includes(".") ? cur.name : `${cur.name}.txt`);
                }}
              >
                <Icon name="download" size={14} /> 받기
              </button>
              <button type="button" className="ui-btn ui-btn-small" onClick={() => confirm(`"${cur.name}"을(를) 보관함에서 지울까요?`) && void persist(items.filter((i) => i.id !== cur.id))}>
                지우기
              </button>
            </div>
            {cur.text !== undefined ? (
              <ol className="archive-lines">
                {lines.map((l, i) => (needle && !l.toLowerCase().includes(needle) ? null : <li key={i}>{l || " "}</li>))}
              </ol>
            ) : (
              <p className="small muted">텍스트가 아닌 파일은 원본 그대로 보관합니다({cur.mime}).</p>
            )}
          </>
        ) : (
          <div className="empty-note">
            <p>보관한 원문이 없습니다.</p>
            <p className="small muted">왼쪽에 붙여넣거나 위의 '파일 보관'을 누르세요. 프로젝트 저장(.afterlog)에 함께 들어갑니다.</p>
          </div>
        )}
      </section>
    </div>
  );
}
