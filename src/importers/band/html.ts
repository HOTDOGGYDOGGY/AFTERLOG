// 밴드 웹에서 "다른 이름으로 저장"한 HTML 페이지 파서.
// 순수 모듈: DOM 파싱에 DOMParser만 사용하고 UI·DB에 접근하지 않는다.
// 같은 입력이면 항상 같은 순서·분류를 돌려준다 (ID 부여는 buildDocument 단계).

import type { ContentBlock, InputFormat, IssueKind, ReactionSnapshot, TimeValue } from "../../domain/types";
import { parseKoreanDateTime } from "./time";

export const BAND_HTML_PARSER_VERSION = "band-html/2";

export interface ParsedIdentity {
  key: string;
  name: string;
  description: string;
  avatarRef?: string;
  avatarUrl?: string;
}

export interface ParsedEntry {
  tempId: string;
  kind: "post" | "comment" | "unclassified";
  authorKey: string | null;
  blocks: ContentBlock[];
  excerpt?: ContentBlock[];
  time: TimeValue | null;
  parentTempId: string | null;
  sourcePath: string;
  meta: { readCount?: number; commentCount?: number };
  reactions?: ReactionSnapshot;
  parentUnknown?: boolean;
  suggestedParentTempId?: string;
}

export interface ParsedIssue {
  kind: IssueKind;
  message: string;
  entryTempId?: string;
}

export interface ParsedDocument {
  format: InputFormat;
  title: string;
  identities: ParsedIdentity[];
  entries: ParsedEntry[];
  issues: ParsedIssue[];
  /** 형식 판정 근거 */
  evidence: string[];
  confidence: "high" | "review";
}

export interface BandPageParseResult {
  pageTitle: string;
  bandName: string | null;
  documents: ParsedDocument[];
  /** 문서를 하나도 찾지 못했을 때의 설명 */
  notes: string[];
  /** 페이지가 참조하는 이미지 파일(프로필·본문). 첨부 연결에 사용 */
  imageRefs: string[];
}

// ---------- 공통 유틸 ----------

const text = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** 저장된 페이지의 img src에서 파일명만 뽑는다. "./xxx_files/a.png" → "a.png" */
export function imageRefFromSrc(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("data:")) return undefined;
  const clean = src.split(/[?#]/)[0];
  const last = clean.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last) || undefined;
  } catch {
    return last || undefined;
  }
}

/** http(s) 주소면 그대로 돌려준다(링크로만 보관, 자동 요청하지 않음) */
export function remoteUrl(src: string | null | undefined): string | undefined {
  return src && /^https?:\/\//i.test(src) ? src : undefined;
}

/** time 요소: title의 전체 시각을 원문으로, 화면 표기는 display로 함께 보존 */
function timeFrom(el: Element | null | undefined): TimeValue | null {
  if (!el) return null;
  const title = el.getAttribute("title")?.trim();
  const shown = text(el);
  if (!title && !shown) return null;
  const t = parseKoreanDateTime(title || shown, title ? "title 속성의 전체 시각" : "화면 표기");
  if (title && shown && shown !== title) t.display = shown;
  return t;
}

function elementPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && parts.length < 12) {
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const idx = Array.from(parent.children).indexOf(cur) + 1;
    parts.unshift(`${tag}:nth-child(${idx})`);
    cur = parent;
  }
  return parts.join(">");
}

function parseCount(s: string): number | undefined {
  const m = s.replace(/,/g, "").match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "UL", "OL", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "TR"]);

/**
 * 본문 요소를 블록 배열로 바꾼다. 텍스트는 한 글자도 버리지 않는다.
 * - <br> → 줄바꿈, 블록 요소 경계 → 줄바꿈
 * - a.gBandMember → mention 블록 (부모 관계와 별개)
 * - img → image 블록 (자산 연결은 가져오기 단계에서)
 */
