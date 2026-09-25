// 꾸미기 모델(명세 v1.2 17절): 스타일 값이 화면·HTML 출력에 같게 반영되고, 모양만 바뀌며 데이터는 그대로인지.
import { describe, expect, it } from "vitest";
import * as C from "../../src/editor/commands";
import { renderDocumentHtml } from "../../src/exporters/html";
import { normalizeDocument } from "../../src/domain/migrate";
import { defaultDocStyle } from "../../src/domain/style";
import { bandRootClass, bandRootStyle, docStyle, resolveDocTheme, styleFromLegacy } from "../../src/renderers/band/style";
import type { DocumentData, ViewSettings } from "../../src/domain/types";
import { syntheticDoc } from "./helpers";

const assetMap = new Map([
  ["avatar_garam.png", "asset-garam"],
  ["avatar_narae.png", "asset-narae"],
]);
const urls = new Map([...assetMap.values()].map((id) => [id, `data:image/png;base64,${id}`]));

function styled(fn: (v: ViewSettings) => void): DocumentData {
  return C.updateView(syntheticDoc(assetMap), (v) => {
    if (!v.style) v.style = defaultDocStyle();
    v.skinFamily = "custom";
    fn(v as ViewSettings);
  });
}

/** 스타일과 무관한 데이터만 뽑는다 */
function dataOf(d: DocumentData) {
  return JSON.stringify({ entries: d.entries, children: d.children, identities: Object.values(d.identities).map((i) => ({ ...i, style: undefined })) });
}

describe("스타일 해석", () => {
  it("새 문서는 밴드 원형·앱 테마 따름·600px", () => {
    const d = syntheticDoc();
    expect(docStyle(d.view).commentSkin).toBe("band");
    expect(docStyle(d.view).documentTheme).toBe("app");
    expect(d.view.width).toBe(600);
    expect(resolveDocTheme(d.view, "dark")).toBe("dark");
    expect(resolveDocTheme(d.view, "light")).toBe("light");
  });

  it("U11 인장 모양이 HTML 출력에 명시적인 클래스·반경으로 남는다", () => {
    const d = styled((v) => {
      v.style!.avatar.shape = "rounded";
      v.style!.avatar.radius = 12;
    });
    const html = renderDocumentHtml(d, urls, "light");
    expect(html).toContain("al-avatar is-rounded");
    expect(html).not.toContain("al-avatar is-circle");
    expect(html).toContain("--al-av-rounded:12px");
    const sq = renderDocumentHtml(styled((v) => void (v.style!.avatar.shape = "square")), urls, "light");
    expect(sq).toContain("al-avatar is-square");
  });

  it("인물별 인장 모양·자르기는 그 인물에만, 원본 자산은 그대로", () => {
    const base = syntheticDoc(assetMap);
    const garam = Object.values(base.identities).find((i) => i.originalName === "가람")!;
    const d = C.updateIdentity(base, garam.id, { style: { avatarShape: "square", avatarCrop: { zoom: 1.5, x: 10, y: -5 } } });
    const html = renderDocumentHtml(d, urls, "light");
    expect(html).toContain("scale(1.5) translate(10%, -5%)");
    expect(html).toContain("al-avatar is-square");
    expect(html).toContain("al-avatar is-circle");
    expect(d.identities[garam.id].avatarAssetId).toBe(base.identities[garam.id].avatarAssetId);
  });

  it("U13 댓글 스킨을 바꿔도 본문·순서·부모·반응 값이 같다", () => {
    const before = syntheticDoc(assetMap);
    for (const skin of ["linear", "bubble", "card", "reading", "band"] as const) {
      const after = C.updateView(before, (v) => {
        v.style = { ...docStyle(v as ViewSettings), commentSkin: skin };
        v.skinFamily = "custom";
      });
      expect(dataOf(after)).toBe(dataOf(before));
      expect(renderDocumentHtml(after, urls, "light")).toContain(`al-skin-${skin}`);
    }
  });

  it("역할별 글자 크기·줄간격·글꼴이 CSS 변수로 출력에 들어간다", () => {
    const d = styled((v) => {
      v.style!.typography.body = { size: 18, lineHeight: 2, font: "serif" };
      v.style!.typography.name.size = 16;
    });
    const st = bandRootStyle(d.view) as Record<string, string>;
    expect(st["--al-size-body"]).toBe("18px");
    expect(st["--al-lh-body"]).toBe(2);
    expect(String(st["--al-font-body"])).toContain("Myeongjo");
    const html = renderDocumentHtml(d, urls, "light");
    expect(html).toContain("--al-size-body:18px");
    expect(html).toContain("--al-size-name:16px");
  });

  it("U10 기록 테마는 앱 테마와 따로: '앱 따름'은 내보낼 때 값으로 확정, 명시 값은 그대로", () => {
    const follow = syntheticDoc(assetMap);
    expect(renderDocumentHtml(follow, urls, "dark")).toContain("al-theme-dark");
    expect(renderDocumentHtml(follow, urls, "light")).toContain("al-theme-light");
    const light = styled((v) => void (v.style!.documentTheme = "light"));
    expect(renderDocumentHtml(light, urls, "dark")).toContain("al-theme-light");
    // 바깥 배경은 기록 설정 색(앱 바탕색이 아님)
    const bg = styled((v) => void (v.style!.colors.background = "#123456"));
    expect(renderDocumentHtml(bg, urls, "dark")).toContain("background:#123456");
  });

  it("U34 출력에는 편집 손잡이·메뉴·원형 보기 조작 줄이 없다", () => {
    const html = renderDocumentHtml(syntheticDoc(assetMap), urls, "light");
    expect(html).not.toContain("al-tools");
    expect(html).not.toContain("al-action-strip");
    expect(html).not.toContain("al-person-link");
    expect(html).not.toMatch(/<button/);
    expect(bandRootClass(syntheticDoc().view, "light", "export")).toContain("al-mode-export");
  });
});

