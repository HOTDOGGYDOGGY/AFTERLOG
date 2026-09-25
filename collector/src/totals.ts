// 수집 합계와 종합 결과(명세 8.1). 관리 화면·보고서·HTML 목차가 같은 함수를 쓴다(숫자 기준 일치).
// 관측값은 고치지 않는다: 밴드가 표시한 수는 확인된 것만 더하고, 모르는 글 수를 따로 센다. max()로 맞추지 않는다.
import type { Capture, CommentObservation, Selection, Task } from "./db";

export interface JobTotals {
  /** 저장한 글(내보내기 대상, 고유 글 주소) */
  posts: number;
  /** 저장한 댓글·답글 = 글 안의 댓글 + 원글에서 확인되지 않은 인물 댓글 모음 항목(중복 제외) */
  comments: number;
  /** 글 안에 저장한 댓글·답글 */
  postComments: number;
  /** 밴드가 표시한 댓글 수 합(표시 수를 확인한 글만) */
  commentsShown: number;
  /** 표시 댓글 수를 확인하지 못한 글 수 */
  commentsShownUnknown: number;
  /** 저장한 수가 표시 수보다 많은 글(관측 시각·집계 범위 차이 확인 필요) */
  commentsOverShown: number;
  /** 댓글이 표시 수보다 모자란 글 */
  commentsShort: number;
  /** 인물 댓글 모음(위 댓글의 부분집합 + 원글 연결 미확인 항목) */
  memberComments: number;
  /** 그중 저장한 원글에서 확인되지 않아 모음에만 있는 댓글 */
  memberCommentsOnlyInList: number;
  /** 보관 프로필(고유 밴드·인물) */
  profiles: number;
}

export function computeTotals(caps: Capture[], obs: CommentObservation[], sel: Selection | null | undefined, profileKeys: string[] = []): JobTotals {
  const kept = caps.filter((c) => !c.excluded);
  const postComments = kept.reduce((n, c) => n + (c.commentsFound || 0), 0);
  const known = kept.filter((c) => c.commentsShown !== null && c.commentsShown !== undefined);
  const member = sel?.commentsOnly ? obs.filter((o) => o.inRange !== false) : [];
  const onlyInList = member.filter((o) => o.content !== "verified").length;
  return {
    posts: kept.length,
    comments: postComments + onlyInList,
    postComments,
    commentsShown: known.reduce((n, c) => n + (c.commentsShown ?? 0), 0),
    commentsShownUnknown: kept.length - known.length,
    commentsOverShown: known.filter((c) => (c.commentsFound || 0) > (c.commentsShown ?? 0)).length,
    commentsShort: known.filter((c) => (c.commentsFound || 0) < (c.commentsShown ?? 0)).length,
    memberComments: member.length,
    memberCommentsOnlyInList: onlyInList,
    profiles: new Set(profileKeys).size,
  };
}

export type JobOutcome = "complete" | "partial" | "unknownEnd";

export interface FollowUp {
  /** 댓글이 모자란 글 */
  commentPosts: number;
  /** 실패한 과제(글·목록·댓글 목록·프로필) */
  failed: number;
  /** 아직 처리하지 않은 과제 */
  pending: number;
  /** 원글 연결에 실패한 인물 댓글 */
  linkFailed: number;
  /** 받지 못한 이미지 */
  assetsFailed: number;
  /** 끝을 확인하지 못한 탐색(목록·댓글 목록) */
  unknownEnd: number;
}

/**
 * 종합 결과: 이번 범위에 든 모든 하위 작업(목록·인물 댓글 목록·글·프로필·이미지)을 본다.
 * 실패·대기 중인 탐색이 있으면 '확인 완료'가 아니다. 작업 실행이 끝난 것과 자료를 다 확보한 것은 다르다.
 */
export function computeOutcome(tasks: Task[], obs: CommentObservation[], assetsFailed: number): { outcome: JobOutcome; followUp: FollowUp } {
  const discover = tasks.filter((t) => t.kind === "list" || t.kind === "comments");
  const followUp: FollowUp = {
    commentPosts: tasks.filter((t) => t.kind === "post" && t.status === "partial").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    pending: tasks.filter((t) => t.status === "pending" || t.status === "inFlight").length,
    linkFailed: obs.filter((o) => o.link === "failed").length,
    assetsFailed,
    unknownEnd: discover.filter((t) => t.result?.coverage === "unknown").length,
  };
  const partialDiscover = discover.some((t) => t.result?.coverage === "partial" || t.status === "partial");
  const partialProfile = tasks.some((t) => t.kind === "profile" && t.status === "partial");
  const outcome: JobOutcome =
    followUp.commentPosts || followUp.failed || followUp.pending || followUp.linkFailed || assetsFailed || partialDiscover || partialProfile ? "partial" : followUp.unknownEnd ? "unknownEnd" : "complete";
  return { outcome, followUp };
}

export { followUpText, totalsText } from "../../src/archive/captureReport";
