import { BAND_ORIGINS } from "./config";

export type BandUrl =
  | { kind: "post"; origin: string; bandNo: string; postNo: string; canonical: string }
  | { kind: "feed"; origin: string; bandNo: string; canonical: string }
  | { kind: "member-list"; origin: string; bandNo: string; memberKey: string; list: "post" | "comment"; canonical: string }
  | { kind: "band-other"; origin: string; bandNo: string; canonical: string };

/** 밴드 주소 해석. 허용된 밴드 주소가 아니면 null */
export function parseBandUrl(raw: string, origins = BAND_ORIGINS): BandUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const origin = u.origin;
  if (!origins.includes(origin)) return null;
  const canonicalOrigin = origin.replace("://www.", "://");
  let m = u.pathname.match(/^\/band\/(\d+)\/post\/(\d+)\/?$/);
  if (m) return { kind: "post", origin, bandNo: m[1], postNo: m[2], canonical: `${canonicalOrigin}/band/${m[1]}/post/${m[2]}` };
  m = u.pathname.match(/^\/band\/(\d+)\/member\/([^/]+)\/(post|comment)\/?$/);
  if (m) return { kind: "member-list", origin, bandNo: m[1], memberKey: m[2], list: m[3] as "post" | "comment", canonical: `${canonicalOrigin}${u.pathname}` };
  m = u.pathname.match(/^\/band\/(\d+)(\/post)?\/?$/);
  if (m) return { kind: "feed", origin, bandNo: m[1], canonical: `${canonicalOrigin}/band/${m[1]}/post` };
  m = u.pathname.match(/^\/band\/(\d+)(\/.*)?$/);
  if (m) return { kind: "band-other", origin, bandNo: m[1], canonical: `${canonicalOrigin}${u.pathname}` };
  return null;
}

/** 작업 키: 출처 + 밴드 + 종류 + 원본 ID (명세 8.1) */
export function postKey(bandNo: string, postNo: string) {
  return `band:${bandNo}:post:${postNo}`;
}

/** 여러 줄 입력에서 글 주소만 골라 중복 없이 */
export function parsePostUrlList(text: string, origins = BAND_ORIGINS): { posts: Extract<BandUrl, { kind: "post" }>[]; rejected: string[] } {
  const posts: Extract<BandUrl, { kind: "post" }>[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\s+/).map((x) => x.trim()).filter(Boolean)) {
    const p = parseBandUrl(line, origins);
    if (p?.kind === "post") {
      if (!seen.has(p.canonical)) {
        seen.add(p.canonical);
        posts.push(p);
      }
    } else rejected.push(line);
  }
  return { posts, rejected };
}

/** 인물(멤버) 주소: /band/숫자/member/식별자[/post|/comment|/photo…]. 선택 수집의 인물은 이 식별자로 구분한다(3.3) */
export function parseMemberUrl(raw: string, origins = BAND_ORIGINS): { origin: string; bandNo: string; memberKey: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!origins.includes(u.origin)) return null;
  const m = u.pathname.match(/^\/band\/(\d+)\/member\/([^/]+)(?:\/.*)?$/);
  if (!m) return null;
  return { origin: u.origin.replace("://www.", "://"), bandNo: m[1], memberKey: m[2] };
}

/**
 * 검색 결과 화면 주소. 검색어·조건이 담긴 주소를 바꾸지 않고 그대로 돌려준다(일반 주소 정리로 query를 잃지 않게, 4.2).
 * 실제 검색 주소 형식은 확인 전이라 밴드 안 주소면 받고, 흔한 검색어 매개변수가 있으면 검색어로 읽는다.
 */
export function parseSearchUrl(raw: string, origins = BAND_ORIGINS): { url: string; bandNo: string; keywords: string[] } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!origins.includes(u.origin)) return null;
  const m = u.pathname.match(/^\/band\/(\d+)(?:\/.*)?$/);
  if (!m) return null;
  const k = ["keyword", "query", "q", "searchKeyword"].map((p) => u.searchParams.get(p)).find((v) => v && v.trim());
  return { url: u.href, bandNo: m[1], keywords: k ? [k.trim()] : [] };
}
