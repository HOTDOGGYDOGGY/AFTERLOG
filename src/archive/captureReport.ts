// 수집 확장이 .afterlog에 넣는 보고서(capture/report.json)의 형태. 웹 앱은 읽어서 보여주기만 한다.

/** 목록 끝 판정 (수집 명세 8.2) */
export type Coverage = "exhausted" | "partial" | "unknown" | "notRequested" | "unsupported";

export interface CaptureReport {
  collectorVersion: string;
  jobId: string;
  label: string;
  scope: string;
  bandNo: string | null;
  bandName: string | null;
  startedAt: string;
  finishedAt: string | null;
  exportedAt: string;
  /** 선택 범위 확인 완료 / 일부 미확보 / 끝 확인 불가 */
  outcome: "complete" | "partial" | "unknownEnd";
  options: Record<string, unknown>;
  lists: { url: string; coverage: Coverage; found: number; evidence: string }[];
  posts: {
    discovered: number;
    captured: number;
    failed: number;
    skipped: number;
    outOfRange: number;
    items: {
      url: string;
      status: string;
      title?: string;
      comments?: { shown: number | null; found: number };
      error?: string;
      capturedAt?: string;
      /** 선택 수집: 대상이 된 이유(authored 쓴 글 · commented 댓글 단 글 · search 검색 · list 목록 · url 주소) */
      reasons?: string[];
    }[];
  };
  /** 이 파일에 든 합계(수집 확장 0.2.1+): 글 수 · 확보한 댓글 수 · 밴드가 표시한 댓글 수 · 인물 댓글 모음 수 */
  totals?: {
    posts: number;
    comments: number;
    commentsShown: number;
    memberComments: number;
    /** 수집 확장 0.3+: 글 안 댓글 · 표시 수 모르는 글 · 표시보다 많이 저장한 글 · 모자란 글 · 모음에만 있는 댓글 · 프로필 수 */
    postComments?: number;
    commentsShownUnknown?: number;
    commentsOverShown?: number;
    commentsShort?: number;
    memberCommentsOnlyInList?: number;
    profiles?: number;
  };
  /** 수집 확장 0.3+: 보완이 필요한 부분 */
  followUp?: { commentPosts: number; failed: number; pending: number; linkFailed: number; assetsFailed: number; unknownEnd: number };
  /** 인물 프로필 보관본(수집 확장 0.2.4+). 본문은 원문 칸의 band-profile-snapshot HTML */
  profiles?: { name: string | null; url: string; stories: number; images: number; capturedAt: string }[];
  /** 선택 수집(수집 확장 0.2+): 선택 요약과 인물 댓글 관측 */
  selection?: {
    summary: string;
    modes: { authored: boolean; commentsOnly: boolean; commentedPosts: boolean };
    period: { from: string | null; to: string | null; basis: string };
    members: { bandNo: string; name: string | null }[];
    comments: {
      observed: number;
      inRange: number;
      dateUnknown: number;
      linked: number;
      linkFailed: number;
      /** 원글의 댓글과 대조해 같음을 확인 */
      verified: number;
      /** 목록 표시 그대로(전문 여부 미확인) */
      listTextOnly: number;
    };
  };
  assets: { stored: number; thumbnailOnly: number; failed: number; notRequested: number; failures: { url: string; reason: string }[] };
  unsupported: string[];
  notes: string[];
}

export function isCaptureReport(x: unknown): x is CaptureReport {
  return !!x && typeof x === "object" && "collectorVersion" in x && "posts" in x;
}

// ---- 합계 문구(수집 관리 화면·HTML 목차·앱 보고서 공통, 명세 8.1) ----
/** '보완 필요' 한 줄(없으면 빈 문자열) */
export function followUpText(f: NonNullable<CaptureReport["followUp"]>): string {
  return [
    f.commentPosts ? `댓글 모자란 글 ${f.commentPosts}개` : "",
    f.failed ? `실패 ${f.failed}건` : "",
    f.pending ? `남은 작업 ${f.pending}건` : "",
    f.linkFailed ? `원글 못 찾은 댓글 ${f.linkFailed}개` : "",
    f.assetsFailed ? `이미지 ${f.assetsFailed}개` : "",
    f.unknownEnd ? `끝 확인 못 한 탐색 ${f.unknownEnd}곳` : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

/** 합계 한 줄(관리 화면·HTML 목차 공통) */
export function totalsText(t: NonNullable<CaptureReport["totals"]>): string {
  const shown =
    t.commentsShown || t.commentsShownUnknown
      ? ` (밴드 표시 ${t.commentsShown.toLocaleString()}개${(t.commentsShownUnknown ?? 0) ? ` + 표시 수 모르는 글 ${t.commentsShownUnknown}개` : ""}${(t.commentsOverShown ?? 0) ? ` · 표시보다 많이 저장한 글 ${t.commentsOverShown}개: 관측 시각·집계 범위 차이 확인 필요` : ""})`
      : "";
  return [
    `글 ${t.posts.toLocaleString()}개 저장`,
    `댓글·답글 ${t.comments.toLocaleString()}개 저장${shown}`,
    t.memberComments ? `인물 댓글 모음 ${t.memberComments.toLocaleString()}개${(t.memberCommentsOnlyInList ?? 0) ? `(원글에서 확인 안 된 ${t.memberCommentsOnlyInList}개 포함)` : ""}` : "",
    (t.profiles ?? 0) ? `프로필 ${t.profiles}명` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
