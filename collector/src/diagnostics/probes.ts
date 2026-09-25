// 알려진 확인 위치(probe). 선택자는 확장 코드 안에만 있고, 진단 파일에는 probe ID만 남는다.
// 근거: 사용자가 제공한 밴드 저장 페이지(2026-09 기준) 구조. 실제 화면 변경 시 여기와 adapter를 함께 고친다.
import type { ProbeId } from "./schema";

export const POST_PROBES: [ProbeId, string][] = [
  ["postCard", ".cPostCard"],
  ["writer", ".postWriterInfoWrap"],
  ["writerName", ".postWriterInfoWrap .text"],
  ["writerDesc", ".postWriterInfoWrap .memo"],
  ["postTime", ".postListInfoWrap time"],
  ["readCount", ".postListInfoWrap .readCount"],
  ["body", ".postBody .txtBody"],
  ["commentCount", ".dPostCountView .comment .count"],
  ["emotionRegion", "._emotionCountViewRegion"],
  ["commentList", ".dPostCommentMainView .sCommentList"],
  ["commentItem", ".cComment"],
  ["commentName", ".cComment .writeInfo .name"],
  ["commentBody", ".cComment ._commentContent"],
  ["commentTime", ".cComment .func time"],
  ["replyList", ".sReplyList"],
  ["mention", ".gBandMember"],
  ["loading", ".uLoading"],
  ["attachmentImage", ".postBody img"],
];
