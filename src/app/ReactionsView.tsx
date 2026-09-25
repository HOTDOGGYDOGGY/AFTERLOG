// 대상별 표정·반응 기록(예시 화면 '표정·하트'). 확인된 값만 숫자로, 나머지는 '미확보'로 센다.
import type { DocumentData, Entry, ReactionSnapshot } from "../domain/types";
import { blocksToPlainText } from "../importers/band/html";

const TARGET_LABEL = (e: Entry, d: DocumentData) => (e.kind === "post" ? "게시글" : Object.entries(d.children).some(([p, l]) => p !== "root" && d.entries[p]?.kind === "comment" && l.includes(e.id)) ? "답글" : "댓글");

export function ReactionsView({ docs, onJump }: { docs: DocumentData[]; onJump(docId: string, entryId: string): void }) {
  const known: { d: DocumentData; e: Entry; r: ReactionSnapshot }[] = [];
  let unknown = 0;
  let none = 0;
  for (const d of docs)
    for (const e of Object.values(d.entries)) {
      if (!e.reactions) none++;
      else if (e.reactions.status === "value" || e.reactions.status === "confirmed-zero") known.push({ d, e, r: e.reactions });
      else unknown++;
    }
  return (
    <div className="side-layout">
      <section className="side-main">
        {known.length ? (
          <ul className="reaction-list">
            {known.map(({ d, e, r }) => (
              <li key={`${d.id}:${e.id}`}>
                <div className="reaction-head">
                  <span>
                    {TARGET_LABEL(e, d)} · {e.authorId ? d.identities[e.authorId]?.displayName : "?"}
                  </span>
                  <button type="button" className="ui-link small" onClick={() => onJump(d.id, e.id)}>
                    해당 기록 →
                  </button>
                </div>
                <p className="small muted ellipsis">{blocksToPlainText(e.blocks).slice(0, 80)}</p>
                <div className="chips">
                  {r.kinds.length ? (
                    r.kinds.map((k, i) => (
                      <span key={i} className="chip">
                        {k.label} {k.count ?? ""}
                      </span>
                    ))
                  ) : (
                    <span className="chip">표정 {r.total ?? "?"}</span>
                  )}
                </div>
                <p className="small muted">
                  총 {r.total ?? "?"}개 · 반응자 {r.reactors === "unknown" ? "미확보" : `${r.reactors.length}명 확보`}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-note">
            <p>
              <b>확인된 표정·하트 기록이 없습니다.</b>
            </p>
            <p className="small muted">
              지금까지 가져온 자료에는 화면에 표정 수가 보이는 경우가 없었습니다. '표정짓기' 버튼만 있는 경우는 0이 아니라 <b>미확보</b>로 둡니다.
              표정 종류별 수와 누가 눌렀는지는, 실제로 표정이 달린 글의 화면 샘플을 받은 뒤 수집기에 추가할 예정입니다.
            </p>
          </div>
        )}
      </section>
      <aside className="side-note">
        <h3>반응의 저장 상태</h3>
        <dl>
          <dt>확인된 값</dt>
          <dd>{known.length}개 대상</dd>
          <dt>미확보</dt>
          <dd>{unknown}개 대상 (화면에 수가 없었음)</dd>
          <dt>정보 없음</dt>
          <dd>{none}개 대상 (예전 방식으로 가져온 자료)</dd>
        </dl>
        <p className="small muted">같은 글을 여러 번 가져와도 반응 수를 더하지 않습니다.</p>
      </aside>
    </div>
  );
}

export function ChatView() {
  return (
    <div className="side-layout">
      <section className="side-main">
        <div className="empty-note">
          <p>
            <b>보관된 밴드 채팅이 없습니다.</b>
          </p>
          <p className="small muted">
            밴드 채팅 저장은 아직 지원하지 않습니다. 채팅방 화면의 구조(날짜 구분·첨부·답장·표정·과거 대화 불러오기)를 실제 샘플로 확인한 뒤 수집 확장에 추가합니다. 게시글 댓글 해석기를 채팅에 억지로 쓰지 않습니다.
          </p>
          <p className="small muted">필요한 샘플: 채팅방을 연 상태에서 '다른 이름으로 저장'한 페이지(개인 대화는 가상의 내용으로 바꿔도 됩니다), 또는 밴드의 채팅 내보내기 파일.</p>
        </div>
      </section>
    </div>
  );
}
