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
  totals?: { posts: number; comments: number; commentsShown: number; memberComments: number };
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
