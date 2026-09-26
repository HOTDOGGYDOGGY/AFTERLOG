// 밴드 인물 프로필 해석(프로필 명세 v1.0 · 팝업 명세 v1.0). 앱의 저장 HTML 가져오기와 수집 확장이 같은 해석기를 쓴다.
// 실제 저장 표본(사용자 제공, 저장소에는 넣지 않음)에서 확인한 구조:
//  - 프로필 페이지 /band/N/member/KEY/profile: [DProfileView] 카드(.backImage 배경 · .joinInfo · .reactionBox) · .profileBox img · .profileInfoBox .userName
//    스토리 목록 [DProfileStoryListView] > [DProfileStoryListItemView](time.time · [DProfileStoryTextView] .txtBody.-listType · 반응 .count · 댓글 ._commentCountSpan)
//  - 스토리 상세 레이어 [DProfileStoryDetailLayerView] > [DProfileStoryDetailView].cPostCard(작성자 em · time · [DProfileStoryDetailCollectionView] .txtBody ·
//    [DBandProfileStoryReactionMainView] 반응·댓글 수 · [DBandProfileStoryCommentListView] 댓글 목록). .cPostCard가 붙어 있지만 일반 게시글이 아니다.
//  - 멤버 목록 위 프로필 팝업 [DProfileLayoutView] > [DProfileLayerView](.joinInfo · img._profileImage · .userName · [DProfileDescriptionView] ._userDesc/._userInfo ·
//    ._emotionCount · ._commentCountRegion · [DProfileStoryCountView] em.count). 주소가 바뀌지 않고 링크가 모두 '#'라 인물 식별자가 없다.
// 확인하지 못한 것: 프로필 사진 이력 화면, 스토리 댓글 항목 구조(표본의 댓글 0개), 반응자 목록. 없는 구조를 있는 것처럼 읽지 않는다.
import type { ContentBlock } from "../../domain/types";
import { blocksToPlainText, extractBlocks, imageRefFromSrc } from "./html";
import { parseKoreanDateTime } from "./time";

export const BAND_PROFILE_SCHEMA = "afterlog.band-profile/1";
/** .afterlog 원문 칸에서 구조화 프로필 JSON의 종류 */
export const BAND_PROFILE_SOURCE_KIND = "band-profile-data";

export interface BandImageRef {
  /** 페이지에 적힌 주소(원격 주소 또는 저장 페이지의 상대 경로) */
  src: string;
  /** 파일명(자산 연결용) */
  ref: string | null;
  /** 확보한 이미지 파일의 해시(없으면 미확보). 가져올 때 자산 번호가 새로 매겨져도 해시로 찾는다 */
  sha256?: string | null;
}

export interface BandProfileComment {
  /** 임시 키(원본 댓글 ID가 화면에 없음): 부모 + 작성자 + 시각 + 글 + 순번 */
  key: string;
  parentKey: string | null;
  author: string | null;
  authorAvatar: BandImageRef | null;
  text: string;
  images: BandImageRef[];
  timeText: string | null;
  local: string | null;
}

export interface BandProfileStory {
  /** 임시 키(원본 스토리 ID가 화면에 없음): 시각 + 글 앞부분 + 순번 */
  key: string;
  order: number;
  timeText: string | null;
  local: string | null;
  text: string;
  /** detail: 상세에서 읽은 전문 · list: 목록 글(줄 제한 표시라 잘렸는지 모름) */
  textSource: "detail" | "list";
  images: BandImageRef[];
  links: string[];
  /** 화면에 보인 수(없으면 null = 확인 못 함) */
  reactionsShown: number | null;
  commentsShown: number | null;
  comments: BandProfileComment[];
  /** complete: 보인 수만큼 확보 · partial: 모자람 · none: 0개 확인 · notCollected: 상세를 열지 않음 */
  commentsState: "complete" | "partial" | "none" | "notCollected";
}

export interface BandProfileBasics {
  observedAt: string | null;
  name: string | null;
  description: string | null;
  info: string | null;
  joinInfo: string | null;
  avatar: BandImageRef | null;
  cover: BandImageRef | null;
  /** 프로필 자체의 표정·댓글 수(스토리 것과 섞지 않음). null = 화면에 숫자가 보이지 않음 */
  reactionsShown: number | null;
  commentsShown: number | null;
}