export function extractBlocks(root: Element, opts: { skip?: (el: Element) => boolean } = {}): ContentBlock[] {
  const out: ContentBlock[] = [];
  let buf = "";

  const flush = () => {
    if (buf) out.push({ type: "text", text: buf });
    buf = "";
  };
  const newline = () => {
    if (buf && !buf.endsWith("\n")) buf += "\n";
  };

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const v = node.nodeValue ?? "";
      // 블록 요소 경계에 있는, 줄바꿈이 섞인 공백뿐인 노드는 HTML 소스 들여쓰기이므로 건너뛴다.
      // 인라인 요소(멘션·<br>) 사이의 공백·줄바꿈은 내용일 수 있으므로 그대로 둔다.
      if (/^\s*$/.test(v) && v.includes("\n")) {
        const isBlockEl = (n: Node | null) => !n || (n.nodeType === 1 && BLOCK_TAGS.has((n as Element).tagName));
        if (isBlockEl(node.previousSibling) || isBlockEl(node.nextSibling)) return;
      }
      buf += v.replace(/\r\n?/g, "\n");
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (opts.skip?.(el)) return;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") return;
    if (tag === "BR") {
      buf += "\n";
      return;
    }
    if (tag === "IMG") {
      flush();
      const src = el.getAttribute("src");
      out.push({ type: "image", assetId: null, sourceRef: imageRefFromSrc(src), sourceUrl: remoteUrl(src), alt: el.getAttribute("alt") ?? undefined });
      return;
    }
    if (tag === "A" && el.classList.contains("gBandMember")) {
      flush();
      out.push({ type: "mention", name: text(el).replace(/^@/, "") });
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) newline();
    el.childNodes.forEach(walk);
    if (isBlock) newline();
  };

  root.childNodes.forEach(walk);
  flush();
  return normalizeBlocks(out);
}

/** 블록 경계의 공백·줄바꿈만 정리한다. 문단 안 줄바꿈·빈 줄·들여쓰기는 유지한다. */
function normalizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const res = blocks.map((b) => (b.type === "text" ? { ...b } : b));
  res.forEach((b, i) => {
    if (b.type !== "text") return;
    const prev = res[i - 1];
    const next = res[i + 1];
    if (prev?.type === "image") b.text = b.text.replace(/^\s+/, "");
    if (!next || next.type === "image") b.text = b.text.replace(/\s+$/, "");
  });
  const first = res[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  return res.filter((b) => !(b.type === "text" && b.text === ""));
}

export function blocksToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => (b.type === "text" ? b.text : b.type === "mention" ? `@${b.name}` : b.type === "unclassified" ? b.text : b.type === "image" ? "[이미지]" : ""))
    .join("");
}

// ---------- 인물 ----------

class IdentityTable {
  private map = new Map<string, ParsedIdentity>();
  private byName = new Map<string, Set<string>>();

  add(name: string, description: string, avatarSrc?: string | null): string {
    const avatarRef = imageRefFromSrc(avatarSrc);
    const key = `${name}\u0000${avatarRef ?? ""}`;
    const cur = this.map.get(key);
    if (!cur) {
      this.map.set(key, { key, name, description, avatarRef, avatarUrl: remoteUrl(avatarSrc) });
      const set = this.byName.get(name) ?? new Set();
      set.add(key);
      this.byName.set(name, set);
    } else if (!cur.description && description) {
      cur.description = description;
    }
    return key;
  }

  list(): ParsedIdentity[] {
    return Array.from(this.map.values());
  }

  /** 같은 이름인데 프로필이 다른 경우: 자동 병합하지 않고 검토 요청 */
  duplicates(): string[] {
    return Array.from(this.byName.entries())
      .filter(([, keys]) => keys.size > 1)
      .map(([name]) => name);
  }
}

// ---------- 반응(표정) ----------
// 이번 실제 샘플에는 양수 반응이 없어 "값 있음" 구조는 아직 검증되지 않았다.
// 선택 버튼(표정짓기)이나 빈 영역만으로 0을 확정하지 않는다. (명세 21.3, S09)

function postReactions(card: Element): ReactionSnapshot {
  const wrap = card.querySelector("._emotionCountViewRegion, .emotionCountWrap");
  const shown = text(wrap);
  const n = parseCount(shown);
  if (wrap && shown && n !== undefined && n > 0) {
    const icons = Array.from(wrap.querySelectorAll("img, [class*='emotion'], [class*='Emotion']"))
      .map((i) => i.getAttribute("alt") || i.getAttribute("title") || i.className)
      .filter(Boolean) as string[];
    return {
      status: "value",
      total: n,
      kinds: icons.length ? icons.map((label) => ({ label, count: null })) : [],
      reactors: "unknown",
      evidence: `표정 수 영역 표기 "${shown}" (종류별 수·반응자는 미확보, 실제 샘플 미검증)`,
    };
  }
  const layer = text(card.querySelector("._emotionCountLayerBtn"));
  return {
    status: "unknown",
    total: null,
    kinds: [],
    reactors: "unknown",
    evidence: `표정 수 영역이 비어 있음${layer ? ` (떠 있는 레이어 버튼 값 "${layer}"은 확정값으로 쓰지 않음)` : ""}`,
  };
}

