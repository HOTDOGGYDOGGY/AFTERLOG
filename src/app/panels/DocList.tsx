import { useMemo, useState } from "react";
import type { DocumentData } from "../../domain/types";
import { blocksToPlainText } from "../../importers/band/html";

/** 프로젝트의 문서(글) 목록과 검색. 수집 확장으로 가져온 글이 많을 때 쓴다(A3 문서 목록·검색) */
export function DocList({ docs, currentId, onOpen }: { docs: DocumentData[]; currentId: string; onOpen(id: string, entryId?: string): void }) {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      docs.map((d) => {
        const root = (d.children.root ?? []).map((id) => d.entries[id]).find((e) => e?.kind === "post");
        const comments = Object.values(d.entries).filter((e) => e.kind === "comment").length;
        const openIssues = d.issues.filter((i) => !i.resolved).length;
        return { d, time: root?.time?.raw ?? "", local: root?.time?.local ?? "", comments, openIssues };
      }),
    [docs],
  );
  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!needle) return null;
    const out: { docId: string; entryId: string; title: string; who: string; text: string }[] = [];
    for (const d of docs) {
      for (const e of Object.values(d.entries)) {
        const t = blocksToPlainText(e.blocks);
        const who = e.authorId ? d.identities[e.authorId]?.displayName ?? "" : "";
        if (t.toLowerCase().includes(needle) || who.toLowerCase().includes(needle)) out.push({ docId: d.id, entryId: e.id, title: d.title, who, text: t });
        if (out.length >= 200) return out;
      }
    }
    return out;
  }, [docs, needle]);

  return (
    <div className="doc-list">
      <input type="search" className="doc-search" placeholder="모든 글·댓글에서 찾기 (본문·이름)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="문서 검색" />
      {hits ? (
        <>
          <p className="small muted">
            {hits.length >= 200 ? "200개 이상" : `${hits.length}개`} 찾음
          </p>
          <ul className="plain-list hit-list">
            {hits.map((h) => (
              <li key={`${h.docId}:${h.entryId}`}>
                <button type="button" onClick={() => onOpen(h.docId, h.entryId)}>
                  <b>{h.who || "?"}</b> <span className="muted small ellipsis">{h.title}</span>
                  <span className="hit-text">{h.text.slice(0, 120)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="small muted">문서 {docs.length}개</p>
          <ul className="plain-list doc-rows">
            {rows.map((r) => (
              <li key={r.d.id}>
                <button type="button" aria-current={r.d.id === currentId} onClick={() => onOpen(r.d.id)} title={r.d.title}>
                  <span className="ellipsis">{r.d.title}</span>
                  <span className="small muted">
                    {r.time ? `${r.time} · ` : ""}댓글 {r.comments}
                    {r.openIssues ? ` · 확인 ${r.openIssues}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
