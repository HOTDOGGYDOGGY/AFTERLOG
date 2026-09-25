// 사용자 탭에서 열린 인물 프로필 팝업(주소가 바뀌지 않음, [DProfileLayerView])을 읽는 함수. 페이지에 주입되므로 자체 완결형.
// 아무것도 누르지 않는다(이전/다음 프로필·스토리 보기·하트·댓글 포함). 보이는 팝업이 하나일 때만 읽고, 여럿이면 고르지 않는다.
export interface ProfilePopupExtraction {
  ok: boolean;
  reason?: "none" | "multiple" | "login";
  pageUrl: string;
  /** 정리된 팝업 영역 HTML(해석은 앱과 같은 해석기) */
  html: string | null;
  imageUrls: string[];
}

export function captureProfilePopupInPage(): ProfilePopupExtraction {
  const base = { pageUrl: location.href, html: null, imageUrls: [] as string[] };
  if (/(^|\.)auth\.band\.us$/.test(location.hostname) || document.querySelector("input[type=password]")) return { ...base, ok: false, reason: "login" };
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
  const el = layers[0];
  const c = el.cloneNode(true) as Element;
  const oi = Array.from(el.querySelectorAll("img"));
  const images = new Set<string>();
  Array.from(c.querySelectorAll("img")).forEach((im, i) => {
    const o = oi[i] as HTMLImageElement | undefined;
    const src = o?.currentSrc || o?.src || im.getAttribute("src") || "";
    if (src) {
      im.setAttribute("src", src);
      if (/^https?:/.test(src)) images.add(src);
    }
    im.removeAttribute("srcset");
  });
  c.querySelectorAll("script, noscript, iframe, object, embed, input, textarea, select, form, .menuModalLayer").forEach((x) => x.remove());
  for (const n of [c, ...Array.from(c.querySelectorAll("*"))])
    for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name) || a.name === "value" || (/^data-/i.test(a.name) && a.name !== "data-viewname")) n.removeAttribute(a.name);
  return { ok: true, pageUrl: location.href, html: `<div data-afterlog="popup">${c.outerHTML}</div>`, imageUrls: [...images] };
}