export interface BandProfileRecord extends BandProfileBasics {
  schema: typeof BAND_PROFILE_SCHEMA;
  platform: "band";
  /** profilePage 프로필 화면 · profilePopup 팝업 · memberPage 인물의 작성글/사진/댓글 화면(사진만 있는 저장본 등) */
  surface: "profilePage" | "profilePopup" | "memberPage";
  bandNo: string | null;
  memberKey: string | null;
  /** confirmed: 프로필 주소·링크로 인물 확인 · unconfirmed: 팝업 등 식별자 없음(이름으로 합치지 않음) */
  identity: "confirmed" | "unconfirmed";
  /** 들어온 화면 주소(팝업이면 멤버 목록 주소 = 같은 팝업을 다시 여는 링크가 아님) */
  sourceUrl: string | null;
  /** 확인된 프로필 주소 */
  profileUrl: string | null;
  /** 팝업이 보여 준 스토리 수 */
  storyCountShown: number | null;
  /** 사진 이력: 실제 화면 표본이 없어 '확인 못 함' */
  photoHistory: { state: "unrecognized" | "none" | "collected"; items: { image: BandImageRef; timeText: string | null }[] };
  stories: { state: "collected" | "none" | "notCollected" | "unrecognized"; items: BandProfileStory[] };
  /** 인물 화면 '사진' 탭(이 인물이 올린 사진). 원본 주소와 목록의 축소본 */
  memberPhotos?: { state: "collected" | "none" | "notCollected" | "unrecognized"; items: { image: BandImageRef; thumb: BandImageRef | null }[] };
  /** 앞선 관측(합치기에서 기본 정보가 바뀌면 여기 남긴다) */
  history?: BandProfileBasics[];
  notes: string[];
}

const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const num = (el: Element | null | undefined): number | null => {
  const t = txt(el).replace(/,/g, "");
  return /^\d+$/.test(t) ? Number(t) : null;
};
const img = (src: string | null | undefined): BandImageRef | null => (src && !src.startsWith("data:") ? { src, ref: imageRefFromSrc(src) ?? null } : null);
const localOf = (raw: string | null) => (raw ? parseKoreanDateTime(raw).local : null);
const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, "");

/** 스타일의 background-image에서 주소 */
function bgImage(el: Element | null): BandImageRef | null {
  const st = el?.getAttribute("style") ?? "";
  const m = st.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
  return m ? img(m[2].replace(/&quot;/g, "")) : null;
}

/** 저장 페이지 머리의 <!-- saved from url=(0070)https://... --> */
export function savedFromUrl(html: string): string | null {
  const m = html.slice(0, 2000).match(/<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/i);
  return m ? m[1] : null;
}

/**
 * 인물 주소 해석(P01): band 번호는 숫자 문자열(자릿수 제한 없음), memberKey는 불투명 문자열.
 * 경로 조각을 한 번만 풀고(끝의 '=' 유지, 디코딩·패딩 제거 금지), band.us/www.band.us 차이는 같게 본다.
 */
export function parseBandMemberPath(url: string | null | undefined): { bandNo: string; memberKey: string; profile: boolean } | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url, "https://www.band.us/");
  } catch {
    return null;
  }
  if (!/(^|\.)band\.us$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/band\/(\d+)\/member\/([^/]+)(\/profile)?\/?$/);
  if (!m) return null;
  let key: string;
  try {
    key = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (!key || key === "#") return null;
  return { bandNo: m[1], memberKey: key, profile: !!m[3] };
}

/** 인물 화면 주소(/member/KEY, /member/KEY/post|photo|comment|profile) */
export function parseBandMemberAnyPath(url: string | null | undefined): { bandNo: string; memberKey: string; tab: string | null } | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url, "https://www.band.us/");
  } catch {
    return null;
  }
  if (!/(^|\.)band\.us$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/band\/(\d+)\/member\/([^/]+)(?:\/(post|photo|comment|profile))?\/?$/);
  if (!m) return null;
  let key: string;
  try {
    key = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  return key ? { bandNo: m[1], memberKey: key, tab: m[3] ?? null } : null;
}

