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
    items: { url: string; status: string; title?: string; comments?: { shown: number | null; found: number }; error?: string; capturedAt?: string }[];
  };
  assets: { stored: number; thumbnailOnly: number; failed: number; notRequested: number; failures: { url: string; reason: string }[] };
  unsupported: string[];
  notes: string[];
}

export function isCaptureReport(x: unknown): x is CaptureReport {
  return !!x && typeof x === "object" && "collectorVersion" in x && "posts" in x;
}
