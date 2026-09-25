import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as C from "../../src/editor/commands";
import { buildDocument } from "../../src/importers/band/build";
import { blocksToPlainText } from "../../src/importers/band/html";
import { parseBandText } from "../../src/importers/band/text";
import { validateDocument, findParent } from "../../src/domain/validate";
import { FIXTURE_DIR } from "./helpers";

const raw = readFileSync(FIXTURE_DIR + "post-synthetic-plain.txt", "utf8");
const r = parseBandText(raw);
const d = r.document!;
const t = (i: number) => blocksToPlainText(d.entries[i].blocks);

describe("밴드 텍스트 복사 파서(대체 경로)", () => {
  it("게시글 머리·본문·댓글 수·읽음 수", () => {
    expect(d.entries[0].kind).toBe("post");
    expect(t(0)).toBe("첫 줄 대사.\n\n* 고개를 돌린다\n123");
    expect(d.entries[0].meta).toEqual({ readCount: 7, commentCount: 3 });
    expect(d.entries[0].time?.local).toBe("2026-03-01T23:50");
    expect(d.identities.find((i) => i.name === "가람")?.description).toBe("A / 20 / 학생");
  });

  it("F01·F02 숫자 대사, 댓글 안 빈 줄 유지", () => {
    expect(t(1)).toBe("0");
    expect(blocksToPlainText(d.entries[2].blocks.filter((b) => b.type === "text"))).toBe("@나래 본명 좋아요\n둘째 줄\n\n셋째 줄(빈 줄 뒤)");
  });

  it("F10 모든 줄에 분류가 붙고, 알 수 없는 줄은 미분류 블록으로 보존", () => {
    expect(r.lines).toHaveLength(raw.replace(/\r\n/g, "\n").split("\n").length);
    const unc = r.lines.filter((l) => l.cls === "unclassified");
    expect(unc.map((l) => l.text)).toEqual(["알수없는줄"]);
    expect(d.entries[2].blocks.some((b) => b.type === "unclassified" && b.text === "알수없는줄")).toBe(true);
  });

  it("F06 연도 없는 날짜·상대 시간은 해석하지 않는다", () => {
    expect(d.entries[2].time).toMatchObject({ raw: "3월 2일 오전 12:10", local: null });
    expect(d.entries[3].time).toMatchObject({ raw: "3시간 전", local: null });
    expect(d.entries[1].time?.local).toBe("2026-03-01");
  });

  it("답글 구조가 없으므로 모두 부모 미확정, 멘션에는 제안만", () => {
    const comments = d.entries.filter((e) => e.kind === "comment");
    expect(comments.every((e) => e.parentUnknown && e.parentTempId === d.entries[0].tempId)).toBe(true);
    expect(comments[1].suggestedParentTempId).toBe(comments[0].tempId); // @나래 → 나래의 댓글
    expect(comments[0].suggestedParentTempId).toBeUndefined();
    expect(d.issues.some((i) => i.kind === "unknown-parent")).toBe(true);
    expect(d.entries[0].reactions?.status).toBe("unknown");
  });

  it("제안 적용은 사용자가 할 때만, 한 번에 되돌릴 수 있다", () => {
    const doc = buildDocument(d, { projectId: "p", sourceId: "s", parserVersion: "t", assetMap: new Map() });
    const ids = doc.children[doc.children.root[0]];
    const applied = C.applyAllParentSuggestions(doc);
    expect(validateDocument(applied)).toEqual([]);
    expect(findParent(applied, ids[1])).toBe(ids[0]);
    expect(applied.entries[ids[1]].parentUnknown).toBe(false);
    expect(findParent(doc, ids[1])).toBe(doc.children.root[0]);
  });

  it("밴드 텍스트가 아니면 문서를 만들지 않는다", () => {
    expect(parseBandText("그냥 메모\n두 줄").document).toBeNull();
  });
});
