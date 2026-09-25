import { describe, expect, it } from "vitest";
import { blocksToPlainText, parseBandHtml } from "../../src/importers/band/html";
import { parseKoreanDateTime } from "../../src/importers/band/time";
import { syntheticHtml } from "./helpers";

const parsed = parseBandHtml(syntheticHtml());
const post = parsed.documents.find((d) => d.format === "band-post")!;
const member = parsed.documents.find((d) => d.format === "band-member-comments")!;
const text = (i: number) => blocksToPlainText(post.entries[i].blocks);
const byText = (needle: string) => post.entries.find((e) => blocksToPlainText(e.blocks).includes(needle))!;
const nameOf = (key: string | null) => (key ? key.split("\u0000")[0] : null);

describe("밴드 HTML 파서 · 글과 댓글", () => {
  it("게시글과 댓글 모음 두 문서를 찾는다", () => {
    expect(parsed.bandName).toBe("[합성] 테스트 밴드");
    expect(parsed.documents.map((d) => d.format).sort()).toEqual(["band-member-comments", "band-post"]);
  });

  it("F01 숫자만 있는 대사·별표 지문·UI 같은 단어를 버리지 않는다", () => {
    expect(text(0)).toBe("첫 줄 대사.\n\n* 고개를 돌린다\n123\n댓글\n좋아요[이미지][이미지]");
    expect(blocksToPlainText(byText("0").blocks)).toBe("0");
  });

  it("F02 여러 줄·빈 줄·들여쓰기 유지", () => {
    expect(blocksToPlainText(byText("첫 문단").blocks)).toBe("첫 문단\n\n둘째 문단 <script>alert(1)</script> </script>\n   들여쓴 줄");
  });

  it("F03 따옴표·괄호·이모지 이름", () => {
    expect(post.identities.map((i) => i.name)).toContain('다온 "따옴표" (별명) 😀');
  });

  it("F04 같은 이름·다른 프로필은 자동 병합하지 않고 검토 요청", () => {
    const narae = post.identities.filter((i) => i.name === "나래");
    expect(narae).toHaveLength(2);
    expect(post.issues.some((i) => i.message.includes('"나래"'))).toBe(true);
  });

  it("F05 멘션과 부모 관계를 분리한다", () => {
    const postId = post.entries[0].tempId;
    const mentionOnlyTop = byText("멘션만 있는 최상위 댓글");
    expect(mentionOnlyTop.parentTempId).toBe(postId);
    expect(mentionOnlyTop.blocks[0]).toEqual({ type: "mention", name: "다온" });
    const reply = post.entries.find((e) => e.blocks.some((b) => b.type === "mention" && b.name === "나래 본명"))!;
    const parent = post.entries.find((e) => e.tempId === reply.parentTempId)!;
    expect(blocksToPlainText(parent.blocks)).toBe("0");
    const mid = byText("안녕");
    expect(mid.blocks.map((b) => b.type)).toEqual(["text", "mention", "text"]);
    expect(nameOf(post.entries.find((e) => e.tempId === mid.parentTempId)!.authorKey)).toBe('다온 "따옴표" (별명) 😀');
  });

  it("답글이 두 개인 댓글의 답글 순서를 유지한다", () => {
    const parent = byText("첫 문단");
    const kids = post.entries.filter((e) => e.parentTempId === parent.tempId).map((e) => blocksToPlainText(e.blocks));
    expect(kids).toEqual(["안녕 @다온 반가워", "(두 번째 답글)"]);
  });

  it("F06 날짜처럼 생긴 본문은 자르지 않고, 상대 시간·연도 없는 날짜는 해석하지 않는다", () => {
    expect(blocksToPlainText(byText("멘션만 있는").blocks)).toContain("2026년 3월 1일 오후 2:00에 만나");
    expect(byText("두 번째 답글").time).toEqual({ raw: "3시간 전", local: null, basis: "화면 표기" });
    expect(parseKoreanDateTime("2월 11일 오후 3:00").local).toBeNull();
    expect(parseKoreanDateTime("2026년 2월 11일 오후 12:14").local).toBe("2026-02-11T12:14");
    expect(parseKoreanDateTime("2026년 2월 11일 오전 12:49").local).toBe("2026-02-11T00:49");
  });

  it("title 속성의 전체 시각을 우선한다", () => {
    expect(byText("0").time?.local).toBe("2026-03-01T23:52");
    expect(post.entries[0].time?.local).toBe("2026-03-01T23:50");
  });

  it("S07 숨은 메뉴·번역 문구가 본문에 섞이지 않는다", () => {
    const all = post.entries.map((e) => blocksToPlainText(e.blocks)).join("\n");
    for (const ui of ["주소 복사", "신고하기", "번역 보기", "글 옵션", "답글쓰기"]) expect(all).not.toContain(ui);
  });

  it("20.2 배경의 멤버 댓글 목록은 '검토 필요'로 표시", () => {
    expect(member.confidence).toBe("review");
    expect(member.evidence.join(" ")).toContain("전체 댓글 목록이라고 확인되지 않았습니다");
  });

  it("F08 해석 못 한 댓글은 미분류로 원문 보존", () => {
    const u = post.entries.find((e) => e.kind === "unclassified")!;
    expect(u.blocks[0]).toMatchObject({ type: "unclassified" });
    expect(blocksToPlainText(u.blocks)).toContain("해석할 수 없는 댓글 구조 굵게");
    expect(post.issues.some((i) => i.kind === "unclassified")).toBe(true);
  });

  it("S09 표정 레이어 버튼 값은 확정 반응 수로 쓰지 않는다", () => {
    expect(post.entries[0].reactions).toMatchObject({ status: "unknown", total: null, reactors: "unknown" });
    expect(post.entries[0].reactions!.evidence).toContain("확정값으로 쓰지 않음");
    for (const e of post.entries.filter((x) => x.kind === "comment")) expect(e.reactions?.status).toBe("unknown");
  });

  it("S04 화면 표기와 title의 전체 시각을 함께 보존", () => {
    const t = byText("0").time!;
    expect(t.raw).toBe("2026년 3월 1일 오후 11:52");
    expect(t.display).toBe("2026년 3월 1일");
  });

  it("표시된 댓글 수와 실제 항목 수가 다르면 따로 기록한다", () => {
    expect(post.entries[0].meta).toEqual({ readCount: 7, commentCount: 10 });
    expect(post.issues.find((i) => i.kind === "comment-count-mismatch")?.message).toContain("10개");
  });

  it("게시글 이미지 자리를 순서대로 보존하고 미검증 구조로 표시", () => {
    const imgs = post.entries[0].blocks.filter((b) => b.type === "image");
    expect(imgs.map((b) => b.type === "image" && b.sourceRef)).toEqual(["post_photo_1.jpg", "post_photo_2.png"]);
    expect(post.issues.some((i) => i.kind === "unverified-structure" && i.message.includes("게시글 이미지"))).toBe(true);
  });

  it("F10 본문 요소의 텍스트가 모두 어딘가에 남는다", () => {
    const doc = new DOMParser().parseFromString(syntheticHtml(), "text/html");
    const all = post.entries.map((e) => blocksToPlainText(e.blocks)).join("\n").replace(/\s+/g, "");
    for (const el of Array.from(doc.querySelectorAll(".cPostCard .txtBody, .cPostCard ._commentContent, .cPostCard .cComment > .unknownLayout"))) {
      expect(all).toContain((el.textContent ?? "").replace(/\s+/g, ""));
    }
  });

  it("같은 입력이면 같은 결과", () => {
    expect(parseBandHtml(syntheticHtml())).toEqual(parsed);
  });
});

describe("밴드 HTML 파서 · 댓글 모음", () => {
  it("F11 여러 줄 댓글 전문과 원글 발췌를 분리", () => {
    expect(member.entries).toHaveLength(2);
    expect(blocksToPlainText(member.entries[0].blocks)).toBe("@나래 여러 줄\n댓글입니다");
    expect(blocksToPlainText(member.entries[0].excerpt!)).toBe("원글의 앞부분 발췌…");
    expect(nameOf(member.entries[0].authorKey)).toBe("가람");
    expect(blocksToPlainText(member.entries[1].blocks)).toBe("42");
    expect(member.entries[1].time?.local).toBeNull();
    expect(member.issues.some((i) => i.kind === "unknown-parent")).toBe(true);
  });
});

describe("페이지가 아닌 입력", () => {
  it("문서를 못 찾으면 설명을 남긴다", () => {
    const r = parseBandHtml("<html><body><p>hello</p></body></html>");
    expect(r.documents).toHaveLength(0);
    expect(r.notes[0]).toContain("찾지 못했습니다");
  });
});
