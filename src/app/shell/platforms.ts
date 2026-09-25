// 플랫폼 모듈 레지스트리(명세 v1.2 3·23.1절). 밴드는 새 편집기, 카톡·카페·트위터·DM은 RPBA 기존 도구 연결, 짓시는 원문 보관.
export type PlatformId = "band" | "kakao" | "twitter" | "dm" | "cafe" | "zitsi";

/**
 * native: 공통 데이터·자동 저장·프로젝트 복구를 검증한 새 편집기
 * legacy: 원래 도구를 연결(상태를 프로젝트에 보관)
 * archive: 아직 전문 해석은 없고 넣은 원문을 잃지 않게 보관
 * planned: 실제 입력 처리 없음
 */
export type ModuleStatus = "native" | "legacy" | "archive" | "planned";

export interface PlatformModule {
  id: PlatformId;
  label: string;
  /** 좁은 화면·도움말용 긴 이름 */
  longLabel: string;
  status: ModuleStatus;
  /** 기존 도구 연결일 때 페이지 주소(앱과 같은 출처) */
  legacyEntry?: string;
  /** 지원 범위 한 줄 설명(사용자용, 구현 용어 없이) */
  support: string;
}

export const STATUS_LABEL: Record<ModuleStatus, string> = { native: "새 편집기", legacy: "기존 편집기", archive: "원문 보관", planned: "준비 중" };

export const PLATFORMS: PlatformModule[] = [
  { id: "band", label: "밴드", longLabel: "네이버 밴드", status: "native", support: "저장 페이지·HTML·텍스트·수집 확장 파일을 가져와 글·댓글·답글을 원래 모양으로 보고 꾸밉니다." },
  {
    id: "kakao",
    label: "카카오톡",
    longLabel: "카카오톡",
    status: "legacy",
    legacyEntry: "legacy/kakao.html",
    support: "대화 내보내기 텍스트를 붙여넣어 말풍선으로 보고, 인물·배경을 바꾸고, HTML·PNG로 저장합니다(기존 RPBA 도구).",
  },
  {
    id: "twitter",
    label: "트위터",
    longLabel: "트위터 타임라인·타래",
    status: "legacy",
    legacyEntry: "legacy/twitter.html?mode=twitter",
    support: "타임라인·멘션 타래 텍스트를 트윗 모양으로 보고 HTML·PNG로 저장합니다(기존 RPBA 도구).",
  },
  {
    id: "dm",
    label: "DM",
    longLabel: "트위터 DM",
    status: "legacy",
    legacyEntry: "legacy/twitter.html?mode=dm",
    support: "트위터 DM 텍스트만 지원합니다. 다른 서비스의 DM은 아직 지원하지 않습니다(기존 RPBA 도구).",
  },
  {
    id: "cafe",
    label: "카페",
    longLabel: "네이버 카페",
    status: "legacy",
    legacyEntry: "legacy/cafe.html",
    support: "카페 글·댓글·답글 텍스트를 기본·채팅·카페 스킨으로 보고 HTML·PNG로 저장합니다(기존 RPBA 도구).",
  },
  {
    id: "zitsi",
    label: "짓시",
    longLabel: "짓시 채팅",
    status: "archive",
    support: "RPBA에 짓시 도구가 없어 복원하지 않았습니다. 넣은 텍스트·파일을 그대로 보관하고 평문으로 보여 줍니다.",
  },
];

export function platformOf(id: string | null | undefined): PlatformModule {
  return PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];
}
