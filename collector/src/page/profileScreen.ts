// '직접 열며 수집': 사용자가 연 화면을 그대로 읽는다(누르거나 스크롤하지 않음). 페이지에 주입되므로 자체 완결형.
// 읽는 곳: 보이는 프로필 팝업 · 프로필 화면(카드·스토리 목록) · 열린 스토리 상세 · 인물 화면 머리글 · '사진' 탭 목록.
// 입력칸·메뉴·알림·계정 영역은 복제하지 않는다. 해석은 앱과 같은 해석기가 한다.
export interface ProfileScreenRead {
  pageUrl: string;
  /** 정리된 대상 영역 HTML(없으면 null = 이 화면은 프로필 관련 화면이 아님) */
  html: string | null;
  imageUrls: string[];
  /** 사진 탭 목록의 사진 주소 */
  photoSrcs: string[] | null;
  /** 게시글 상세(스토리 아님)가 열려 있음 */
  postOpen: boolean;
  /**
   * 아직 해석하지 못하는 열린 레이어(예: 프로필 사진을 누르면 뜨는 사진 보기). 구조를 모르므로 보이는 그대로 원문 보관한다.
   * label은 레이어의 화면 구조 이름(data-viewname)
   */
  rawLayers: { label: string; html: string; imageUrls: string[] }[];
  loginRequired: boolean;
}

export function readProfileScreenInPage(): ProfileScreenRead {
  const pageUrl = location.href;
  const loginRequired = /(^|\.)auth\.band\.us$/.test(location.hostname) || !!document.querySelector("input[type=password]");
  const visible = (el: Element) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === "none" || st.visibility === "hidden") return false;
    }
    return true;
  };
  const images = new Set<string>();
  const clean = (el: Element) => {
    const c = el.cloneNode(true) as Element;
    const oi = Array.from(el.querySelectorAll("img"));
    Array.from(c.querySelectorAll("img")).forEach((im, i) => {
      const o = oi[i] as HTMLImageElement | undefined;
      const src = o?.currentSrc || o?.src || im.getAttribute("src") || "";
      if (src) {
        im.setAttribute("src", src);
        if (/^https?:/.test(src)) images.add(src);
      }
      im.removeAttribute("srcset");
    });
    const oa = [el, ...Array.from(el.querySelectorAll("*"))];
    [c, ...Array.from(c.querySelectorAll("*"))].forEach((n, i) => {
      const o = oa[i];
      if (!o) return;
      const bg = getComputedStyle(o).backgroundImage;
      if (bg && bg !== "none" && bg.includes("url(")) (n as HTMLElement).style.backgroundImage = bg;
    });
    c.querySelectorAll("script, noscript, iframe, object, embed, input, textarea, select, form, .cCommentWriteNew, ._commentInputRegion, .menuModalLayer").forEach((x) => x.remove());
    for (const n of [c, ...Array.from(c.querySelectorAll("*"))])
      for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name) || a.name === "value" || (/^data-/i.test(a.name) && a.name !== "data-viewname")) n.removeAttribute(a.name);
    return c.outerHTML;
  };
  const parts: string[] = [];
  const header = document.querySelector(".accountSectionHeader");
  if (header) parts.push(clean(header));
  const page = document.querySelector("[data-viewname='DProfileView']");
  if (page && visible(page)) {
    parts.push(clean(page));
    const list = document.querySelector("[data-viewname='DProfileStoryListView']");
    if (list && !page.contains(list)) parts.push(clean(list));
  }
  for (const d of Array.from(document.querySelectorAll("[data-viewname='DProfileStoryDetailView']"))) if (visible(d)) parts.push(clean(d));
  const popups = Array.from(document.querySelectorAll("[data-viewname='DProfileLayerView']")).filter(visible);
  if (popups.length === 1) parts.push(clean(popups[0]));
  const photoLayout = document.querySelector("[data-viewname='DBandMemberPhotoLayoutView']");
  if (photoLayout && visible(photoLayout)) parts.push(clean(photoLayout));
  const photoList = document.querySelector("[data-viewname='DBandMemberPhotoListView']");
  const photoSrcs = photoList
    ? Array.from(photoList.querySelectorAll("[data-viewname='DBandMemberPhotoListItemView'] img"))
        .map((im) => (im as HTMLImageElement).currentSrc || (im as HTMLImageElement).src || "")
        .filter((u) => /^https?:/.test(u))
    : document.querySelector("[data-viewname='DBandMemberPhotoLayoutView'] .uEmpty")
      ? []
      : null;
  // 해석하지 못하는 열린 레이어: 알려진 것(프로필 팝업·스토리 상세)과 게시글·확장 막대는 뺀다. 바깥 레이어 하나만
  const KNOWN = "[data-viewname='DProfileLayerView'], [data-viewname='DProfileStoryDetailView'], .cPostCard, #afterlog-collector-bar";
  const layerSel = "section.lyWrap, div.lyWrap, [role='dialog'], [aria-modal='true'], [data-viewname$='LayerView'], [data-viewname*='Viewer']";
  const cands = Array.from(document.querySelectorAll(layerSel)).filter((el) => visible(el) && !el.matches(KNOWN) && !el.querySelector(KNOWN) && !el.closest(KNOWN));
  const rawLayers: ProfileScreenRead["rawLayers"] = [];
  for (const el of cands) {
    if (cands.some((o) => o !== el && o.contains(el))) continue;
    if ((el.textContent ?? "").trim().length < 1 && !el.querySelector("img")) continue;
    const before = new Set(images);
    const html = clean(el);
    if (html.length > 3 * 1024 * 1024) continue;
    const label = el.getAttribute("data-viewname") || el.querySelector("[data-viewname]")?.getAttribute("data-viewname") || "레이어";
    rawLayers.push({ label, html, imageUrls: [...images].filter((u) => !before.has(u)) });
  }
  const postOpen = Array.from(document.querySelectorAll(".cPostCard")).some((c) => visible(c) && !c.closest("[data-viewname^='DProfileStory']"));
  const meaningful = !!(page || popups.length === 1 || document.querySelector("[data-viewname='DProfileStoryDetailView']") || photoSrcs);
  return { pageUrl, html: meaningful ? `<div data-afterlog="screen">${parts.join("")}</div>` : null, imageUrls: [...images], photoSrcs, postOpen, loginRequired, rawLayers };
}
