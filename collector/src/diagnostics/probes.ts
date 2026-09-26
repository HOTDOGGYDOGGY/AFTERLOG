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

/** 인물 프로필 화면(프로필 페이지·스토리 상세·멤버 목록 위 팝업). 근거: 사용자가 제공한 저장 표본 */
export const PROFILE_PROBES: [ProbeId, string][] = [
  ["profileView", "[data-viewname='DProfileView']"],
  ["profileName", ".profileInfoBox .userName, .cProfileViewCard .userName"],
  ["profileAvatar", ".profileBox img, img._profileImage"],
  ["profileCover", ".cardBox .backImage"],
  ["profileReaction", ".reactionBox ._countBtn, ._emotionCount"],
  ["storyList", "[data-viewname='DProfileStoryListView']"],
  ["storyItem", "[data-viewname='DProfileStoryListItemView']"],
  ["storyDetailLink", "a.storyDetailLink._storyDetail"],
  ["storyDetail", "[data-viewname='DProfileStoryDetailView']"],
  ["storyDetailText", "[data-viewname='DProfileStoryDetailCollectionView'] .txtBody"],
  ["storyCommentList", "[data-viewname='DBandProfileStoryCommentListView']"],
  ["commentItem", ".cComment"],
  ["profilePopup", "[data-viewname='DProfileLayerView']"],
  ["storyAnchor", "[data-viewname='DProfileStoryCountView'] a._storyAnchor"],
  ["postsLink", "a._btnGotoSearchMemberContent"],
];
