// 개발용 진단 스키마 (수집 명세 v1.1 20.4). 허용 목록 방식:
// 여기에 선언된 키·열거값·구간만 파일에 들어갈 수 있다. 원문·이름·주소·ID·자유 문자열은 들어갈 자리가 없다.

// 2: 개수 구간에 unknown 추가(C05), scopeMissing 오류 코드 추가(C04)
// 3: 접힌 댓글 펼치기 단계(expand)와 remaining·candidates 구간 추가
export const DIAG_SCHEMA_VERSION = 4;
export const ADAPTER_VERSION = "band-web-1";
export const PROBE_SUITE_VERSION = "band-post-1";

export const PAGE_KINDS = ["postDetail", "postList", "memberList", "profile", "chat", "login", "unknown"] as const;
export const STAGES = [
  "pageLoad",
  "scope",
  "probes",
  "fields",
  "relations",
  "countCheck",
  "reactions",
  "asset",
  "storage",
  "listRound",
  "listEnd",
  "resume",
  "version",
  "export",
  "userCheck",
  "expand",
  "profile",
] as const;
export const STATES = ["ok", "fail", "unknown", "unsupported", "skipped", "partial"] as const;
export const ERROR_CODES = [
  "selectorMissing",
  "multipleScopes",
  "loadTimeout",
  "noProgress",
  "parentLinkUnknown",
  "assetDenied",
  "assetNotImage",
  "assetNetwork",
  "countMismatch",
  "storageFailed",
  "loginRequired",
  "accountChanged",
  "navigationFailed",
  "parseFailed",
  "versionChanged",
  "leaseRecovered",
  "outOfRange",
  "scopeMissing",
  "frameGone",
  "filteredOut",
  "expand_done",
  "expand_noButton",
  "expand_timeout",
  "expand_noProgress",
  "expand_cardLost",
  "keptEarlier",
  "other",
] as const;
export const FIELD_KEYS = [
  "author",
  "authorDesc",
  "avatar",
  "body",
  "time",
  "timeDetail",
  "readCount",
  "commentCount",
  "commentItem",
  "commentAuthor",
  "commentBody",
  "commentTime",
  "replyList",
  "mention",
  "emotionRegion",
  "attachment",
] as const;
export const FIELD_STATES = ["present", "missing", "ambiguous"] as const;
/** 페이지에서 확인하는 알려진 위치. 선택자 문자열 대신 이 ID만 파일에 남는다 */
export const PROBE_IDS = [
  "postCard",
  "writer",
  "writerName",
  "writerDesc",
  "postTime",
  "readCount",
  "body",
  "commentCount",
  "emotionRegion",
  "commentList",
  "commentItem",
  "commentName",
  "commentBody",
  "commentTime",
  "replyList",
  "mention",
  "loading",
  "attachmentImage",
] as const;
/** unknown = 확인하지 못함(실제 0과 다르다) */
export const COUNT_BUCKETS = ["unknown", "0", "1", "2to5", "6to20", "21to100", "gt100"] as const;
export const DURATION_BUCKETS = ["lt1s", "1to3s", "3to10s", "gt10s"] as const;
export const SIZE_BUCKETS = ["lt100KB", "100KBto1MB", "1to10MB", "gt10MB"] as const;
export const MEDIA_KINDS = ["image", "gif", "video", "file", "unknown"] as const;
export const END_EVIDENCE = ["explicitEnd", "noProgress", "maxRounds", "error", "notChecked"] as const;
export const SCOPES = ["current-post", "post-urls", "list", "selection", "profile"] as const;
export const BROWSERS = ["chrome", "edge", "other"] as const;
export const UI_LANGS = ["ko", "en", "ja", "other"] as const;
export const SCREEN_BUCKETS = ["lt1024", "1024to1440", "gt1440"] as const;

