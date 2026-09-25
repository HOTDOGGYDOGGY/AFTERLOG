// 밴드 기록의 표시 설정 해석기. 편집 미리보기·원형 보기·HTML·PNG가 모두 이 결과를 쓴다(명세 v1.2 17절).
// 스타일은 DOM inline 값이 아니라 문서의 view.style에 의미 단위로 저장하고, 여기서 CSS 변수와 클래스로 바꾼다.
import type { CSSProperties } from "react";
import type { AvatarShape, DocStyle, DocumentData, FontKey, Identity, TextRole, ViewSettings } from "../../domain/types";
import { defaultDocStyle } from "../../domain/style";

export { defaultDocStyle };

export const FONT_STACKS: Record<FontKey, string> = {
  system: `"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, -apple-system, "Segoe UI", sans-serif`,
  serif: `"AppleMyungjo", "Batang", "Noto Serif KR", "Nanum Myeongjo", serif`,
  mono: `"D2Coding", "Consolas", ui-monospace, monospace`,
  rounded: `"NanumSquareRound", "Nanum Gothic", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`,
};
export const FONT_LABEL: Record<FontKey, string> = { system: "기본 고딕", serif: "명조", mono: "고정폭", rounded: "둥근 고딕" };

/** 조절 범위(명세 10·11절 제안값). 기록 출력용이며 앱 버튼 글자와 무관 */
export const RANGES = {
  size: { name: [12, 24], desc: [10, 18], body: [12, 28], comment: [12, 28], meta: [10, 18] } as Record<TextRole, [number, number]>,
  lineHeight: [1.2, 2.2] as [number, number],
  letterSpacing: [-0.5, 1] as [number, number],
  avatar: { post: [24, 80], comment: [20, 64], reply: [16, 56], profile: [48, 160] } as Record<"post" | "comment" | "reply" | "profile", [number, number]>,
  radius: [0, 24] as [number, number],
  border: [0, 4] as [number, number],
  width: [360, 960] as [number, number],
  replyIndent: [0, 64] as [number, number],
};

/**
 * 예전 설정(글꼴 3종·크기·테마)만 있는 문서의 스타일을 만든다. 기존 값은 그대로 옮긴다.
 * 예전 기본값이던 라이트 테마는 '앱과 연결'로, 다크는 명시 선택으로 보고 유지한다.
 */
export function styleFromLegacy(view: ViewSettings): DocStyle {
  const s = defaultDocStyle();
  s.documentTheme = view.theme === "dark" ? "dark" : "app";
  s.typography.name.size = view.sizes.name;
  s.typography.desc.size = view.sizes.desc;
  s.typography.body.size = view.sizes.body;
  s.typography.comment.size = view.sizes.comment;
  if (view.fontFamily !== "system") for (const r of Object.keys(s.typography) as TextRole[]) s.typography[r].font = view.fontFamily;
  return s;
}

/** 빠진 필드만 기본값으로 채운다(알 수 없는 값은 보존) */
export function completeStyle(st: Partial<DocStyle> | undefined, view: ViewSettings): DocStyle {
  const base = st ? defaultDocStyle() : styleFromLegacy(view);
  if (!st) return base;
  return {
    ...base,
    ...st,
    version: 1,
    avatar: { ...base.avatar, ...st.avatar, sizes: { ...base.avatar.sizes, ...st.avatar?.sizes } },
    typography: {
      name: { ...base.typography.name, ...st.typography?.name },
      desc: { ...base.typography.desc, ...st.typography?.desc },
      body: { ...base.typography.body, ...st.typography?.body },
      comment: { ...base.typography.comment, ...st.typography?.comment },
      meta: { ...base.typography.meta, ...st.typography?.meta },
    },
    colors: { ...base.colors, ...st.colors },
    comments: { ...base.comments, ...st.comments },
  };
}

export function docStyle(view: ViewSettings): DocStyle {
  return view.style ?? styleFromLegacy(view);
}

export type AppThemeResolved = "light" | "dark";

/** 기록 테마를 실제 값으로. 'app'은 지금 편집기 화면 테마(내보낼 때는 그 시점 값으로 확정) */
export function resolveDocTheme(view: ViewSettings, appTheme: AppThemeResolved): AppThemeResolved {
  const t = docStyle(view).documentTheme;
  return t === "app" ? appTheme : t;
}

