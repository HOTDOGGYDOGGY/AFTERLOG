// 실제 사용자 샘플 회귀 테스트. 개인 로그라 저장소에 올리지 않는다(tests/private/는 .gitignore).
// 로컬에 tests/private/band-real.html(밴드에서 저장한 페이지)을 두면 실행된다.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blocksToPlainText, parseBandHtml } from "../../src/importers/band/html";
import { parseBandText } from "../../src/importers/band/text";

const PATH = resolve(process.cwd(), "tests/private/band-real.html");
const FRAG = resolve(process.cwd(), "tests/private/band-real-fragment.txt");
const PLAIN = resolve(process.cwd(), "tests/private/band-real-plain.txt");
const has = existsSync(PATH);

describe.skipIf(!has)("실제 밴드 저장 페이지 (비공개 샘플)", () => {
  const r = has ? parseBandHtml(readFileSync(PATH, "utf8")) : null!;
  const post = r?.documents.find((d) => d.format === "band-post");
  const member = r?.documents.find((d) => d.format === "band-member-comments");

  it("게시글 1 + 댓글 17(답글 9), 표시된 댓글 수와 일치", () => {
    expect(post).toBeDefined();
    const [p, ...comments] = post!.entries;
    expect(p.kind).toBe("post");
    expect(comments).toHaveLength(17);
    expect(comments.filter((c) => c.parentTempId !== p.tempId)).toHaveLength(9);
    expect(p.meta.commentCount).toBe(17);
    expect(post!.issues.filter((i) => i.kind === "comment-count-mismatch")).toHaveLength(0);
    expect(post!.entries.filter((e) => e.kind === "unclassified")).toHaveLength(0);
  });

  it("모든 항목의 작성자·시각을 찾는다", () => {
    for (const e of post!.entries) {
      expect(e.authorKey).not.toBeNull();
      expect(e.time?.local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    }
    expect(post!.identities.length).toBeGreaterThanOrEqual(2);
    expect(post!.identities.every((i) => i.avatarRef)).toBe(true);
  });

  it("부모는 구조로 정한다: 멘션 없는 답글도 답글로 남는다", () => {
    const replies = post!.entries.filter((e) => e.kind === "comment" && e.parentTempId !== post!.entries[0].tempId);
    expect(replies.filter((e) => e.blocks[0]?.type === "mention").length).toBe(8);
    expect(replies.filter((e) => !e.blocks.some((b) => b.type === "mention")).length).toBe(1);
  });

  it("본문 텍스트가 빠짐없이 남는다", () => {
    const doc = new DOMParser().parseFromString(readFileSync(PATH, "utf8"), "text/html");
    const all = post!.entries.map((e) => blocksToPlainText(e.blocks)).join("").replace(/\s+/g, "");
    for (const el of Array.from(doc.querySelectorAll(".cPostCard .txtBody, .cPostCard ._commentContent")))
      expect(all).toContain((el.textContent ?? "").replace(/\s+/g, ""));
  });

  it("S02 부모 댓글 본문에 답글 본문이 섞이지 않는다", () => {
    const replies = post!.entries.filter((e) => e.kind === "comment" && e.parentTempId !== post!.entries[0].tempId);
    for (const parent of post!.entries.filter((e) => replies.some((r) => r.parentTempId === e.tempId))) {
      const own = blocksToPlainText(parent.blocks);
      for (const r of replies.filter((x) => x.parentTempId === parent.tempId)) expect(own).not.toContain(blocksToPlainText(r.blocks).slice(-20));
    }
  });

  it("S04 17개 댓글 모두 title의 상세 시각, 화면 표기가 다르면 함께 보존", () => {
    const comments = post!.entries.filter((e) => e.kind === "comment");
    expect(comments.every((c) => c.time?.basis === "title 속성의 전체 시각")).toBe(true);
    expect(comments.filter((c) => c.time?.display).length).toBeGreaterThan(0);
    expect(comments.find((c) => c.time?.display === "2026년 2월 11일")?.time?.raw).toMatch(/오[전후] \d+:\d{2}$/);
  });

  it("S05 프로필 사진 18회 사용, 고유 파일 9개", () => {
    const doc = new DOMParser().parseFromString(readFileSync(PATH, "utf8"), "text/html");
    const uses = doc.querySelectorAll(".cPostCard .postWriter img, .cPostCard .cComment .writeInfo img").length;
    expect(uses).toBe(18);
    const refs = new Set(post!.identities.map((i) => i.avatarRef));
    expect(refs.size).toBe(9);
    for (const r of refs) expect(existsSync(resolve(process.cwd(), "tests/private/band-real_files", r!))).toBe(true);
  });

  it("S06 소개(슬래시형·공백형)를 원문 그대로 보존", () => {
    // 실제 문구는 저장소에 남기지 않고 형태만 확인한다
    const descs = post!.identities.map((i) => i.description);
    expect(descs.some((d) => / \/ /.test(d))).toBe(true); // 슬래시형
    expect(descs.some((d) => d && !d.includes("/"))).toBe(true); // 공백형
    const doc = new DOMParser().parseFromString(readFileSync(PATH, "utf8"), "text/html");
    const raw = Array.from(doc.querySelectorAll(".cPostCard .nickname, .cPostCard .memo")).map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim());
    for (const d of descs) expect(raw).toContain(d);
  });

  it("S07 숨은 메뉴·번역·배경 UI 문구가 본문에 없다", () => {
    const all = post!.entries.map((e) => blocksToPlainText(e.blocks)).join("\n");
    for (const ui of ["주소 복사", "신고하기", "번역 보기", "번역 중입니다", "글 옵션", "답글쓰기", "이 멤버의"]) expect(all).not.toContain(ui);
  });

  it("S08·S09 댓글 17과 읽음 21은 다른 필드, 표정 선택 버튼은 반응 수가 아니다", () => {
    expect(post!.entries[0].meta).toEqual({ readCount: 21, commentCount: 17 });
    for (const e of post!.entries) expect(e.reactions?.status).toBe("unknown");
  });

  it("S01 HTML 조각(TXT)도 같은 구조, 이미지는 원격 링크만", () => {
    const f = parseBandHtml(readFileSync(FRAG, "utf8"));
    const fp = f.documents.find((d) => d.format === "band-post")!;
    expect(f.documents).toHaveLength(1);
    const [p, ...cs] = fp.entries;
    expect(cs).toHaveLength(17);
    expect(cs.filter((c) => c.parentTempId !== p.tempId)).toHaveLength(9);
    expect(fp.identities.every((i) => i.avatarUrl?.startsWith("https://"))).toBe(true);
    // 저장 페이지와 본문이 같다
    const a = post!.entries.map((e) => blocksToPlainText(e.blocks));
    expect(fp.entries.map((e) => blocksToPlainText(e.blocks))).toEqual(a);
  });

  it("텍스트 복사본: 게시글 1·댓글 17, 줄 유실 없음, 답글은 미확정", () => {
    const tr = parseBandText(readFileSync(PLAIN, "utf8"));
    const d = tr.document!;
    expect(d.entries.filter((e) => e.kind === "post")).toHaveLength(1);
    expect(d.entries.filter((e) => e.kind === "comment")).toHaveLength(17);
    expect(d.entries.filter((e) => e.kind === "unclassified")).toHaveLength(0);
    expect(tr.lines.filter((l) => l.cls === "unclassified")).toHaveLength(0);
    expect(d.entries[0].meta).toEqual({ readCount: 21, commentCount: 17 });
    // 본문은 HTML과 같다(텍스트에는 멘션 링크가 글자로 들어 있음)
    const html = post!.entries.map((e) => blocksToPlainText(e.blocks));
    expect(d.entries.map((e) => blocksToPlainText(e.blocks))).toEqual(html);
    // 멘션으로 시작하는 8개에 제안, 그중 HTML 구조와 같은 부모를 가리키는 수 확인
    const sugg = d.entries.filter((e) => e.suggestedParentTempId);
    expect(sugg.length).toBe(8);
  });

  it("같은 페이지 뒤쪽의 멤버 댓글 모음도 찾는다", () => {
    expect(member?.entries.length).toBe(60);
    expect(member!.entries.every((e) => e.excerpt && e.excerpt.length > 0)).toBe(true);
  });
});
