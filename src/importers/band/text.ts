// 밴드 게시글 화면을 드래그해 복사한 "텍스트"의 파서 (대체 경로).
// 텍스트에는 답글 구조·정확한 시각·프로필 사진이 없다. 확실하지 않은 것은 만들지 않고
// 부모 미확정·제안으로 남긴다. 모든 줄에 분류(내용/메타/UI/빈 줄/미분류)를 붙인다.
import type { ContentBlock } from "../../domain/types";
import type { ParsedDocument, ParsedEntry, ParsedIdentity, ParsedIssue } from "./html";
import { parseKoreanDateTime } from "./time";

export const BAND_TEXT_PARSER_VERSION = "band-text/1";

export type LineClass = "content" | "meta" | "ui" | "blank" | "unclassified";
export interface LineInfo {
  n: number;
  text: string;
  cls: LineClass;
  note?: string;
  entryTempId?: string;
}

export interface BandTextParseResult {
  document: ParsedDocument | null;
  lines: LineInfo[];
  notes: string[];
}

const DATE_LINE = /^(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일(?:\s*(?:오전|오후)\s*\d{1,2}:\d{2})?$|^\d+\s*(?:초|분|시간|일)\s*전$|^(?:어제|오늘|방금)(?:\s*(?:오전|오후)\s*\d{1,2}:\d{2})?$/;
const COMMENT_COUNT = /^댓글\s*(\d+)$/;
const READ_LINE = /^(.*?)\s+([\d,]+)\s*읽음$/;
/** 댓글 꼬리(날짜 뒤) 영역에서 확인된 UI 문구 */
const FOOTER_UI = new Set(["표정짓기", "답글쓰기", "댓글 수정", "댓글", "댓글쓰기", "번역 보기"]);
const POST_UI = new Set(["글 옵션", "표정짓기", "댓글쓰기"]);

export function looksLikeBandText(t: string): boolean {
  return /^멤버\S/m.test(t) && (/표정짓기/.test(t) || /답글쓰기/.test(t) || /읽음/.test(t));
}

function textBlocks(lines: string[]): ContentBlock[] {
  const t = lines.join("\n").replace(/^\n+|\n+$/g, "");
  return t ? [{ type: "text", text: t }] : [];
}

export function parseBandText(raw: string): BandTextParseResult {
  const L = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const info: LineInfo[] = L.map((text, i) => ({ n: i + 1, text, cls: text.trim() ? "unclassified" : "blank" }));
  const mark = (i: number, cls: LineClass, entryTempId?: string, note?: string) => {
    if (i < 0 || i >= L.length) return;
    info[i] = { ...info[i], cls: L[i].trim() ? cls : "blank", entryTempId, note };
  };
  const notes: string[] = [];
  const issues: ParsedIssue[] = [];
  const identities = new Map<string, ParsedIdentity>();
  const idn = (name: string, desc: string) => {
    const key = `${name}\u0000`;
    if (!identities.has(key)) identities.set(key, { key, name, description: desc });
    else if (!identities.get(key)!.description && desc) identities.get(key)!.description = desc;
    return key;
  };

  // 댓글 머리: "멤버{이름}" / 빈 줄 / "{이름}"
  const heads: number[] = [];
  for (let i = 0; i + 2 < L.length; i++) {
    const a = L[i].trim();
    if (a.startsWith("멤버") && a.length > 2 && !L[i + 1].trim() && L[i + 2].trim() === a.slice(2)) heads.push(i);
  }

  const entries: ParsedEntry[] = [];
  let seq = 0;

  // 게시글 머리: 첫 줄 "멤버{이름}", 다음 줄이 "{이름} {소개}"
  let postId: string | null = null;
  const first = L.findIndex((x) => x.trim());
  const firstHead = heads[0] ?? L.length;
  if (first >= 0 && first < firstHead && L[first].trim().startsWith("멤버")) {
    const name = L[first].trim().slice(2);
    const nameLine = L[first + 1]?.trim() ?? "";
    if (nameLine.startsWith(name)) {
      postId = `p${++seq}`;
      const desc = nameLine.slice(name.length).trim();
      const author = idn(name, desc);
      mark(first, "ui", postId, "작성자 사진의 '멤버' 표기 + 이름");
      mark(first + 1, "meta", postId, "작성자·소개");
      let i = first + 2;
      let time = null;
      let readCount: number | undefined;
      const rm = L[i]?.trim().match(READ_LINE);
      if (rm && (DATE_LINE.test(rm[1]) || /\d{4}년/.test(rm[1]))) {
        time = parseKoreanDateTime(rm[1], "화면 표기(텍스트 복사)");
        readCount = Number(rm[2].replace(/,/g, ""));
        mark(i, "meta", postId, "작성 시각·읽음 수");
        i++;
      } else if (L[i] && DATE_LINE.test(L[i].trim())) {
        time = parseKoreanDateTime(L[i].trim(), "화면 표기(텍스트 복사)");
        mark(i, "meta", postId, "작성 시각");
        i++;
      }
      if (L[i]?.trim() === "글 옵션") mark(i++, "ui", postId, "글 메뉴 버튼");
      // 본문: "댓글N" 줄 전까지
      let end = i;
      while (end < firstHead && !COMMENT_COUNT.test(L[end].trim())) end++;
      const bodyLines = L.slice(i, end);
      for (let k = i; k < end; k++) mark(k, "content", postId);
      let commentCount: number | undefined;
      if (end < firstHead) {
        commentCount = Number(L[end].trim().match(COMMENT_COUNT)![1]);
        mark(end, "meta", postId, "댓글 수");
        for (let k = end + 1; k < firstHead; k++) {
          if (POST_UI.has(L[k].trim())) mark(k, "ui", postId, "게시글 아래 버튼");
        }
      }
      entries.push({
        tempId: postId,
        kind: "post",
        authorKey: author,
        blocks: textBlocks(bodyLines),
        time,
        parentTempId: null,
        sourcePath: `줄 ${first + 1}-${end}`,
        meta: { readCount, commentCount },
        reactions: { status: "unknown", total: null, kinds: [], reactors: "unknown", evidence: "텍스트 복사본에는 표정 수가 없음" },
      });
    }
  }
  if (!postId) {
    issues.push({ kind: "unclassified", message: "게시글 머리(작성자·시각)를 찾지 못했습니다. 댓글만 가져옵니다. 게시글 본문은 미분류 줄로 남습니다." });
  }

  // 댓글
  const byAuthorOrder: { tempId: string; name: string; isReplyGuess: boolean }[] = [];
  heads.forEach((h, hi) => {
    const segEnd = heads[hi + 1] ?? L.length;
    const id = `c${++seq}`;
    const name = L[h + 2].trim();
    mark(h, "ui", id, "작성자 사진의 '멤버' 표기 + 이름");
    mark(h + 2, "meta", id, "작성자 이름");
    const desc = L[h + 3]?.trim() ?? "";
    mark(h + 3, "meta", id, "작성자 소개");
    const author = idn(name, desc);

    // 꼬리: 빈 줄 + 날짜 + "표정짓기" 가 마지막으로 나오는 곳
    let foot = -1;
    for (let j = segEnd - 1; j >= h + 4; j--) {
      if (DATE_LINE.test(L[j].trim()) && !L[j - 1]?.trim() && L[j + 1]?.trim() === "표정짓기") {
        foot = j;
        break;
      }
    }
    const bodyEnd = foot >= 0 ? foot - 1 : segEnd;
    const bodyLines = L.slice(h + 4, bodyEnd);
    for (let k = h + 4; k < bodyEnd; k++) mark(k, "content", id);
    const blocks = textBlocks(bodyLines);
    let time = null;
    const extra: string[] = [];
    if (foot >= 0) {
      time = parseKoreanDateTime(L[foot].trim(), "화면 표기(텍스트 복사)");
      mark(foot, "meta", id, "작성 시각");
      for (let k = foot + 1; k < segEnd; k++) {
        const t = L[k].trim();
        if (!t) continue;
        if (FOOTER_UI.has(t)) mark(k, "ui", id, "댓글 아래 버튼");
        else {
          extra.push(L[k]);
          mark(k, "unclassified", id, "댓글 꼬리 영역의 알 수 없는 줄");
        }
      }
    } else {
      issues.push({ kind: "unclassified", message: `"${name}"의 댓글 끝(날짜 줄)을 찾지 못해 다음 댓글 전까지를 모두 본문으로 두었습니다.`, entryTempId: id });
    }
    if (extra.length) blocks.push({ type: "unclassified", text: extra.join("\n"), reason: "댓글 아래 알 수 없는 줄" });

    const firstText = bodyLines.join("\n").trim();
    const isReplyGuess = firstText.startsWith("@");
    let suggested: string | undefined;
    if (isReplyGuess) {
      const target = firstText.slice(1);
      // 멘션 대상: 앞서 나온 작성자 중 이름이 가장 길게 일치하는 사람
      const cands = byAuthorOrder.filter((c) => target.startsWith(c.name)).sort((a, b) => b.name.length - a.name.length);
      const who = cands[0]?.name;
      if (who) {
        const theirs = byAuthorOrder.filter((c) => c.name === who);
        const top = [...theirs].reverse().find((c) => !c.isReplyGuess);
        const lastReply = theirs[theirs.length - 1];
        suggested = top?.tempId ?? (lastReply ? entries.find((e) => e.tempId === lastReply.tempId)?.suggestedParentTempId : undefined);
      }
    }
    entries.push({
      tempId: id,
      kind: "comment",
      authorKey: author,
      blocks,
      time,
      parentTempId: postId,
      sourcePath: `줄 ${h + 1}-${segEnd}`,
      meta: {},
      parentUnknown: true,
      suggestedParentTempId: suggested,
      reactions: { status: "unknown", total: null, kinds: [], reactors: "unknown", evidence: "텍스트 복사본에는 표정 수가 없음" },
    });
    byAuthorOrder.push({ tempId: id, name, isReplyGuess });
  });

  const unclassifiedLines = info.filter((x) => x.cls === "unclassified");
  if (!entries.length) {
    notes.push("밴드 게시글·댓글 형식의 텍스트를 찾지 못했습니다.");
    return { document: null, lines: info, notes };
  }
  // 어떤 항목에도 속하지 않은 줄은 미분류 항목으로 보존
  const orphan = unclassifiedLines.filter((x) => !x.entryTempId);
  if (orphan.length) {
    const id = `u${++seq}`;
    entries.push({
      tempId: id,
      kind: "unclassified",
      authorKey: null,
      blocks: [{ type: "unclassified", text: orphan.map((x) => x.text).join("\n"), reason: "어느 게시글·댓글에도 속하지 않은 줄" }],
      time: null,
      parentTempId: postId,
      sourcePath: `줄 ${orphan.map((x) => x.n).join(",")}`,
      meta: {},
    });
    for (const x of orphan) info[x.n - 1] = { ...x, entryTempId: id };
    issues.push({ kind: "unclassified", message: `어디에도 속하지 않은 줄 ${orphan.length}개를 미분류 항목으로 보존했습니다.`, entryTempId: id });
  }

  const comments = entries.filter((e) => e.kind === "comment");
  const suggestedCount = comments.filter((e) => e.suggestedParentTempId).length;
  issues.push({
    kind: "unknown-parent",
    message: `텍스트 복사본에는 답글 구조가 없어 댓글 ${comments.length}개를 모두 부모 미확정으로 두었습니다. '@이름'으로 시작하는 ${suggestedCount}개에는 연결 제안이 있습니다(확정 아님). 저장한 페이지(HTML)로 가져오면 정확합니다.`,
  });
  const post = entries.find((e) => e.kind === "post");
  if (post?.meta.commentCount !== undefined && post.meta.commentCount !== comments.length)
    issues.push({ kind: "comment-count-mismatch", message: `표시된 댓글 수는 ${post.meta.commentCount}개인데 텍스트에서 ${comments.length}개를 찾았습니다.` });

  const postText = post ? post.blocks.map((b) => (b.type === "text" ? b.text : "")).join("").split("\n")[0].slice(0, 40) : "";
  const authorName = post?.authorKey?.split("\u0000")[0];
  return {
    document: {
      format: "band-post",
      title: postText ? `${authorName ? authorName + " · " : ""}${postText}` : "밴드 게시글(텍스트)",
      identities: Array.from(identities.values()),
      entries,
      issues,
      evidence: [
        `텍스트 복사본: 게시글 ${post ? 1 : 0}, 댓글 머리 ${heads.length}개 ('멤버이름' / 빈 줄 / '이름' 패턴)`,
        "답글 관계·정확한 시각·프로필 사진·표정 수는 텍스트에 없습니다.",
        `줄 분류: 내용 ${info.filter((x) => x.cls === "content").length} · 메타 ${info.filter((x) => x.cls === "meta").length} · UI ${info.filter((x) => x.cls === "ui").length} · 빈 줄 ${info.filter((x) => x.cls === "blank").length} · 미분류 ${info.filter((x) => x.cls === "unclassified").length}`,
      ],
      confidence: "review",
    },
    lines: info,
    notes,
  };
}