/** 지금 편집기 화면 테마(문서 요소의 data-theme). 테스트·서버 렌더에서는 라이트 */
export function currentAppTheme(): AppThemeResolved {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function bandRootClass(view: ViewSettings, appTheme: AppThemeResolved, mode: string): string {
  const st = docStyle(view);
  return [
    "al-band",
    `al-theme-${resolveDocTheme(view, appTheme)}`,
    `al-mode-${mode}`,
    `al-skin-${st.commentSkin}`,
    `al-shape-${st.avatar.shape}`,
    st.comments.dividers ? "al-dividers" : "al-no-dividers",
    st.avatar.shadow === "soft" ? "al-avatar-shadow" : "",
    `al-tail-${st.comments.bubbleTail}`,
  ]
    .filter(Boolean)
    .join(" ");
}

const px = (n: number) => `${n}px`;

export function bandRootStyle(view: ViewSettings): CSSProperties {
  const st = docStyle(view);
  const t = st.typography;
  const font = (r: TextRole) => FONT_STACKS[t[r].font ?? "system"];
  const vars: Record<string, string | number> = {
    "--al-width": px(view.width),
    "--al-size-base": px(t.comment.size),
    "--al-size-name": px(t.name.size),
    "--al-size-desc": px(t.desc.size),
    "--al-size-body": px(t.body.size),
    "--al-size-comment": px(t.comment.size),
    "--al-size-meta": px(t.meta.size),
    "--al-weight-name": t.name.weight ?? 700,
    "--al-lh-body": t.body.lineHeight ?? 1.6,
    "--al-lh-comment": t.comment.lineHeight ?? 1.55,
    "--al-ls-body": px(t.body.letterSpacing ?? 0),
    "--al-ls-comment": px(t.comment.letterSpacing ?? 0),
    "--al-font-name": font("name"),
    "--al-font-desc": font("desc"),
    "--al-font-body": font("body"),
    "--al-font-comment": font("comment"),
    "--al-font-meta": font("meta"),
    "--al-av-post": px(st.avatar.sizes.post),
    "--al-av-comment": px(st.avatar.sizes.comment),
    "--al-av-reply": px(st.avatar.sizes.reply),
    "--al-av-profile": px(st.avatar.sizes.profile),
    // 모양은 인장마다 클래스(is-circle/is-square/is-rounded)로, 둥근 사각형의 반경만 변수로
    "--al-av-rounded": px(st.avatar.radius),
    "--al-av-border": st.avatar.borderWidth ? `${px(st.avatar.borderWidth)} solid ${st.avatar.borderColor ?? "var(--al-line)"}` : "0",
    "--al-reply-indent": px(st.comments.replyIndent),
    "--al-bubble-radius": px(st.comments.bubbleRadius),
  };
  if (st.colors.background) vars["--al-page"] = st.colors.background;
  if (st.colors.surface) vars["--al-card"] = st.colors.surface;
  if (st.colors.commentSurface) vars["--al-soft"] = st.colors.commentSurface;
  if (st.colors.text) vars["--al-text"] = st.colors.text;
  if (st.colors.mention) vars["--al-mention"] = st.colors.mention;
  return { ...(vars as CSSProperties), fontFamily: font("comment") };
}

/** 이 인물의 인장 모양(인물별 설정이 있으면 그것) */
export function avatarShapeFor(view: ViewSettings, idn: Identity | null): AvatarShape {
  return idn?.style?.avatarShape ?? docStyle(view).avatar.shape;
}

/** 출력 바깥 면 색(HTML body·PNG 배경). 앱 바탕색과 섞지 않는다 */
export function pageBackground(view: ViewSettings, theme: AppThemeResolved): string {
  const st = docStyle(view);
  if (st.colors.background) return st.colors.background;
  return theme === "dark" ? "#17191d" : "#f0f1f3";
}

/** 문서가 원형 기본값과 같은지(꾸미기 표시용) */
export function isOriginalStyle(doc: DocumentData): boolean {
  const cur = JSON.stringify(docStyle(doc.view));
  const def = defaultDocStyle();
  def.documentTheme = docStyle(doc.view).documentTheme;
  return cur === JSON.stringify(def);
}
