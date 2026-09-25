// AFTERLOG 데이터 모델. 명세 8장 기준.
// 원문(SourceImport) · 사용자가 편집한 문서(Document) · 출력 설정(ViewSettings)을 분리한다.

import { defaultDocStyle } from "./style";

export const SCHEMA_VERSION = 1;

/** 문서의 출처 플랫폼. 표시 스킨과 별개다(밴드 글을 대화형으로 보여줘도 출처는 밴드) */
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
  /** 이 인물만의 표시 설정(원본 이미지·이름은 그대로) */
  style?: IdentityStyle;
}

/** 인장 표시용 자르기: 원본 이미지를 바꾸지 않는다. zoom 1 = 꽉 채움, x·y는 -50~50(%) 중심 이동 */
export interface AvatarCrop {
  zoom: number;
  x: number;
  y: number;
}

export interface IdentityStyle {
  avatarCrop?: AvatarCrop;
  /** 이 인물만 다른 인장 모양 */
  avatarShape?: AvatarShape;
  /** 말풍선형에서의 말풍선 색 */
  bubbleColor?: string;
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

/** 기록(출력) 테마. app = 편집기 화면 테마를 따름(내보낼 때 그 시점의 값으로 확정) */
export type DocumentTheme = "app" | "light" | "dark";
export type AvatarShape = "circle" | "square" | "rounded";
/** 댓글 표시 프리셋. band = 밴드 원형 */
export type CommentSkin = "band" | "linear" | "bubble" | "card" | "reading";
export type FontKey = "system" | "serif" | "mono" | "rounded";
export type TextRole = "name" | "desc" | "body" | "comment" | "meta";

export interface RoleTypography {
  /** 없으면 전체 글꼴을 따름 */
  font?: FontKey;
  size: number;
  weight?: number;
  /** 줄간격(배수) */
  lineHeight?: number;
  /** 자간(px) */
  letterSpacing?: number;
}

/**
 * 꾸미기 설정(스타일 버전 1). 원형(skin=band, 기본값)과 사용자가 바꾼 값을 같은 모델로 저장하고
 * '원형으로 되돌리기'는 이 값만 기본값으로 돌린다(글·댓글·인물·첨부는 건드리지 않음).
 */
export interface DocStyle {
  version: 1;
  documentTheme: DocumentTheme;
  commentSkin: CommentSkin;
  avatar: {
    shape: AvatarShape;
    /** 둥근 사각형의 반경(px, 인장 크기 기준 비율이 아니라 고정값) */
    radius: number;
    sizes: { post: number; comment: number; reply: number; profile: number };
    borderWidth: number;
    borderColor: string | null;
    shadow: "none" | "soft";
    fit: "cover" | "contain";
    /** every: 매번 / group: 연속 작성 묶음의 첫 항목만 / hidden: 숨김(이름은 남음) */
    repeat: "every" | "group" | "hidden";
    /** 인장이 없을 때 */
    fallback: "initial" | "neutral" | "none";
  };
  /** 역할별 글자(크기는 px). linked면 크기를 함께 조절 */
  typography: Record<TextRole, RoleTypography>;
  colors: {
    /** 기록 바탕(글 바깥) */
    background: string | null;
    /** 글 표면 */
    surface: string | null;
    /** 댓글 영역 표면 */
    commentSurface: string | null;
    text: string | null;
    mention: string | null;
  };
  comments: {
    replyIndent: number;
    dividers: boolean;
    bubbleTail: "none" | "small" | "default";
    bubbleRadius: number;
  };
}

export interface ViewSettings {
  /** 예전 기록 테마 값. style.documentTheme이 우선이며, 없을 때만 쓴다 */
  theme: ThemeName;
  fontFamily: "system" | "serif" | "mono";
  sizes: { base: number; name: number; desc: number; body: number; comment: number };
  linkedSizes: boolean;
  show: { date: boolean; readCount: boolean; reactions: boolean; description: boolean; excerpt: boolean };
  /** 확보되지 않은 이미지: 자리 표시(기본) 또는 빼기 */
  missingImages: "placeholder" | "omit";
  width: number;
  /** 사용자 스킨(꾸미기 설정). 없는 예전 문서는 불러올 때 기존 값에서 채운다 */
  style?: DocStyle;
  /**
   * original = 플랫폼 원형(기본값으로 표시, 사용자 스킨은 그대로 보관) / custom = 사용자 스킨으로 표시.
   * 원형으로 돌아가도 style을 지우지 않아 언제든 다시 쓸 수 있다(명세 v1.2 27.4 skinFamily).
   */
  skinFamily?: "original" | "custom";
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
  /** 새 문서에 복사할 프로젝트 기본 표시 설정 */
  defaultView?: ViewSettings;
}

export const ROOT = "root";

export function defaultViewSettings(): ViewSettings {
  const style = defaultDocStyle();
  return {
    theme: "light",
    fontFamily: "system",
    sizes: { base: 14, name: 15, desc: 12, body: 15, comment: 14 },
    linkedSizes: true,
    show: { date: true, readCount: true, reactions: true, description: true, excerpt: true },
    missingImages: "placeholder",
    // 실제 밴드 글 상세창 폭
    width: 600,
    style,
    skinFamily: "original",
  };
}
