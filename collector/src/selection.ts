// 선택 수집(선택 수집 명세 v1.0) 도우미: 조건 요약, 댓글 관측과 저장된 원글의 대조.
import { blocksToPlainText, parseBandHtml } from "../../src/importers/band/html";
import type { Capture, CommentObservation, SearchSelection, SelectReason, Selection } from "./db";
import type { ParsedDocument } from "../../src/importers/band/html";

/** 기간 판단(작성 시각 기준, Asia/Seoul 날짜). 시각을 모르면 null */
export function periodContains(local: string | null, from: string | null, to: string | null): boolean | null {
  if (!from && !to) return true;
  if (!local) return null;
  const day = local.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** 비교용 정규화(NFC, 공백 제거). 원문은 바꾸지 않는다 */
export const normText = (s: string) => s.normalize("NFC").replace(/\s+/g, "");

/** 목록 글자가 말줄임으로 끝나면 앞부분만 비교한다 */
function sameText(list: string, full: string) {
  const a = normText(list);
  const b = normText(full);
  if (!a) return false;
  if (a === b) return true;
  const cut = a.replace(/(\.\.\.|…)+$/, "");
  return cut.length >= 8 && cut !== a && b.startsWith(cut);
}

/**
 * 댓글 목록에서 본 댓글이 이 원글 저장본 안에 같은 인물의 댓글로 있는가.
 * 인물은 목록 머리글의 이름으로 맞추고(같은 밴드·같은 원글 안), 글자와(둘 다 있으면) 작성 시각이 같아야 한다.
 */
export function commentInCapture(ob: Pick<CommentObservation, "text" | "local" | "memberName">, capture: Pick<Capture, "html">): boolean {
  const doc = parseBandHtml(capture.html).documents.find((d) => d.format === "band-post");
  if (!doc) return false;
  const nameOf = (key: string | null) => (key ? doc.identities.find((i) => i.key === key)?.name ?? null : null);
  return doc.entries.some((e) => {
    if (e.kind === "post") return false;
    if (ob.memberName && normText(nameOf(e.authorKey) ?? "") !== normText(ob.memberName)) return false;
    if (!sameText(ob.text, blocksToPlainText(e.blocks))) return false;
    const t = e.time?.local;
    if (ob.local && t && ob.local.length >= 16 && t.length >= 16 && ob.local.slice(0, 16) !== t.slice(0, 16)) return false;
    return true;
  });
}

/** 선택 내용을 한 문장으로(6절). 이름을 모르면 '선택한 인물' */
export function describeSelection(sel: Selection): string {
  const parts: string[] = [];
  const modes = [sel.authored ? "쓴 글" : "", sel.commentsOnly ? "쓴 댓글" : "", sel.commentedPosts ? "댓글 단 글" : ""].filter(Boolean);
  if (sel.members.length && modes.length) {
    const who = sel.members.map((m) => m.name).filter(Boolean).join("·") || (sel.members.length > 1 ? `인물 ${sel.members.length}명` : "선택한 인물");
    parts.push(`${who}의 ${modes.join("·")}`);
  }
  if (sel.search) {
    const k = sel.search.keywords;
    const n = sel.search.urls?.length ?? 1;
    const where = n > 1 ? `검색 결과 ${n}곳` : "검색 결과";
    parts.push(k.length ? `${where} 중 ${k.map((x) => `'${x}'`).join(sel.search.match === "all" ? "+" : "/")}${sel.search.fields === "bodyAndComments" ? "(본문·댓글)" : ""}` : where);
  }
  const period = sel.periodFrom || sel.periodTo ? ` · ${sel.periodFrom ?? "처음"}~${sel.periodTo ?? "지금"}` : "";
  return `${parts.join(sel.combine === "and" ? " 그리고 " : " · ") || "(선택 없음)"}${period}`;
}

// ---------- 검색어(4.1) ----------

/** 검색용 정규화: NFC, 영문 소문자, 연속 공백 하나로. 띄어쓰기·조사·유사어는 넓히지 않는다 */
export const normSearch = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/** 한 단위(본문 하나 또는 댓글 하나) 판단. 맞은 검색어를 돌려준다(없으면 null) */
export function unitMatches(text: string, s: Pick<SearchSelection, "keywords" | "match" | "exclude">): string[] | null {
  const t = normSearch(text);
  if (s.exclude.some((x) => x.trim() && t.includes(normSearch(x)))) return null;
  const hit = s.keywords.filter((k) => k.trim() && t.includes(normSearch(k)));
  if (s.match === "all" ? hit.length === s.keywords.filter((k) => k.trim()).length && hit.length > 0 : hit.length > 0) return hit;
  return null;
}

export interface SearchVerdict {
  /** true 일치 · false 불일치 · null 판단 불가(댓글을 다 불러오지 못했는데 본문도 맞지 않음) */
  match: boolean | null;
  matches: { where: "body" | "comment"; index: number; terms: string[]; local: string | null }[];
}

/** 게시글 판단. 인물 이름·소개 같은 표시 정보는 보지 않는다(F07). 댓글은 댓글 하나씩 따로 본다 */
export function searchPost(doc: ParsedDocument, s: SearchSelection, commentsComplete: boolean): SearchVerdict {
  if (!s.keywords.some((k) => k.trim())) return { match: true, matches: [] };
  const matches: SearchVerdict["matches"] = [];
  const post = doc.entries.find((e) => e.kind === "post");
  if (post) {
    const hit = unitMatches(blocksToPlainText(post.blocks), s);
    if (hit) matches.push({ where: "body", index: 0, terms: hit, local: post.time?.local ?? null });
  }
  if (s.fields === "bodyAndComments") {
    doc.entries
      .filter((e) => e.kind !== "post")
      .forEach((e, i) => {
        const hit = unitMatches(blocksToPlainText(e.blocks), s);
        if (hit) matches.push({ where: "comment", index: i, terms: hit, local: e.time?.local ?? null });
      });
    if (!matches.length && !commentsComplete) return { match: null, matches };
  }
  return { match: matches.length > 0, matches };
}

// ---------- 글 판정(조건 조합, 4.3·5절) ----------

export interface PostVerdict {
  include: boolean;
  /** 빠진 이유 */
  excluded?: "outOfRange" | "noMatch" | "unknown" | "notAll";
  /** 맞은 조건 */
  confirmed: SelectReason[];
  matches?: SearchVerdict["matches"];
}

/**
 * 글 하나가 선택 조건에 드는가. 조건별 판단: 쓴 글 = 글 작성일 기간 · 댓글 단 글 = (댓글 날짜로 이미 골랐으므로) 맞음 ·
 * 검색 = 검색어 일치 + 일치한 단위의 작성일 기간. 합집합은 하나라도 맞으면, 교집합은 켜진 글 조건 모두 맞아야.
 * 판단 불가(null)는 참으로 보지 않는다.
 */
export function judgePost(doc: ParsedDocument, reasons: SelectReason[], sel: Selection, commentsComplete: boolean): PostVerdict {
  const post = doc.entries.find((e) => e.kind === "post");
  const inPeriod = (local: string | null) => periodContains(local, sel.periodFrom, sel.periodTo);
  const state = new Map<SelectReason, boolean | null>();
  let matches: SearchVerdict["matches"] | undefined;
  let searchFail: "noMatch" | "unknown" | "outOfRange" | null = null;
  if (reasons.includes("authored")) state.set("authored", inPeriod(post?.time?.local ?? null));
  if (reasons.includes("commented")) state.set("commented", true);
  if (reasons.includes("search") && sel.search) {
    const v = searchPost(doc, sel.search, commentsComplete);
    matches = v.matches;
    if (v.match === null) {
      state.set("search", null);
      searchFail = "unknown";
    } else if (!v.match) {
      state.set("search", false);
      searchFail = "noMatch";
    } else {
      // 본문 검색은 글 작성일, 댓글 일치는 그 댓글 작성일(5절). 일치 위치 중 하나라도 기간 안이면 맞음
      const units = v.matches.length ? v.matches.map((m) => (m.where === "body" ? post?.time?.local ?? null : m.local)) : [post?.time?.local ?? null];
      const ps = units.map(inPeriod);
      const r = ps.some((x) => x === true) ? true : ps.some((x) => x === null) ? null : false;
      state.set("search", r);
      if (r === false) searchFail = "outOfRange";
      if (r === null) searchFail = "unknown";
    }
  }
  const confirmed = [...state].filter(([, v]) => v === true).map(([k]) => k);
  const need: SelectReason[] = [sel.authored ? "authored" : null, sel.commentedPosts ? "commented" : null, sel.search ? "search" : null].filter((x): x is SelectReason => !!x);
  if (sel.combine === "and") {
    if (need.every((r) => state.get(r) === true)) return { include: true, confirmed, matches };
    const missing = need.filter((r) => !state.has(r));
    return { include: false, excluded: missing.length ? "notAll" : [...state.values()].some((v) => v === null) ? "unknown" : searchFail === "noMatch" ? "noMatch" : "outOfRange", confirmed, matches };
  }
  if (confirmed.length) return { include: true, confirmed, matches };
  const anyNull = [...state.values()].some((v) => v === null);
  return { include: false, excluded: anyNull ? "unknown" : searchFail === "noMatch" ? "noMatch" : "outOfRange", confirmed, matches };
}
