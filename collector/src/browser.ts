// 수집 엔진이 브라우저를 다루는 경계. 실제 구현(chrome API)과 테스트용 가짜를 바꿔 끼운다.
import type { PostExtraction } from "./page/extractPost";
import type { DiscoverRound } from "./page/discoverLinks";
import type { MemberCommentsRound, OpenCommentPostResult } from "./page/memberComments";
import type { ProfilePopupExtraction } from "./page/profilePopup";
import type { ProfileExtraction } from "./page/profile";

/** 수집 탭의 역할: 목록·댓글 목록 탐색 / 글 열기 */
export type TabRole = "discover" | "body";

export class BrowserError extends Error {
  constructor(
    public code: "navigationFailed" | "loadTimeout" | "loginRequired" | "tabClosed" | "frameGone" | "other",
    message: string,
  ) {
    super(message);
  }
}

export interface FetchedAsset {
  ok: boolean;
  blob?: Blob;
  mime?: string;
  code?: "assetDenied" | "assetNotImage" | "assetNetwork";
  httpStatus?: number;
}

export interface CollectorBrowser {
  /** url로 이동해 읽거나(수집 전용 창), tabId의 현재 화면을 이동 없이 읽는다 */
  extractPost(target: { url?: string; tabId?: number }): Promise<{ ex: PostExtraction; loadMs: number }>;
  /** 목록 화면을 열고 회차마다 onRound를 부른다. false를 돌려주면 멈춘다 */
  openList(url: string): Promise<void>;
  discoverRound(bandNo: string): Promise<DiscoverRound>;
  /** 멤버 댓글 목록(탐색 탭): from 이후 항목 읽기, scroll이면 먼저 끝까지 내려 더 불러온다 */
  readMemberComments?(opts: { from: number; scroll: boolean }): Promise<MemberCommentsRound>;
  /** 멤버 댓글 목록 항목을 눌러 원글 번호를 읽고 닫는다(탐색 탭) */
  openCommentPost?(opts: { seq: number; expectText: string; expectDate: string; bandNo: string }): Promise<OpenCommentPostResult>;
  /** 인물 프로필 화면을 열어 끝까지 스크롤한 뒤 보관본을 만든다(글 탭, 아무것도 누르지 않음) */
  captureProfile?(url: string): Promise<{ ex: ProfileExtraction; loadMs: number }>;
  /** 사용자 탭에 열린 프로필 팝업(주소 변화 없음)을 읽는다. 누르지 않는다 */
  captureProfilePopup?(tabId: number): Promise<ProfilePopupExtraction>;
  /** 실패한 화면의 구조 표본(진단용) */
  sampleStructure(target: { url?: string; tabId?: number }): Promise<unknown>;
  fetchAsset(url: string): Promise<FetchedAsset>;
  dispose(): Promise<void>;
}

const MAGIC: [string, number[]][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["image/webp", [0x52, 0x49, 0x46, 0x46]],
];

/** 실제 이미지 바이트인지 확인(로그인 HTML을 이미지로 저장하는 사고 방지, T14) */
export function sniffImage(bytes: Uint8Array): string | null {
  for (const [mime, sig] of MAGIC) if (sig.every((b, i) => bytes[i] === b)) return mime;
  return null;
}

/** ?type=s75 같은 축소 이미지 표시 */
export function imageQuality(url: string): "original" | "thumbnail" | "unknown" {
  try {
    const t = new URL(url).searchParams.get("type");
    if (t && /^[swfh]\d+/i.test(t)) return "thumbnail";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function fetchImage(url: string): Promise<FetchedAsset> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "omit", cache: "no-store", redirect: "follow" });
  } catch {
    return { ok: false, code: "assetNetwork" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, code: "assetDenied", httpStatus: res.status };
  if (!res.ok) return { ok: false, code: "assetNetwork", httpStatus: res.status };
  const buf = new Uint8Array(await res.arrayBuffer());
  const sniffed = sniffImage(buf);
  if (!sniffed) return { ok: false, code: "assetNotImage", httpStatus: res.status };
  return { ok: true, blob: new Blob([buf as BlobPart], { type: sniffed }), mime: sniffed };
}
