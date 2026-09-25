import * as C from "../../editor/commands";
import { ROOT, type DocumentData } from "../../domain/types";
import { findParent } from "../../domain/validate";
import { blocksToPlainText } from "../../importers/band/html";
import type { DocEditor } from "../useDocEditor";

function preview(doc: DocumentData, id: string) {
  const e = doc.entries[id];
  if (!e) return id;
  const who = e.authorId ? doc.identities[e.authorId]?.displayName : "?";
  const t = blocksToPlainText(e.blocks).replace(/\s+/g, " ").slice(0, 24);
  return `${e.kind === "post" ? "[게시글] " : ""}${who}: ${t}`;
}

/** 오른쪽 검사 패널: 선택한 항목의 작성자·부모·시각·원문·검토 항목 */
export function Inspector({ editor, entryId, onClose }: { editor: DocEditor; entryId: string; onClose(): void }) {
  const { doc } = editor;
  const e = doc.entries[entryId];
  if (!e) return null;
  const ro = !!editor.readOnly;
  const parent = findParent(doc, entryId);
  const isPost = e.kind === "post";
  // 부모 후보: 게시글과 댓글(자기 자신과 자손 제외)
  const descendants = new Set<string>();
  const stack = [entryId];
  while (stack.length) {
    const x = stack.pop()!;
    descendants.add(x);
    stack.push(...(doc.children[x] ?? []));
  }
  const parentOptions = Object.values(doc.entries)
    .filter((x) => !descendants.has(x.id) && (x.kind === "post" || x.kind === "comment" || x.kind === "unclassified"))
    .sort((a, b) => a.sourceOrder - b.sourceOrder);
  const issues = doc.issues.filter((i) => i.entryId === entryId);
  const original = blocksToPlainText(e.originalBlocks);
  const changed = original !== blocksToPlainText(e.blocks);

  return (
    <aside className="inspector" aria-label="선택한 항목">
      <div className="panel-head">
        <strong>{isPost ? "게시글" : e.kind === "unclassified" ? "미분류 항목" : parent && parent !== ROOT && doc.entries[parent]?.kind === "comment" ? "답글" : "댓글"}</strong>
        <button type="button" className="ui-icon-btn" aria-label="검사 패널 닫기" title="닫기" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="panel-body">
        <label className="field">
          <span>작성자</span>
          <select value={e.authorId ?? ""} disabled={ro} onChange={(ev) => editor.apply((d) => C.setAuthor(d, entryId, ev.target.value || null))}>
            <option value="">(미확정)</option>
            {doc.identityOrder.map((id) => (
              <option key={id} value={id}>
                {doc.identities[id]?.displayName}
                {doc.identities[id]?.description ? ` · ${doc.identities[id].description}` : ""}
              </option>
            ))}
          </select>
        </label>
        {e.authorId ? (
          <button type="button" className="ui-btn ui-btn-small" disabled={ro} onClick={() => editor.apply((d) => C.splitIdentity(d, [entryId]))}>
            이 항목만 다른 인물로 분리
          </button>
        ) : null}

        {e.parentUnknown ? (
          <div className="notice warn">
            부모 미확정: 원문에 답글 구조가 없습니다.
            {e.suggestedParentId && doc.entries[e.suggestedParentId] ? (
              <>
                <br />
                제안: <b>{preview(doc, e.suggestedParentId)}</b>의 답글
                <div className="row-actions">
                  <button type="button" className="ui-btn ui-btn-small" disabled={ro} onClick={() => editor.apply((d) => C.applyParentSuggestion(d, entryId))}>
                    제안대로 연결
                  </button>
                  <button type="button" className="ui-btn ui-btn-small" disabled={ro} onClick={() => editor.apply((d) => C.confirmParent(d, entryId))}>
                    지금 위치가 맞음
                  </button>
                </div>
              </>
            ) : (
              <div className="row-actions">
                <button type="button" className="ui-btn ui-btn-small" disabled={ro} onClick={() => editor.apply((d) => C.confirmParent(d, entryId))}>
                  지금 위치가 맞음
                </button>
              </div>
            )}
          </div>
        ) : null}
        {!isPost && doc.inputFormat === "band-post" ? (
          <label className="field">
            <span>부모 (이 항목이 달린 곳)</span>
            <select value={parent ?? ""} disabled={ro} onChange={(ev) => editor.apply((d) => C.setParent(d, entryId, ev.target.value))}>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {preview(doc, p.id)}
                </option>
              ))}
            </select>
            <small className="muted">멘션(@이름)은 표시일 뿐이고, 부모 관계는 여기서 정합니다.</small>
          </label>
        ) : null}

        <label className="field">
          <span>시각 (원문 표기)</span>
          <input
            key={`${entryId}:${e.time?.raw ?? ""}`}
            defaultValue={e.time?.raw ?? ""}
            disabled={ro}
            onBlur={(ev) => {
              if (ev.target.value !== (e.time?.raw ?? "")) editor.apply((d) => C.editTime(d, entryId, ev.target.value));
            }}
          />
          <small className="muted">
            {e.time?.display ? `화면 표기: ${e.time.display} · ` : ""}
            {e.time?.local ? `해석: ${e.time.local.replace("T", " ")}${e.time.basis ? ` (${e.time.basis})` : ""}` : "연도/기준 시각이 없어 날짜로 해석하지 않았습니다."}
          </small>
        </label>

        <div className="field">
          <span>표정·반응</span>
          <small className="muted">
            {!e.reactions
              ? "정보 없음"
              : e.reactions.status === "value"
                ? `${e.reactions.total}개 · 반응한 사람 ${e.reactions.reactors === "unknown" ? "미확보" : e.reactions.reactors.length + "명"}`
                : e.reactions.status === "confirmed-zero"
                  ? "0 (확인됨)"
                  : e.reactions.status === "not-applicable"
                    ? "해당 없음"
                    : "미확보"}
            {e.reactions ? ` — ${e.reactions.evidence}` : ""}
          </small>
        </div>

        {issues.length ? (
          <div className="field">
            <span>확인할 점</span>
            <ul className="issue-list">
              {issues.map((i) => (
                <li key={i.id} className={i.resolved ? "is-resolved" : undefined}>
                  <label>
                    <input type="checkbox" checked={i.resolved} disabled={ro} onChange={(ev) => editor.apply((d) => C.resolveIssue(d, i.id, ev.target.checked))} />
                    {i.message}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="field">
          <summary>원문 {changed ? "(수정됨)" : ""}</summary>
          <pre className="source-text">{original || "(비어 있음)"}</pre>
          {e.excerpt ? <pre className="source-text muted">원글 발췌: {blocksToPlainText(e.excerpt)}</pre> : null}
          {e.sourcePath ? <small className="muted mono">위치: {e.sourcePath}</small> : null}
        </details>
      </div>
    </aside>
  );
}