export const STRUCT_TAGS = [
  "div",
  "span",
  "p",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "button",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "time",
  "strong",
  "em",
  "br",
  "h",
  "label",
  "field",
  "video",
  "audio",
  "figure",
  "blockquote",
  "table",
  "form",
  "svg",
  "iframe",
  "custom",
  "other",
] as const;
export const STRUCT_ROLES = [
  "button",
  "link",
  "list",
  "listitem",
  "dialog",
  "article",
  "img",
  "textbox",
  "menu",
  "menuitem",
  "tab",
  "tablist",
  "region",
  "navigation",
  "main",
  "heading",
  "checkbox",
  "status",
  "feed",
  "none",
] as const;
export const STRUCT_MEDIA = ["img", "link", "video", "audio", "field"] as const;

export type CountBucket = (typeof COUNT_BUCKETS)[number];
export type DurationBucket = (typeof DURATION_BUCKETS)[number];
export type SizeBucket = (typeof SIZE_BUCKETS)[number];
export type Stage = (typeof STAGES)[number];
export type DiagState = (typeof STATES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];
export type FieldKey = (typeof FIELD_KEYS)[number];
export type ProbeId = (typeof PROBE_IDS)[number];

export interface DiagEvent {
  /** 보고서 안에서만 쓰는 순번 */
  seq: number;
  /** 보고서 안에서만 쓰는 과제 번호(원본 ID에서 만들지 않음) */
  task: number;
  stage: Stage;
  state: DiagState;
  code?: ErrorCode;
  page?: (typeof PAGE_KINDS)[number];
  fields?: Partial<Record<FieldKey, (typeof FIELD_STATES)[number]>>;
  probes?: Partial<Record<ProbeId, CountBucket>>;
  wait?: DurationBucket;
  count?: CountBucket;
  size?: SizeBucket;
  media?: (typeof MEDIA_KINDS)[number];
  progress?: boolean;
  /** 목록 회차에서 로딩 표시가 보였는지 */
  waiting?: boolean;
  end?: (typeof END_EVIDENCE)[number];
  attempt?: number;
  /** 펼치기 뒤에도 표시 수보다 모자란 댓글 수(구간) */
  remaining?: CountBucket;
  /** 처음 찾은 펼치기 버튼 수(구간) */
  candidates?: CountBucket;
}

export interface StructNode {
  n: number;
  tag: (typeof STRUCT_TAGS)[number];
  role?: (typeof STRUCT_ROLES)[number];
  probes?: ProbeId[];
  text?: boolean;
  media?: (typeof STRUCT_MEDIA)[number];
  /** 같은 모양의 형제가 반복된 횟수(구간) */
  repeat?: CountBucket;
  truncated?: boolean;
  c?: StructNode[];
}

export interface DiagnosticFile {
  diagnosticSchemaVersion: number;
  extensionVersion: string;
  adapterVersion: string;
  parserVersion: string;
  probeSuiteVersion: string;
  environment: { browser: (typeof BROWSERS)[number]; browserMajor: number; uiLang: (typeof UI_LANGS)[number]; screen: (typeof SCREEN_BUCKETS)[number] };
  job: {
    scope: (typeof SCOPES)[number];
    tasks: CountBucket;
    succeeded: CountBucket;
    partial: CountBucket;
    failed: CountBucket;
    skipped: CountBucket;
    userVerified: CountBucket;
  };
  events: DiagEvent[];
  structure: StructNode | null;
}

// ---------- 구간 변환 ----------

export function countBucket(n: number | null | undefined): CountBucket {
  // 확인하지 못한 값을 0개로 보이게 하지 않는다(C05)
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "unknown";
  if (n === 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2to5";
  if (n <= 20) return "6to20";
  if (n <= 100) return "21to100";
  return "gt100";
}
export function durationBucket(ms: number): DurationBucket {
  if (ms < 1000) return "lt1s";
  if (ms <= 3000) return "1to3s";
  if (ms <= 10000) return "3to10s";
  return "gt10s";
}
export function sizeBucket(bytes: number): SizeBucket {
  if (bytes < 100 * 1024) return "lt100KB";
  if (bytes < 1024 * 1024) return "100KBto1MB";
  if (bytes < 10 * 1024 * 1024) return "1to10MB";
  return "gt10MB";
}
