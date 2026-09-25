// AFTERLOG 데이터 모델. 명세 8장 기준.
// 원문(SourceImport) · 사용자가 편집한 문서(Document) · 출력 설정(ViewSettings)을 분리한다.

export const SCHEMA_VERSION = 1;

export type Platform = "band";
export type InputFormat = "band-post" | "band-member-comments";
/** 원문이 어떤 형태로 들어왔는지 */
export type SourceKind = "band-saved-page" | "band-html-fragment" | "band-plain-text" | "band-collector-capture";

/** 원문 표기를 그대로 두고, 해석이 확실할 때만 local 값을 채운다. */
export interface TimeValue {
  /** 화면/원문에 적혀 있던 그대로 */
  raw: string;
  /** 해석된 현지 시각 "YYYY-MM-DDTHH:mm" 또는 해석 불가 시 null. 연도·기준 시각이 없으면 만들지 않는다. */
  local: string | null;
  /** 해석 근거 (예: "title 속성의 전체 시각") */
  basis?: string;
  /** 화면에 보이던 표기가 raw와 다를 때 (예: raw는 title의 전체 시각, display는 "2026년 2월 11일") */
  display?: string;
}

/**
 * 반응(표정·하트) 스냅샷. 명세 21.3.
 * 확인된 0 / 값 있음 / 미확보 / 해당 없음을 구분한다. 버튼만 있거나 빈 영역이면 '미확보'.
 */
export type ReactionStatus = "confirmed-zero" | "value" | "unknown" | "not-applicable";
export interface ReactionSnapshot {
  status: ReactionStatus;
  /** 총수. 미확보면 null */
  total: number | null;
  /** 종류별 수 (원래 라벨/아이콘 보존) */
  kinds: { label: string; icon?: string; count: number | null }[];
  /** 반응한 인물: 명단을 확보한 경우에만 */
  reactors: "unknown" | string[];
  /** 판단 근거 */
  evidence: string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "mention"; name: string }
  | {
      type: "image";
      /** 확보된 이미지 자산. null이면 미확보 자리 */
      assetId: string | null;
      /** 원문에서의 참조(파일명). 표시용이 아니라 추적용 */
      sourceRef?: string;
      /** 원격 이미지 주소(링크만 확보). 자동으로 요청하지 않는다 */
      sourceUrl?: string;
      alt?: string;
    }
  | { type: "unclassified"; text: string; reason: string };

export type EntryKind = "post" | "comment" | "unclassified";

export interface Entry {
  id: string;
  kind: EntryKind;
  authorId: string | null;
  blocks: ContentBlock[];
  /** 가져올 때의 본문. '원본 복원'에 사용 */
  originalBlocks: ContentBlock[];
  /** 댓글 모음의 원글 발췌. 원글 전체가 아니다 */
  excerpt?: ContentBlock[];
  time: TimeValue | null;
  /** 원문 등장 순서 */
  sourceOrder: number;
  /** 원문 위치(HTML: 요소 경로) */
  sourcePath?: string;
  /** 플랫폼 부가 정보. 없으면 '알 수 없음'이며 0으로 만들지 않는다 */
  meta: {
    readCount?: number;
    commentCount?: number;
  };
  reactions?: ReactionSnapshot;
  /** 부모 미확정: 텍스트 복사본처럼 답글 구조가 없는 원문 */
  parentUnknown?: boolean;
  /** 부모 연결 제안(사용자가 확정해야 함) */
  suggestedParentId?: string;
}

export interface Identity {
  id: string;
  originalName: string;
  displayName: string;
  description: string;
  originalDescription: string;
  avatarAssetId: string | null;
  /** 원문의 프로필 이미지 참조(파일명) */
  avatarSourceRef?: string;
  /** 원격 프로필 이미지 주소(링크만 확보) */
  avatarSourceUrl?: string;
  color: string | null;
  hidden: boolean;
}

export interface Asset {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  blob: Blob;
}

export type IssueKind =
  | "missing-image"
  | "comment-count-mismatch"
  | "unclassified"
  | "unknown-parent"
  | "unverified-structure"
  | "author-missing";

export interface ReviewIssue {
  id: string;
  kind: IssueKind;
  message: string;
  entryId?: string;
  resolved: boolean;
}

export type ThemeName = "light" | "dark";

export interface ViewSettings {
  theme: ThemeName;
  fontFamily: "system" | "serif" | "mono";
  sizes: { base: number; name: number; desc: number; body: number; comment: number };
  linkedSizes: boolean;
  show: { date: boolean; readCount: boolean; reactions: boolean; description: boolean; excerpt: boolean };
  /** 확보되지 않은 이미지: 자리 표시(기본) 또는 빼기 */
  missingImages: "placeholder" | "omit";
  width: number;
}

/**
 * 트리 구조: children["root"]는 최상위 항목(게시글 또는 댓글 모음 항목),
 * children[postId]는 댓글, children[commentId]는 답글.
 */
export interface DocumentData {
  id: string;
  projectId: string;
  platform: Platform;
  inputFormat: InputFormat;
  sourceKind?: SourceKind;
  title: string;
  sourceId: string;
  identities: Record<string, Identity>;
  identityOrder: string[];
  entries: Record<string, Entry>;
  children: Record<string, string[]>;
  issues: ReviewIssue[];
  view: ViewSettings;
  parserVersion: string;
  createdAt: string;
  updatedAt: string;
  /** 저장할 때마다 1씩 증가. 다른 탭의 오래된 덮어쓰기 방지 */
  revision: number;
}

export interface SourceImport {
  id: string;
  projectId: string;
  fileName: string;
  mime: string;
  importedAt: string;
  parserVersion: string;
  sha256: string;
  blob: Blob;
  kind?: SourceKind;
  /** 사용자가 함께 준 원래 주소(주소.txt 등) */
  sourceUrl?: string;
}

export interface Project {
  id: string;
  title: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  documentIds: string[];
  deletedAt?: string | null;
  /** 수집 확장이 만든 파일을 불러올 때 함께 온 보고서(capture/report.json) */
  captureReports?: unknown[];
}

export const ROOT = "root";

export function defaultViewSettings(): ViewSettings {
  return {
    theme: "light",
    fontFamily: "system",
    sizes: { base: 14, name: 15, desc: 12, body: 15, comment: 14 },
    linkedSizes: true,
    show: { date: true, readCount: true, reactions: true, description: true, excerpt: true },
    missingImages: "placeholder",
    width: 640,
  };
}