/** 밴드 사진 주소의 원본(목록은 ?type=… 축소본) */
export const bandOriginalImage = (src: string) => (/^https?:\/\/[^/]*pstatic\.net\//.test(src) ? src.replace(/\?type=[^&#]*(&|$)/, (_m, amp) => (amp ? "?" : "")).replace(/\?$/, "") : src);

export const bandProfileUrl = (bandNo: string, memberKey: string) => `https://www.band.us/band/${bandNo}/member/${encodeURIComponent(memberKey)}/profile`;
/** 같은 인물 판정 키(P02: 이름이 같아도 식별자가 다르면 다른 인물) */
export const bandMemberKey = (r: Pick<BandProfileRecord, "bandNo" | "memberKey">) => (r.bandNo && r.memberKey ? `band:${r.bandNo}:member:${r.memberKey}` : null);

/** 보이지 않는(닫힌) 레이어는 읽지 않는다. 저장 페이지에서는 style 속성만 볼 수 있다 */
function hidden(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const st = (n.getAttribute("style") ?? "").replace(/\s+/g, "");
    if (/display:none|visibility:hidden/i.test(st) || n.hasAttribute("hidden")) return true;
  }
  return false;
}

function bodyOf(el: Element | null): { text: string; images: BandImageRef[]; blocks: ContentBlock[] } {
  if (!el) return { text: "", images: [], blocks: [] };
  const blocks = extractBlocks(el);
  const images = Array.from(el.querySelectorAll("img"))
    .map((i) => img(i.getAttribute("src")))
    .filter((x): x is BandImageRef => !!x);
  return { text: blocksToPlainText(blocks).trim(), images, blocks };
}

/** 스토리 상세의 댓글. 표본에 항목이 없어 일반 글의 댓글 구조(.cComment · .writeInfo · ._commentContent · time · .sReplyList)를 가정한다(미검증) */
function readComments(list: Element | null): BandProfileComment[] {
  if (!list) return [];
  const out: BandProfileComment[] = [];
  const walk = (els: Element[], parentKey: string | null) => {
    const seen = new Map<string, number>();
    for (const cc of els) {
      const item = cc.querySelector(".itemWrap") ?? cc;
      const author = txt(item.querySelector(".writeInfo .name")) || item.querySelector(".writeInfo img")?.getAttribute("alt") || null;
      const timeEl = item.querySelector("time");
      const timeText = timeEl?.getAttribute("title") || txt(timeEl) || null;
      const b = bodyOf(item.querySelector("._commentContent, .commentBody .txt") ?? item.querySelector(".commentBody"));
      const base = `${parentKey ?? ""}/${author ?? ""}|${timeText ?? ""}|${norm(b.text).slice(0, 200)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const key = `${base}#${n}`;
      out.push({ key, parentKey, author, authorAvatar: img(item.querySelector(".writeInfo img")?.getAttribute("src")), text: b.text, images: b.images, timeText, local: localOf(timeText) });
      walk(
        Array.from(cc.querySelectorAll(".cComment")).filter((r) => r.parentElement?.closest(".sReplyList")?.closest(".cComment") === cc),
        key,
      );
    }
  };
  walk(
    Array.from(list.querySelectorAll(".cComment")).filter((c) => !c.parentElement?.closest(".sReplyList")),
    null,
  );
  return out;
}

interface DetailRead {
  timeText: string | null;
  text: string;
  images: BandImageRef[];
  links: string[];
  reactionsShown: number | null;
  commentsShown: number | null;
  comments: BandProfileComment[];
}

function readDetail(d: Element): DetailRead {
  const timeEl = d.querySelector(".postListInfoWrap time, time");
  const body = bodyOf(d.querySelector("[data-viewname='DProfileStoryDetailCollectionView']") ?? d.querySelector(".postMain"));
  const reaction = d.querySelector("[data-viewname='DBandProfileStoryReactionMainView']");
  return {
    timeText: timeEl?.getAttribute("title") || txt(timeEl) || null,
    text: body.text,
    images: body.images,
    links: Array.from(d.querySelectorAll(".postMain a[href]"))
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => /^https?:/.test(h)),
    reactionsShown: num(reaction?.querySelector("._emotionCountRegion .count, .uEmotionView .count")),
    commentsShown: num(reaction?.querySelector("._commentCountSpan")),
    comments: readComments(d.querySelector("[data-viewname='DBandProfileStoryCommentListView']")),
  };
}