function commentReactions(item: Element): ReactionSnapshot {
  const btn = item.querySelector(".likeCount, ._emotionIconBtn");
  const label = text(btn);
  const n = parseCount(label);
  if (btn && n !== undefined && n > 0)
    return { status: "value", total: n, kinds: [], reactors: "unknown", evidence: `댓글 표정 표기 "${label}" (실제 샘플 미검증)` };
  return { status: "unknown", total: null, kinds: [], reactors: "unknown", evidence: label ? `표정 버튼 문구 "${label}"뿐, 수 없음` : "표정 정보 없음" };
}

// ---------- 글과 댓글 (게시글 상세 레이어) ----------

function parsePostDetail(card: Element): ParsedDocument {
  const ids = new IdentityTable();
  const entries: ParsedEntry[] = [];
  const issues: ParsedIssue[] = [];
  const evidence: string[] = ["게시글 상세(cPostCard) 영역 발견"];
  let seq = 0;
  const nextId = (p: string) => `${p}${++seq}`;

  // 작성자
  const writer = card.querySelector(".postWriter");
  const writerImg = writer?.querySelector("img._image, img");
  const writerName = text(card.querySelector(".postWriterInfoWrap .text")) || writerImg?.getAttribute("alt")?.trim() || "";
  const writerDesc = text(card.querySelector(".postWriterInfoWrap .memo"));
  const writerKey = writerName ? ids.add(writerName, writerDesc, writerImg?.getAttribute("src")) : null;

  const postTimeEl = card.querySelector(".postWriterInfoWrap time, .postListInfoWrap time");

  // 본문: postBody 전체를 훑되 번역 UI 등 기능 영역은 제외
  const body = card.querySelector(".postBody");
  const skipUi = (el: Element) =>
    el.classList.contains("_preview_support") ||
    el.classList.contains("translationBox") ||
    el.classList.contains("_contentTranslationRegion") ||
    el.classList.contains("_postPinnedHashtagsRegion") ||
    el.classList.contains("gSrOnly");
  const postBlocks = body ? extractBlocks(body, { skip: skipUi }) : [];
  const hasTxtBody = !!card.querySelector(".postBody .txtBody");
  if (!hasTxtBody) evidence.push("txtBody 없음: postBody 전체를 본문으로 보존");

  const postId = nextId("p");
  const readCount = parseCount(text(card.querySelector(".postListInfoWrap .readCount")));
  const commentCountText = text(card.querySelector(".dPostCountView .comment .count"));
  entries.push({
    tempId: postId,
    kind: "post",
    authorKey: writerKey,
    blocks: postBlocks,
    time: timeFrom(postTimeEl),
    parentTempId: null,
    sourcePath: body ? elementPath(body) : elementPath(card),
    meta: {
      readCount,
      commentCount: commentCountText ? parseCount(commentCountText) : undefined,
    },
    reactions: postReactions(card),
  });
  if (!writerKey) issues.push({ kind: "author-missing", message: "게시글 작성자를 찾지 못했습니다.", entryTempId: postId });
  if (postBlocks.some((b) => b.type === "image")) {
    issues.push({
      kind: "unverified-structure",
      message: "게시글 이미지 구조는 실제 샘플로 검증되지 않았습니다. 위치를 확인해 주세요.",
      entryTempId: postId,
    });
  }

  // 댓글: .cComment 요소 하나 = 항목 하나. 답글은 구조(sReplyList 조상)로만 판정한다.
  const commentEls = Array.from(card.querySelectorAll(".dPostCommentMainView .cComment"));
  const elToId = new Map<Element, string>();
  for (const el of commentEls) {
    const id = nextId("c");
    elToId.set(el, id);
    const item = el.querySelector(":scope > [data-viewname='DCommentView'] > .itemWrap, :scope .itemWrap");
    const replyList = el.parentElement?.closest(".sReplyList");
    const parentEl = replyList ? replyList.closest(".cComment") : null;
    const parentTempId = parentEl ? elToId.get(parentEl) ?? null : postId;

    const writeInfo = item?.querySelector(".writeInfo");
    const nameEl = writeInfo?.querySelector(".name");
    const img = writeInfo?.querySelector("img");
    const name = text(nameEl) || img?.getAttribute("alt")?.trim() || "";
    const desc = text(writeInfo?.querySelector(".nickname"));
    const authorKey = name ? ids.add(name, desc, img?.getAttribute("src")) : null;

    const content = item?.querySelector("._commentContent, .txt");
    const commentBody = item?.querySelector(".commentBody");
    let blocks: ContentBlock[] = [];
    if (content) blocks = extractBlocks(content);
    // 본문 영역 밖(commentBody 안)의 첨부 이미지·스티커
    if (commentBody) {
      const extraImgs = Array.from(commentBody.querySelectorAll("img")).filter(
        (im) => !content?.contains(im) && !im.closest(".translationBox, ._contentTranslationRegion, .func, .uLoading"),
      );
      for (const im of extraImgs) {
        const src = im.getAttribute("src");
        blocks.push({ type: "image", assetId: null, sourceRef: imageRefFromSrc(src), sourceUrl: remoteUrl(src), alt: im.getAttribute("alt") ?? undefined });
      }
      if (extraImgs.length)
        issues.push({
          kind: "unverified-structure",
          message: "댓글 첨부 이미지 구조는 실제 샘플로 검증되지 않았습니다.",
          entryTempId: id,
        });
    }

    const timeEl = item?.querySelector(".func time, time");

    if (!content && !item) {
      // 구조를 알 수 없는 댓글: 버리지 않고 미분류로 보존
      entries.push({
        tempId: id,
        kind: "unclassified",
        authorKey: null,
        blocks: [{ type: "unclassified", text: (el.textContent ?? "").trim(), reason: "댓글 구조를 해석하지 못함" }],
        time: null,
        parentTempId,
        sourcePath: elementPath(el),
        meta: {},
      });
      issues.push({ kind: "unclassified", message: "해석하지 못한 댓글 영역이 있습니다. 원문 그대로 보존했습니다.", entryTempId: id });
      continue;
    }

    entries.push({
      tempId: id,
      kind: "comment",
      authorKey,
      blocks,
      time: timeFrom(timeEl),
      parentTempId,
      sourcePath: elementPath(el),
      meta: {},
      reactions: item ? commentReactions(item) : undefined,
    });
    if (!authorKey) issues.push({ kind: "author-missing", message: "작성자를 찾지 못한 댓글이 있습니다.", entryTempId: id });
  }

  const commentCount = entries[0].meta.commentCount;
  const found = entries.length - 1;
  if (commentCount !== undefined && commentCount !== found) {
    issues.push({
      kind: "comment-count-mismatch",
      message: `게시글에 표시된 댓글 수는 ${commentCount}개인데 저장된 페이지에서 ${found}개를 찾았습니다. 접힌 댓글·'이전 댓글 보기'가 저장되지 않았을 수 있습니다.`,
    });
  }
  evidence.push(`댓글 ${found}개 (답글 ${entries.filter((e) => e.kind === "comment" && e.parentTempId !== postId).length}개)`);

  for (const name of ids.duplicates()) {
    issues.push({ kind: "unverified-structure", message: `"${name}" 이름을 가진 인물이 프로필 사진이 달라 따로 분리되었습니다. 같은 사람이면 인물 탭에서 합쳐 주세요.` });
  }

  const firstLine = blocksToPlainText(postBlocks).split("\n")[0].slice(0, 40);
  return {
    format: "band-post",
    title: firstLine ? `${writerName ? writerName + " · " : ""}${firstLine}` : "밴드 게시글",
    identities: ids.list(),
    entries,
    issues,
    evidence,
    confidence: writerKey && hasTxtBody ? "high" : "review",
  };
}

