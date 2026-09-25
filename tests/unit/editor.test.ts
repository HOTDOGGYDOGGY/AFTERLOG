import { describe, expect, it } from "vitest";
import * as C from "../../src/editor/commands";
import { commit, initHistory, redo, undo } from "../../src/editor/history";
import { ROOT } from "../../src/domain/types";
import { findParent, validateDocument } from "../../src/domain/validate";
import { blocksToPlainText } from "../../src/importers/band/html";
import { syntheticDoc } from "./helpers";

const doc0 = syntheticDoc();
const postId = doc0.children[ROOT][0];
const find = (d = doc0, needle: string) => Object.values(d.entries).find((e) => blocksToPlainText(e.blocks).includes(needle))!.id;
const idFirst = find(doc0, "첫 문단"); // 답글 2개 가진 댓글
const kidsOf = (d: typeof doc0, id: string) => d.children[id] ?? [];

describe("편집 명령", () => {
  it("가져온 문서는 관계가 올바르다", () => {
    expect(validateDocument(doc0)).toEqual([]);
    expect(kidsOf(doc0, idFirst)).toHaveLength(2);
  });

  it("F09 부모 삭제: 답글 함께 삭제 / 위로 올리기", () => {
    const a = C.deleteEntry(doc0, idFirst, "with-children");
    expect(validateDocument(a)).toEqual([]);
    expect(Object.keys(a.entries)).toHaveLength(Object.keys(doc0.entries).length - 3);
    const b = C.deleteEntry(doc0, idFirst, "promote-children");
    expect(validateDocument(b)).toEqual([]);
    const idx = doc0.children[postId].indexOf(idFirst);
    expect(b.children[postId].slice(idx, idx + 2)).toEqual(kidsOf(doc0, idFirst));
  });

  it("F09 이동 후 실행취소하면 원래 순서로 돌아온다", () => {
    let h = initHistory(doc0);
    const target = doc0.children[postId][0];
    h = commit(h, C.moveEntry(h.doc, idFirst, postId, 0));
    expect(h.doc.children[postId][0]).toBe(idFirst);
    h = commit(h, C.setParent(h.doc, idFirst, target));
    expect(findParent(h.doc, idFirst)).toBe(target);
    expect(kidsOf(h.doc, idFirst)).toHaveLength(2); // 답글은 따라간다
    expect(validateDocument(h.doc)).toEqual([]);
    h = undo(undo(h));
    expect(h.doc).toBe(doc0);
    h = redo(h);
    expect(h.doc.children[postId][0]).toBe(idFirst);
  });

  it("자기 자손 아래로는 옮기지 않는다(순환 방지)", () => {
    const child = kidsOf(doc0, idFirst)[0];
    expect(C.moveEntry(doc0, idFirst, child, 0)).toBe(doc0);
  });

  it("나누기·합치기", () => {
    const blockIdx = doc0.entries[idFirst].blocks.findIndex((b) => b.type === "text");
    const split = C.splitEntry(doc0, idFirst, blockIdx, 4);
    expect(validateDocument(split)).toEqual([]);
    const siblings = split.children[postId];
    const newId = siblings[siblings.indexOf(idFirst) + 1];
    expect(blocksToPlainText(split.entries[idFirst].blocks)).toBe("첫 문단");
    expect(blocksToPlainText(split.entries[newId].blocks).startsWith("둘째 문단")).toBe(true);
    const merged = C.mergeWithNext(split, idFirst);
    expect(validateDocument(merged)).toEqual([]);
    expect(blocksToPlainText(merged.entries[idFirst].blocks)).toContain("둘째 문단");
  });

  it("복제는 새 ID를 받고 자식은 복제하지 않는다", () => {
    const d = C.duplicateEntry(doc0, idFirst);
    const list = d.children[postId];
    const copy = list[list.indexOf(idFirst) + 1];
    expect(copy).not.toBe(idFirst);
    expect(kidsOf(d, copy)).toHaveLength(0);
    expect(validateDocument(d)).toEqual([]);
  });

  it("F04 인물 분리 후에도 ID·대사 연결 유지, 합치기로 되돌림", () => {
    const e = doc0.entries[idFirst];
    const d = C.splitIdentity(doc0, [idFirst]);
    const newAuthor = d.entries[idFirst].authorId!;
    expect(newAuthor).not.toBe(e.authorId);
    expect(d.identities[newAuthor].originalName).toBe(doc0.identities[e.authorId!].originalName);
    const back = C.mergeIdentities(d, newAuthor, e.authorId!);
    expect(back.entries[idFirst].authorId).toBe(e.authorId);
    expect(back.identities[newAuthor]).toBeUndefined();
  });

  it("표시 이름을 바꿔도 인물 ID와 원래 이름은 그대로", () => {
    const id = doc0.identityOrder[0];
    const d = C.updateIdentity(doc0, id, { displayName: "새 이름" });
    expect(d.identities[id].originalName).toBe(doc0.identities[id].originalName);
    expect(d.identities[id].displayName).toBe("새 이름");
  });

  it("원본 복원", () => {
    const i = doc0.entries[idFirst].blocks.findIndex((b) => b.type === "text");
    const d = C.restoreOriginal(C.editTextBlock(doc0, idFirst, i, "바꿈"), idFirst);
    expect(d.entries[idFirst].blocks).toEqual(doc0.entries[idFirst].originalBlocks);
  });

  it("연속 타이핑은 한 단계로 묶인다", () => {
    let h = initHistory(doc0);
    const i = doc0.entries[idFirst].blocks.findIndex((b) => b.type === "text");
    h = commit(h, C.editTextBlock(h.doc, idFirst, i, "a"), "k", 1000);
    h = commit(h, C.editTextBlock(h.doc, idFirst, i, "ab"), "k", 1500);
    h = commit(h, C.editTextBlock(h.doc, idFirst, i, "abc"), "k", 2000);
    expect(h.past).toHaveLength(1);
    h = commit(h, C.editTextBlock(h.doc, idFirst, i, "abcd"), "k", 9000);
    expect(h.past).toHaveLength(2);
  });

  it("실행취소 기록 100단계 이상 유지", () => {
    let h = initHistory(doc0);
    for (let n = 0; n < 120; n++) h = commit(h, C.setTitle(h.doc, `t${n}`));
    expect(h.past.length).toBe(100);
  });
});
