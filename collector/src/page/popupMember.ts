// 주소가 바뀌지 않는 프로필 팝업의 인물 주소 알아내기. 페이지에 주입되므로 자체 완결형.
// 팝업·멤버 목록에는 인물 식별자가 없다(실제 저장 표본: 링크가 모두 '…/member#'). 사용자가 알려 준 대로
// '스토리 보기'(없으면 '작성글 보기')를 누르면 주소가 그 인물의 화면으로 바뀌므로, 이 두 링크만 눌러 주소를 읽는다.
// 이 둘은 화면 이동(읽기)뿐이다. 하트·댓글·채팅하기·이전/다음 프로필·메뉴는 누르지 않는다.
export interface PopupMemberResult {
  ok: boolean;
  reason?: "none" | "multiple" | "noLink" | "noChange";
  /** 이동한 주소(인물 식별자가 들어 있음) */
  memberUrl: string | null;
  via: "story" | "posts" | null;
  name: string | null;
  startUrl: string;
}

export async function resolvePopupMemberInPage(opts: { timeoutMs: number }): Promise<PopupMemberResult> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const startUrl = location.href;
  const base = { memberUrl: null, via: null, name: null, startUrl };
  const visible = (el: Element) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === "none" || st.visibility === "hidden") return false;
    }
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const layers = Array.from(document.querySelectorAll("[data-viewname='DProfileLayerView']")).filter(visible);
  if (!layers.length) return { ...base, ok: false, reason: "none" };
  if (layers.length > 1) return { ...base, ok: false, reason: "multiple" };
  const layer = layers[0];
  const name = txt(layer.querySelector(".cProfileViewCard .userName, .userName")) || null;
  const story = layer.querySelector("[data-viewname='DProfileStoryCountView'] a._storyAnchor, a.profileStoryMoveButton") as HTMLElement | null;
  const posts = layer.querySelector("[data-viewname='DProfileNavView'] a._btnGotoSearchMemberContent, a.writePost._btnGotoSearchMemberContent") as HTMLElement | null;
  const target = story && visible(story) ? story : posts && visible(posts) ? posts : null;
  if (!target) return { ...base, name, ok: false, reason: "noLink" };
  const via = target === story ? "story" : "posts";
  target.click();
  for (const t0 = Date.now(); Date.now() - t0 < opts.timeoutMs; ) {
    await sleep(150);
    if (location.href !== startUrl && /\/member\/[^/?#]+/.test(location.pathname)) return { ok: true, memberUrl: location.href, via, name, startUrl };
  }
  return { ...base, name, via, ok: false, reason: "noChange" };
}
