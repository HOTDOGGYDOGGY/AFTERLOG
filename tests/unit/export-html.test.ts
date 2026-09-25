import { describe, expect, it } from "vitest";
import * as C from "../../src/editor/commands";
import { renderDocumentHtml, usedAssetIds } from "../../src/exporters/html";
import { planPages } from "../../src/exporters/png";
import { syntheticDoc } from "./helpers";

const assetMap = new Map([
  ["avatar_garam.png", "asset-garam"],
  ["avatar_narae.png", "asset-narae"],
  ["post_photo_2.png", "asset-photo"],
]);
const doc = syntheticDoc(assetMap);
const urls = new Map([...assetMap.values()].map((id) => [id, `data:image/png;base64,${id}`]));

describe("HTML 내보내기", () => {
  const html = renderDocumentHtml(doc, urls);

  it("F18 원문의 HTML은 실행되지 않는 텍스트로 들어간다", () => {
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.match(/<script/gi)).toBeNull();
  });

  it("F17 외부 요청이 필요한 참조가 없다", () => {
    expect(html).not.toMatch(/(src|href)=["']https?:/i);
    expect(html).not.toMatch(/@import|url\(["']?https?:/i);
  });

  it("긴 댓글 전문·답글·이미지·미확보 자리를 모두 담는다", () => {
    expect(html).toContain("들여쓴 줄");
    expect(html).toContain("(두 번째 답글)");
    expect(html).toContain("data:image/png;base64,asset-photo");
    expect(html).toContain("이미지 미확보");
    expect(html).not.toContain("contenteditable");
  });

  it("F20 숨긴 인물의 본문은 파일 소스에도 없다", () => {
    const quote = Object.values(doc.identities).find((i) => i.originalName.startsWith("다온"))!;
    const hidden = C.updateIdentity(doc, quote.id, { hidden: true });
    const out = renderDocumentHtml(hidden, urls);
    expect(out).not.toContain("첫 문단");
    expect(out).not.toContain("다온 &quot;따옴표&quot;");
    // 숨긴 댓글에 달린 답글은 맥락 자리표시와 함께 남는다
    expect(out).toContain("숨긴 인물의 댓글");
    expect(out).toContain("(두 번째 답글)");
  });

  it("숨긴 인물의 프로필 이미지는 사용 자산에서 빠진다", () => {
    const garam = Object.values(doc.identities).find((i) => i.originalName === "가람")!;
    const hidden = C.updateIdentity(doc, garam.id, { hidden: true });
    expect(usedAssetIds(hidden).has("asset-garam")).toBe(false);
    expect(usedAssetIds(doc).has("asset-garam")).toBe(true);
  });
});

describe("PNG 분할 계획", () => {
  it("짧으면 한 장", () => {
    expect(planPages(800, 3000, [100, 400], [])).toEqual([{ start: 0, end: 800, forced: false }]);
  });
  it("항목 경계를 우선해 나눈다", () => {
    const p = planPages(7000, 3000, [1000, 2500, 2900, 4000, 5800, 6500], [3000]);
    expect(p.map((x) => [x.start, x.end])).toEqual([
      [0, 2900],
      [2900, 5800],
      [5800, 7000],
    ]);
    expect(p.every((x) => x.end - x.start <= 3000)).toBe(true);
  });
  it("항목 하나가 너무 길면 줄 경계에서 나눈다", () => {
    const lines = Array.from({ length: 300 }, (_, i) => (i + 1) * 22);
    const p = planPages(6600, 3000, [], lines);
    expect(p.every((x) => !x.forced)).toBe(true);
    for (const x of p.slice(0, -1)) expect(lines).toContain(x.end);
    expect(p[p.length - 1].end).toBe(6600);
  });
  it("경계가 전혀 없으면 강제로 자르고 표시한다", () => {
    const p = planPages(5000, 2000, [], []);
    expect(p.filter((x) => x.forced)).toHaveLength(2);
    expect(p.map((x) => x.end)).toEqual([2000, 4000, 5000]);
  });
});