describe("N05 원형 ↔ 내 스킨", () => {
  it("원형으로 돌아가도 내 스킨은 보관되고 다시 켜면 그대로", () => {
    const custom = styled((v) => {
      v.style!.commentSkin = "bubble";
      v.style!.avatar.shape = "square";
      v.width = 720;
    });
    const orig = C.updateView(custom, (v) => void (v.skinFamily = "original"));
    expect(docStyle(orig.view).commentSkin).toBe("band");
    expect(docStyle(orig.view).avatar.shape).toBe("circle");
    expect(renderDocumentHtml(orig, urls, "light")).toContain("--al-width:600px");
    expect(orig.view.style!.commentSkin).toBe("bubble");
    const back = C.updateView(orig, (v) => void (v.skinFamily = "custom"));
    expect(docStyle(back.view).commentSkin).toBe("bubble");
    expect(renderDocumentHtml(back, urls, "light")).toContain("--al-width:720px");
    expect(dataOf(back)).toBe(dataOf(custom));
  });
  it("기록 테마는 원형에서도 사용자 선택을 따른다", () => {
    const d = C.updateView(syntheticDoc(), (v) => void (v.style!.documentTheme = "light"));
    expect(d.view.skinFamily).toBe("original");
    expect(resolveDocTheme(d.view, "dark")).toBe("light");
  });
});

describe("U36 예전 표시 설정을 가진 문서", () => {
  it("글꼴·크기·다크 테마를 새 스타일로 옮기고 다른 값은 그대로 둔다", () => {
    const old = syntheticDoc(assetMap);
    const legacyView = { theme: "dark", fontFamily: "serif", sizes: { base: 14, name: 17, desc: 11, body: 19, comment: 16 }, linkedSizes: false, show: { date: false, readCount: true, reactions: true, description: true, excerpt: true }, missingImages: "omit", width: 700 };
    const loaded = normalizeDocument({ ...old, view: legacyView as unknown as ViewSettings });
    const st = docStyle(loaded.view);
    expect(st.documentTheme).toBe("dark");
    expect(st.typography.body.size).toBe(19);
    expect(st.typography.name.size).toBe(17);
    expect(st.typography.comment.font).toBe("serif");
    expect(loaded.view.width).toBe(700);
    expect(loaded.view.show.date).toBe(false);
    expect(loaded.view.missingImages).toBe("omit");
    expect(loaded.entries).toEqual(old.entries);
    // 바꾼 값이 있던 예전 문서는 그 모양(내 스킨)으로 보인다
    expect(loaded.view.skinFamily).toBe("custom");
  });
  it("예전 기본값 그대로인 문서는 새 원형으로", () => {
    const old = syntheticDoc();
    const legacyView = { theme: "light", fontFamily: "system", sizes: { base: 14, name: 15, desc: 12, body: 15, comment: 14 }, linkedSizes: true, show: old.view.show, missingImages: "placeholder", width: 640 };
    expect(normalizeDocument({ ...old, view: legacyView as unknown as ViewSettings }).view.skinFamily).toBe("original");
  });
  it("예전 기본값(라이트)은 '앱 테마 따름'으로 본다", () => {
    const v = { ...syntheticDoc().view, theme: "light" as const, style: undefined };
    expect(styleFromLegacy(v).documentTheme).toBe("app");
  });
  it("알 수 없는 스타일 필드는 버리지 않는다", () => {
    const d = syntheticDoc();
    const withExtra = { ...d, view: { ...d.view, style: { ...d.view.style!, futureField: 1 } as unknown as ViewSettings["style"] } };
    expect((normalizeDocument(withExtra).view.style as unknown as { futureField: number }).futureField).toBe(1);
  });
});