function commentsState(shown: number | null, got: number, opened: boolean): BandProfileStory["commentsState"] {
  if (!opened) return shown === 0 ? "none" : "notCollected";
  if (shown === 0 && got === 0) return "none";
  if (shown === null) return got ? "partial" : "notCollected";
  return got >= shown ? "complete" : "partial";
}

/** 목록 항목과 상세를 맞춘다: 시각이 같고 목록 글이 상세 글의 앞부분이면 같은 스토리 */
function sameStory(listTime: string | null, listText: string, d: DetailRead) {
  if (!listTime || !d.timeText || norm(listTime) !== norm(d.timeText)) return false;
  const a = norm(listText).replace(/(\.\.\.|…)+$/, "");
  const b = norm(d.text);
  return !a || !b || b.startsWith(a.slice(0, 40)) || a.startsWith(b.slice(0, 40));
}

function storyKey(timeText: string | null, text: string, seen: Map<string, number>) {
  const base = `${timeText ?? ""}|${norm(text).slice(0, 80)}`;
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return `${base}#${n}`;
}

/**
 * 문서(저장 페이지 또는 수집 확장이 복제한 영역)에서 인물 프로필을 읽는다.
 * 배경의 멤버 목록은 읽지 않는다(P04). 열린 팝업·프로필 페이지만.
 */
