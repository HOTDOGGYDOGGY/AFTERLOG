// 주소가 바뀌지 않는 프로필 팝업의 인물 주소 알아내기. 페이지에 주입되므로 자체 완결형.
// 팝업·멤버 목록에는 인물 식별자가 없다(실제 저장 표본: 링크가 모두 '…/member#'). 사용자가 알려 준 대로
// '스토리 보기'(없으면 '작성글 보기')를 누르면 주소가 그 인물의 화면으로 바뀌므로, 이 두 링크만 눌러 주소를 읽는다.
// 이 둘은 화면 이동(읽기)뿐이다. 하트·댓글·채팅하기·이전/다음 프로필·메뉴는 누르지 않는다.
export interface PopupMemberResult {
  ok: boolean;
  reason?: "none" | "multiple" | "noLink" | "noChange";
  /** 어떻게 알아냈나: 같은 탭 주소 · 새 탭 · 같은 주소의 레이어 안 링크 */
  how?: "sameTab" | "newTab" | "layer";
  /** 시도한 링크와 결과(진단용) */
  attempts?: { via: "story" | "posts"; outcome: "sameTab" | "newTab" | "layer" | "noChange" | "noLink" | "gone" }[];
  /** 이동한 주소(인물 식별자가 들어 있음) */
  memberUrl: string | null;
  via: "story" | "posts" | null;
  name: string | null;
  startUrl: string;
}

export async function resolvePopupMemberInPage(opts: { timeoutMs: number; prefer: "story" | "posts" }): Promise<PopupMemberResult> {
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
  const okStory = story && visible(story) ? story : null;
  const okPosts = posts && visible(posts) ? posts : null;
  const target = opts.prefer === "posts" ? okPosts : okStory ?? okPosts;
  if (!target) return { ...base, name, ok: false, reason: "noLink" };
  const via = target === okStory ? "story" : "posts";
  // 누르기 전부터 있던 인물 링크는 근거로 쓰지 않는다(배경 목록 등)
  const memberLink = /\/band\/\d+\/member\/(?!#)[^/?#]+/;
  const before = new Set(Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href).filter((h) => memberLink.test(h)));
  target.click();
  for (const t0 = Date.now(); Date.now() - t0 < opts.timeoutMs; ) {
    await sleep(150);
    if (location.href !== startUrl && /\/member\/[^/?#]+/.test(location.pathname)) return { ok: true, memberUrl: location.href, via, name, startUrl, how: "sameTab" };
    // 주소는 그대로인데 스토리·프로필이 레이어로 열린 경우: 새로 생긴 레이어 안의 인물 링크(이름이 같을 때만)
    const layers = Array.from(document.querySelectorAll("[data-viewname='DProfileStoryDetailLayerView'], [data-viewname='DProfileView'], [data-viewname='DProfileStoryListView']")).filter(visible);
    for (const l of layers) {
      const who = (l.querySelector(".userName, .profileStoryDetailWriterBox em")?.textContent ?? "").replace(/\s+/g, "");
      if (name && who && who !== name.replace(/\s+/g, "")) continue;
      const link = Array.from(l.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).href)
        .find((h) => memberLink.test(h) && !before.has(h));
      if (link) return { ok: true, memberUrl: link, via, name, startUrl, how: "layer" };
    }
  }
  return { ...base, name, via, ok: false, reason: "noChange" };
}
