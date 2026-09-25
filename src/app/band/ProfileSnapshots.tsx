// 수집 확장이 보관한 인물 프로필 화면(스냅숏). 보이는 모습 그대로의 HTML(스크립트 없음, 이미지 내장).
// 옆칸(side)에서는 목록만, 글이 없는 프로젝트(main)에서는 화면 가운데에 바로 펼쳐 보인다.
import { useEffect, useState } from "react";
import type { SourceImport } from "../../domain/types";
import { listSources } from "../../storage/repo";
import { downloadBlob } from "../download";

const nameOf = (s: SourceImport) => s.fileName.replace(/^프로필_/, "").replace(/\.html$/, "").replace(/_/g, " ");

export function useProfileSnapshots(projectId: string | null, refreshKey?: unknown) {
  const [list, setList] = useState<SourceImport[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (!projectId) {
      setList([]);
      return;
    }
    void listSources(projectId).then((s) => alive && setList(s.filter((x) => (x.kind as string | undefined) === "band-profile-snapshot")));
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey]);
  return list;
}

function openInTab(s: SourceImport) {
  const url = URL.createObjectURL(new Blob([s.blob], { type: "text/html;charset=utf-8" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ProfileSnapshots({ projectId, refreshKey, variant = "side" }: { projectId: string | null; refreshKey?: unknown; variant?: "side" | "main" }) {
  const list = useProfileSnapshots(projectId, refreshKey) ?? [];
  const [sel, setSel] = useState(0);
  const [html, setHtml] = useState<string | null>(null);
  const cur = list[Math.min(sel, list.length - 1)] ?? null;
  useEffect(() => {
    let alive = true;
    setHtml(null);
    if (variant === "main" && cur) void cur.blob.text().then((t) => alive && setHtml(t));
    return () => {
      alive = false;
    };
  }, [variant, cur]);
  if (!list.length) return null;

  if (variant === "main")
    return (
      <section className="profile-main" aria-label="인물 프로필 보관">
        <div className="profile-main-head">
          <h2>인물 프로필 보관 {list.length}명</h2>
          {list.length > 1 ? (
            <div className="profile-main-tabs" role="tablist">
              {list.map((s, i) => (
                <button key={s.id} type="button" role="tab" aria-selected={s === cur} className={s === cur ? "is-on" : ""} onClick={() => setSel(i)}>
                  {nameOf(s)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {cur ? (
          <>
            <div className="profile-main-bar">
              <b className="ellipsis">{nameOf(cur)}</b>
              <small className="muted">보관 {new Date(cur.importedAt).toLocaleString()}</small>
              <span className="grow" />
              {cur.sourceUrl ? (
                <a className="ui-link" href={cur.sourceUrl} target="_blank" rel="noreferrer">
                  밴드에서 열기 ↗
                </a>
              ) : null}
              <button type="button" className="ui-link" onClick={() => openInTab(cur)}>
                새 탭
              </button>
              <button type="button" className="ui-link" onClick={() => downloadBlob(cur.blob, cur.fileName)}>
                받기
              </button>
            </div>
            {html === null ? (
              <p className="muted">불러오는 중…</p>
            ) : (
              <iframe className="profile-main-frame" title={`${nameOf(cur)} 프로필 보관본`} sandbox="" srcDoc={html} />
            )}
            <p className="small muted">보관 당시 보이던 모습 그대로입니다(누르는 기능은 동작하지 않음).</p>
          </>
        ) : null}
      </section>
    );

  return (
    <section className="profile-snapshots" aria-label="인물 프로필 보관">
      <b>인물 프로필 보관 {list.length}</b>
      <ul>
        {list.map((s) => (
          <li key={s.id}>
            <span className="ellipsis" title={s.sourceUrl}>
              {nameOf(s)}
            </span>
            <small className="muted">{new Date(s.importedAt).toLocaleDateString()}</small>
            <span className="profile-snapshot-actions">
              <button type="button" className="ui-link" onClick={() => openInTab(s)}>
                열기
              </button>
              <button type="button" className="ui-link" onClick={() => downloadBlob(s.blob, s.fileName)}>
                받기
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p className="small muted">보관 당시 보이던 모습 그대로입니다(누르는 기능은 동작하지 않음).</p>
    </section>
  );
}