export function parseBandProfileDocument(doc: Document | Element, opts: { pageUrl?: string | null; observedAt?: string | null } = {}): BandProfileRecord[] {
  const root = "documentElement" in doc ? doc.documentElement : doc;
  const pageUrl = opts.pageUrl ?? null;
  const observedAt = opts.observedAt ?? null;
  const out: BandProfileRecord[] = [];
  const details = Array.from(root.querySelectorAll("[data-viewname='DProfileStoryDetailView']")).map(readDetail);
  const usedDetails = new Set<DetailRead>();

  for (const page of Array.from(root.querySelectorAll("[data-viewname='DProfileView']"))) {
    const fromUrl = parseBandMemberPath(pageUrl);
    // 카드 안 링크(/band/N/member/KEY)로도 인물을 확인한다. 주소와 링크가 다르면 링크를 쓰지 않는다
    const linkKeys = new Set(
      Array.from(page.querySelectorAll("a[href]"))
        .map((a) => parseBandMemberPath(a.getAttribute("href")))
        .filter((x): x is NonNullable<typeof x> => !!x)
        .map((x) => `${x.bandNo}\u0000${x.memberKey}`),
    );
    let bandNo = fromUrl?.bandNo ?? null;
    let memberKey = fromUrl?.memberKey ?? null;
    const notes: string[] = [];
    if (!fromUrl && linkKeys.size === 1) [bandNo, memberKey] = [...linkKeys][0].split("\u0000");
    if (fromUrl && linkKeys.size && !linkKeys.has(`${fromUrl.bandNo}\u0000${fromUrl.memberKey}`)) notes.push("화면 주소와 프로필 안 링크의 인물이 달라 주소 기준으로 기록했습니다.");

    const card = page.querySelector(".cardBox") ?? page;
    const listEl = root.querySelector("[data-viewname='DProfileStoryListView']");
    const stories: BandProfileStory[] = [];
    const seen = new Map<string, number>();
    if (listEl)
      Array.from(listEl.querySelectorAll("[data-viewname='DProfileStoryListItemView']")).forEach((li, i) => {
        const timeText = txt(li.querySelector("time"));
        const lb = bodyOf(li.querySelector("[data-viewname='DProfileStoryTextView']"));
        // 목록 카드의 사진·영상 썸네일(글 영역 밖 ._snippetRegion 등). 반응·메뉴 영역은 빼고
        const listImages = Array.from(li.querySelectorAll("img"))
          .filter((i) => !i.closest(".reactionButton, .menuModalLayer, [data-viewname='DProfileStoryMoreOptionsView']"))
          .map((i) => img(i.getAttribute("src")))
          .filter((x): x is BandImageRef => !!x);
        const reactionsShown = num(li.querySelector(".reactionButton .uEmotionView .count, .uEmotionView .count"));
        const commentsShown = num(li.querySelector("._commentCountSpan"));
        const d = details.find((x) => !usedDetails.has(x) && sameStory(timeText, lb.text, x));
        if (d) usedDetails.add(d);
        const text = d && d.text ? d.text : lb.text;
        stories.push({
          key: storyKey(timeText || null, text, seen),
          order: i,
          timeText: timeText || null,
          local: localOf(timeText || null),
          text,
          textSource: d && d.text ? "detail" : "list",
          images: d && d.images.length ? d.images : listImages,
          links: d?.links ?? [],
          reactionsShown: d?.reactionsShown ?? reactionsShown,
          commentsShown: d?.commentsShown ?? commentsShown,
          comments: d?.comments ?? [],
          commentsState: commentsState(d?.commentsShown ?? commentsShown, d?.comments.length ?? 0, !!d),
        });
      });
    // 목록에 없는 상세(목록이 덜 불러와진 경우 등)도 버리지 않는다
    for (const d of details)
      if (!usedDetails.has(d)) {
        usedDetails.add(d);
        stories.push({
          key: storyKey(d.timeText, d.text, seen),
          order: stories.length,
          timeText: d.timeText,
          local: localOf(d.timeText),
          text: d.text,
          textSource: "detail",
          images: d.images,
          links: d.links,
          reactionsShown: d.reactionsShown,
          commentsShown: d.commentsShown,
          comments: d.comments,
          commentsState: commentsState(d.commentsShown, d.comments.length, true),
        });
      }
    const identity = bandNo && memberKey ? "confirmed" : "unconfirmed";
    if (identity === "unconfirmed") notes.push("프로필 주소를 확인하지 못해 원본 인물 연결 미확인으로 보관했습니다.");
    // 밴드가 직접 '스토리가 없다'고 보여 준 경우(실제 화면: .uEmpty '아직 작성된 스토리가 없어요')
    const emptyShown = !stories.length && !!listEl?.querySelector(".uEmpty");
    if (emptyShown) notes.push(`밴드 화면이 스토리가 없다고 표시했습니다('${txt(listEl!.querySelector(".uEmpty strong, .uEmpty")).slice(0, 40)}').`);
    out.push({
      schema: BAND_PROFILE_SCHEMA,
      platform: "band",
      surface: "profilePage",
      bandNo,
      memberKey,
      identity,
      sourceUrl: pageUrl,
      profileUrl: bandNo && memberKey ? bandProfileUrl(bandNo, memberKey) : null,
      observedAt,
      name: txt(page.querySelector(".profileInfoBox .userName, .userName")) || null,
      description: txt(page.querySelector("._userDesc, .profileInfoBox .userNickname")) || null,
      info: txt(page.querySelector("._userInfo")) || null,
      joinInfo: txt(card.querySelector(".joinInfo")) || null,
      avatar: img(page.querySelector(".profileBox img")?.getAttribute("src")),
      cover: bgImage(card.querySelector(".backImage")),
      reactionsShown: num(card.querySelector(".reactionBox ._likeEmotionRegion .count, .reactionBox ._countBtn")),
      commentsShown: num(card.querySelector(".reactionBox ._commentCountSpan")),
      storyCountShown: null,
      photoHistory: { state: "unrecognized", items: [] },
      stories: { state: !listEl ? "unrecognized" : stories.length ? "collected" : "none", items: stories },
      notes,
    });
  }

  // 인물 화면(작성글·사진·댓글 탭)의 머리글 이름: 이 화면 위에 뜬 팝업이 같은 사람인지 확인할 때 쓴다
  const headerName = txt(root.querySelector(".accountSectionHeader .title .sf_color")) || null;
  const memberPage = parseBandMemberAnyPath(pageUrl);
  // 인물 화면의 '사진' 탭
  const photoList = root.querySelector("[data-viewname='DBandMemberPhotoListView']");
  const photoEmpty = !photoList && !!root.querySelector("[data-viewname='DBandMemberPhotoLayoutView'] .uEmpty");
  if ((photoList || photoEmpty) && memberPage && !out.some((r) => r.surface === "profilePage")) {
    const items = photoList
      ? Array.from(photoList.querySelectorAll("[data-viewname='DBandMemberPhotoListItemView'] img"))
          .map((i) => i.getAttribute("src"))
          .filter((x): x is string => !!x && !x.startsWith("data:"))
          .map((src) => ({ image: img(bandOriginalImage(src))!, thumb: bandOriginalImage(src) !== src ? img(src) : null }))
      : [];
    out.push({
      schema: BAND_PROFILE_SCHEMA,
      platform: "band",
      surface: "memberPage",
      bandNo: memberPage.bandNo,
      memberKey: memberPage.memberKey,
      identity: "confirmed",
      sourceUrl: pageUrl,
      profileUrl: bandProfileUrl(memberPage.bandNo, memberPage.memberKey),
      observedAt,
      name: headerName,
      description: null,
      info: null,
      joinInfo: null,
      avatar: null,
      cover: null,
      reactionsShown: null,
      commentsShown: null,
      storyCountShown: null,
      photoHistory: { state: "unrecognized", items: [] },
      stories: { state: "notCollected", items: [] },
      memberPhotos: { state: items.length ? "collected" : "none", items },
      notes: [],
    });
  }

  for (const layer of Array.from(root.querySelectorAll("[data-viewname='DProfileLayerView']"))) {
    if (hidden(layer)) continue;
    const band = Array.from(layer.querySelectorAll("a[href]"))
      .map((a) => (a.getAttribute("href") ?? "").match(/\/band\/(\d+)\//)?.[1])
      .find(Boolean);
    const name = txt(layer.querySelector(".cProfileViewCard .userName, .userName")) || null;
    // 주소가 프로필 주소이거나, 인물 화면(작성글·사진·댓글) 위에 뜬 팝업이고 이름이 그 화면 머리글과 같을 때만 그 인물로 본다
    const fromUrl = parseBandMemberPath(pageUrl) ?? (memberPage && headerName && name && norm(headerName) === norm(name) ? { bandNo: memberPage.bandNo, memberKey: memberPage.memberKey, profile: false } : null);
    const storyCountShown = num(layer.querySelector("[data-viewname='DProfileStoryCountView'] em.count, [data-viewname='DProfileStoryCountView'] .count"));
    out.push({
      schema: BAND_PROFILE_SCHEMA,
      platform: "band",
      surface: "profilePopup",
      bandNo: band ?? fromUrl?.bandNo ?? (pageUrl?.match(/\/band\/(\d+)/)?.[1] ?? null),
      // 팝업 링크는 모두 '#'. 주소가 프로필 주소일 때만 그 인물로 본다
      memberKey: fromUrl?.memberKey ?? null,
      identity: fromUrl ? "confirmed" : "unconfirmed",
      sourceUrl: pageUrl,
      profileUrl: fromUrl ? bandProfileUrl(fromUrl.bandNo, fromUrl.memberKey) : null,
      observedAt,
      name,
      description: txt(layer.querySelector("[data-viewname='DProfileDescriptionView'] ._userDesc")) || null,
      info: txt(layer.querySelector("[data-viewname='DProfileDescriptionView'] ._userInfo")) || null,
      joinInfo: txt(layer.querySelector(".joinInfo")) || null,
      avatar: img(layer.querySelector("img._profileImage, .infoBox img")?.getAttribute("src")),
      cover: null,
      // 숫자가 비어 있으면 0이 아니라 '확인 못 함'(P06)
      reactionsShown: num(layer.querySelector("._emotionCount")),
      commentsShown: num(layer.querySelector("._commentCountRegion")),
      storyCountShown,
      photoHistory: { state: "unrecognized", items: [] },
      // 스토리 수가 표시되지 않거나 0이면 팝업이 보여 준 스토리는 없다(표본: 스토리 없는 인물은 '스토리 보기' 칸이 비어 있음)
      // 스토리 수가 0이면 없음. 수가 비어 있고 '스토리 보기'도 없으면 0이라고 단정하지 않는다(확인 못 함)
      stories: { state: storyCountShown === 0 ? "none" : storyCountShown === null && !layer.querySelector("a._storyAnchor") ? "unrecognized" : "notCollected", items: [] },
      notes: fromUrl ? (parseBandMemberPath(pageUrl) ? [] : ["인물 화면 위에 뜬 팝업이고 이름이 화면 머리글과 같아 그 인물로 연결했습니다."]) : ["주소가 바뀌지 않는 팝업이라 원본 인물 연결 미확인으로 보관했습니다. 같은 이름의 다른 인물과 합치지 않습니다."],
    });
  }
  return out;
}

/** 모든 이미지 참조 */
export function profileImages(r: BandProfileRecord): BandImageRef[] {
  const all: (BandImageRef | null)[] = [r.avatar, r.cover, ...r.photoHistory.items.map((p) => p.image), ...(r.memberPhotos?.items ?? []).flatMap((p) => [p.image, p.thumb])];
  for (const s of r.stories.items) {
    all.push(...s.images);
    for (const c of s.comments) all.push(c.authorAvatar, ...c.images);
  }
  return all.filter((x): x is BandImageRef => !!x);
}

export function isBandProfileRecord(x: unknown): x is BandProfileRecord {
  return !!x && typeof x === "object" && (x as { schema?: unknown }).schema === BAND_PROFILE_SCHEMA;
}

/** 프로필 요약(목록·알림용) */
export function profileSummary(r: BandProfileRecord): string {
  const s = r.stories;
  const story = s.state === "collected" ? `스토리 ${s.items.length}개` : s.state === "none" ? "스토리 0개 확인" : s.state === "notCollected" ? `스토리 수집 안 함${r.storyCountShown ? `(표시 ${r.storyCountShown}개)` : ""}` : "스토리 확인 못 함";
  const photos = r.memberPhotos?.state === "collected" ? ` · 작성 사진 ${r.memberPhotos.items.length}장` : "";
  return `${r.name ?? "이름 확인 못 함"} · ${story}${photos}${r.identity === "unconfirmed" ? " · 인물 연결 미확인" : ""}`;
}

// ---------- 합치기(같은 인물의 새 관측) ----------

const basicsOf = (r: BandProfileBasics): BandProfileBasics => ({
  observedAt: r.observedAt,
  name: r.name,
  description: r.description,
  info: r.info,
  joinInfo: r.joinInfo,
  avatar: r.avatar,
  cover: r.cover,
  reactionsShown: r.reactionsShown,
  commentsShown: r.commentsShown,
});
const sameBasics = (a: BandProfileBasics, b: BandProfileBasics) =>
  a.name === b.name && a.description === b.description && a.info === b.info && a.joinInfo === b.joinInfo && a.avatar?.ref === b.avatar?.ref && a.cover?.ref === b.cover?.ref && a.reactionsShown === b.reactionsShown && a.commentsShown === b.commentsShown;

export interface ProfileMergeResult {
  record: BandProfileRecord;
  storiesAdded: number;
  commentsAdded: number;
  /** 목록 글 → 상세 전문 보완 */
  textsCompleted: number;
  basicsChanged: boolean;
  changed: boolean;
}

/**
 * 같은 인물(bandNo+memberKey)의 두 관측을 합친다(M03·P06).
 * - 기본 정보: 더 늦은 관측을 표시하고, 바뀌었으면 앞 관측을 history에 남긴다. 새 관측에 없는 값(null)으로 기존 값을 지우지 않는다.
 * - 스토리·댓글: 같은 키는 하나로(전문이 생기면 보완), 새 키만 더한다. 반응 수는 더하지 않고 최신 관측값.
 */
export function mergeProfileRecords(old: BandProfileRecord, inc: BandProfileRecord, opts: { sameObservation?: boolean } = {}): ProfileMergeResult {
  const newer = (inc.observedAt ?? "") >= (old.observedAt ?? "");
  const [latest, earlier] = newer ? [inc, old] : [old, inc];
  const pick = <K extends keyof BandProfileBasics>(k: K) => (latest[k] ?? earlier[k]) as BandProfileBasics[K];
  const basics: BandProfileBasics = {
    observedAt: latest.observedAt,
    name: pick("name"),
    description: pick("description"),
    info: pick("info"),
    joinInfo: pick("joinInfo"),
    avatar: pick("avatar"),
    cover: pick("cover"),
    reactionsShown: pick("reactionsShown"),
    commentsShown: pick("commentsShown"),
  };
  const history = [...(old.history ?? []), ...(inc.history ?? [])];
  const basicsChanged = !sameBasics(basicsOf(old), basics);
  // 같은 때 두 화면(팝업 + 프로필 페이지)에서 읽은 것은 앞선 관측이 아니다
  if (basicsChanged && !opts.sameObservation && !history.some((h) => h.observedAt === old.observedAt && sameBasics(h, old))) history.push(basicsOf(old));

  let storiesAdded = 0;
  let commentsAdded = 0;
  let textsCompleted = 0;
  const items = old.stories.items.map((s) => ({ ...s, comments: [...s.comments] }));
  const byKey = new Map(items.map((s) => [s.key, s]));
  // 목록 글(잘렸을 수 있음)로 만든 키와 상세 전문 키가 다를 수 있어 시각+앞부분으로도 맞춘다
  const find = (s: BandProfileStory) => byKey.get(s.key) ?? items.find((x) => x.timeText && x.timeText === s.timeText && (norm(s.text).startsWith(norm(x.text).slice(0, 30)) || norm(x.text).startsWith(norm(s.text).slice(0, 30))));
  for (const s of inc.stories.items) {
    const hit = find(s);
    if (!hit) {
      items.push({ ...s, order: items.length });
      storiesAdded++;
      commentsAdded += s.comments.length;
      continue;
    }
    if (s.textSource === "detail" && hit.textSource === "list" && s.text) {
      hit.text = s.text;
      hit.textSource = "detail";
      hit.images = s.images.length ? s.images : hit.images;
      textsCompleted++;
    }
    const have = new Set(hit.comments.map((c) => c.key));
    for (const c of s.comments)
      if (!have.has(c.key)) {
        hit.comments.push(c);
        commentsAdded++;
      }
    if (newer) {
      hit.reactionsShown = s.reactionsShown ?? hit.reactionsShown;
      hit.commentsShown = s.commentsShown ?? hit.commentsShown;
    }
    hit.commentsState = commentsState(hit.commentsShown, hit.comments.length, hit.commentsState !== "notCollected" || s.commentsState !== "notCollected");
  }
  const storyState: BandProfileRecord["stories"]["state"] = items.length ? "collected" : old.stories.state === "none" || inc.stories.state === "none" ? "none" : old.stories.state === "unrecognized" ? inc.stories.state : old.stories.state;
  // 작성 사진: 같은 사진(파일명)은 하나로
  const photoKey = (p: { image: BandImageRef }) => p.image.ref ?? p.image.src;
  const photoItems = [...(old.memberPhotos?.items ?? [])];
  let photosAdded = 0;
  for (const p of inc.memberPhotos?.items ?? [])
    if (!photoItems.some((x) => photoKey(x) === photoKey(p))) {
      photoItems.push(p);
      photosAdded++;
    }
  const photoStates = [old.memberPhotos?.state, inc.memberPhotos?.state];
  const memberPhotos: BandProfileRecord["memberPhotos"] = photoItems.length ? { state: "collected", items: photoItems } : photoStates.includes("none") ? { state: "none", items: [] } : (old.memberPhotos ?? inc.memberPhotos);
  const rank = { profilePage: 3, profilePopup: 2, memberPage: 1 } as const;
  const record: BandProfileRecord = {
    ...old,
    ...basics,
    memberPhotos,
    surface: rank[inc.surface] > rank[old.surface] ? inc.surface : old.surface,
    storyCountShown: (newer ? inc.storyCountShown : old.storyCountShown) ?? old.storyCountShown ?? inc.storyCountShown,
    stories: { state: storyState, items },
    history: history.length ? history : undefined,
    notes: [...new Set([...old.notes, ...inc.notes])],
  };
  const changed = basicsChanged || photosAdded > 0 || (old.memberPhotos?.state ?? null) !== (memberPhotos?.state ?? null) || storiesAdded > 0 || commentsAdded > 0 || textsCompleted > 0 || JSON.stringify(old.stories.items.map((s) => [s.reactionsShown, s.commentsShown])) !== JSON.stringify(items.slice(0, old.stories.items.length).map((s) => [s.reactionsShown, s.commentsShown]));
  return { record, storiesAdded, commentsAdded, textsCompleted, basicsChanged, changed };
}