// ---------- 댓글 모음 (멤버 페이지 > 댓글) ----------

function parseMemberComments(doc: Document, list: Element): ParsedDocument {
  const ids = new IdentityTable();
  const entries: ParsedEntry[] = [];
  const issues: ParsedIssue[] = [];
  const memberName = text(doc.querySelector(".accountSectionHeader .title .sf_color"));
  const evidence = [
    "멤버 댓글 목록(DBandMemberCommentListView) 발견",
    "게시글을 열 때 뒤에 깔려 있던 목록일 수 있습니다. 스크롤로 불러온 부분만 저장되므로 그 인물의 전체 댓글 목록이라고 확인되지 않았습니다.",
  ];
  const authorKey = memberName ? ids.add(memberName, "") : null;
  if (memberName) evidence.push(`멤버 이름: ${memberName}`);

  const items = Array.from(list.querySelectorAll(".cCommentOnly"));
  items.forEach((el, i) => {
    const id = `m${i + 1}`;
    const commentEl = el.querySelector("p.comment");
    const bodyEl = el.querySelector("p.body");
    const dateEl = el.querySelector("p.date");
    const blocks = commentEl ? extractBlocks(commentEl) : [];
    const excerpt = bodyEl ? extractBlocks(bodyEl) : undefined;
    // p.comment 안의 "@이름"은 링크가 아닌 일반 텍스트로 저장된다. 멘션으로 추정하지 않고 원문 그대로 둔다.
    entries.push({
      tempId: id,
      kind: commentEl ? "comment" : "unclassified",
      authorKey,
      blocks: commentEl ? blocks : [{ type: "unclassified", text: (el.textContent ?? "").trim(), reason: "댓글 모음 항목 구조를 해석하지 못함" }],
      excerpt,
      time: dateEl ? parseKoreanDateTime(text(dateEl), "화면 표기") : null,
      parentTempId: null,
      sourcePath: elementPath(el),
      meta: {},
    });
  });
  if (!memberName) issues.push({ kind: "author-missing", message: "댓글 모음의 멤버 이름을 찾지 못했습니다." });
  issues.push({
    kind: "unknown-parent",
    message: "댓글 모음에는 원글의 일부(발췌)만 들어 있습니다. 원글 전체와 답글 관계는 알 수 없습니다.",
  });
  return {
    format: "band-member-comments",
    title: memberName ? `${memberName}님의 댓글 모음` : "댓글 모음",
    identities: ids.list(),
    entries,
    issues,
    evidence,
    confidence: "review",
  };
}

