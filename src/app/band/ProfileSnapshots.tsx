// 수집 확장이 보관한 인물 프로필 화면(스냅숏). 보이는 모습 그대로의 HTML이라 새 탭에서 연다(스크립트 없음).
import { useEffect, useState } from "react";
import type { SourceImport } from "../../domain/types";
import { listSources } from "../../storage/repo";
import { downloadBlob } from "../download";

export function ProfileSnapshots({ projectId, refreshKey }: { projectId: string | null; refreshKey?: unknown }) {
  const [list, setList] = useState<SourceImport[]>([]);
  useEffect(() => {
    let alive = true;
    if (!projectId) return setList([]);
    void listSources(projectId).then((s) => alive && setList(s.filter((x) => (x.kind as string | undefined) === "band-profile-snapshot")));
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey]);
  if (!list.length) return null;
  const open = (s: SourceImport) => {
    const url = URL.createObjectURL(new Blob([s.blob], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <section className="profile-snapshots" aria-label="인물 프로필 보관">
      <b>인물 프로필 보관 {list.length}</b>
      <ul>
        {list.map((s) => (
          <li key={s.id}>
            <span className="ellipsis" title={s.sourceUrl}>
              {s.fileName.replace(/^프로필_/, "").replace(/\.html$/, "").replace(/_/g, " ")}
            </span>
            <small className="muted">{new Date(s.importedAt).toLocaleDateString()}</small>
            <span className="profile-snapshot-actions">
              <button type="button" className="ui-link" onClick={() => open(s)}>
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