// ---------- 진입점 ----------

export function looksLikeBandHtml(html: string): boolean {
  return /band\.us|밴드|cPostCard|DBandMember/.test(html) && /<html|<body|<div/i.test(html);
}

export function parseBandHtml(html: string): BandPageParseResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const pageTitle = (doc.title ?? "").trim();
  const bandName = text(doc.querySelector(".printInfo .name, .bandName .uriText")) || null;
  const documents: ParsedDocument[] = [];
  const notes: string[] = [];

  // 프로필 스토리 상세에도 .cPostCard가 붙는다(실제 저장본 확인). 일반 게시글로 해석하지 않는다
  const cards = Array.from(doc.querySelectorAll(".cPostCard")).filter((c) => !c.closest("[data-viewname^='DProfileStory'], [data-viewname='DProfileView'], [data-viewname='DProfileLayerView']"));
  for (const card of cards) documents.push(parsePostDetail(card));
  // 인물 작성글·밴드 글 목록의 카드([DPostListItemView], .cPostCard 없음, 실제 저장 표본). 목록 카드는 본문이 줄여져 있거나
  // 댓글이 빠져 있을 수 있어 '검토 필요'로 두고, 전문·댓글은 글을 열어야 확인된다고 알린다. 글 상세 카드가 있으면 목록은 읽지 않는다
  if (!cards.length)
    for (const item of Array.from(doc.querySelectorAll("[data-viewname='DPostListItemView']"))) {
      if (item.closest(".cPostCard")) continue;
      const pd = parsePostDetail(item);
      pd.confidence = "review";
      pd.evidence.unshift("글 목록의 카드에서 읽음(목록 카드)");
      pd.issues.push({ kind: "unverified-structure", message: "글 목록 카드에서 읽은 글입니다. 본문 전체와 댓글은 글을 열어 저장해야 확인됩니다." });
      documents.push(pd);
    }

  const memberList = doc.querySelector("[data-viewname='DBandMemberCommentListView']");
  if (memberList && memberList.querySelector(".cCommentOnly")) documents.push(parseMemberComments(doc, memberList));

  if (!documents.length) {
    notes.push("밴드 게시글 상세 화면이나 댓글 모음을 찾지 못했습니다. 게시글을 연 상태에서 페이지를 저장했는지 확인해 주세요.");
  }

  const imageRefs = new Set<string>();
  for (const d of documents) {
    for (const idn of d.identities) if (idn.avatarRef) imageRefs.add(idn.avatarRef);
    for (const e of d.entries) for (const b of e.blocks) if (b.type === "image" && b.sourceRef) imageRefs.add(b.sourceRef);
  }

  return { pageTitle, bandName, documents, notes, imageRefs: Array.from(imageRefs) };
}
