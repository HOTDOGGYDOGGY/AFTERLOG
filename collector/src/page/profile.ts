// 인물 프로필 화면(/band/숫자/member/식별자/profile)에서 실행되는 함수. 페이지에 주입되므로 자체 완결형으로 유지한다.
// 실제 화면 구조 샘플이 없어서 구조를 추측해 해석하지 않고, 보이는 모습을 그대로 보관한다(스냅숏):
//  - 끝까지 스크롤해 스토리를 모두 불러온 뒤 본문 영역을 복제하고, 페이지 스타일(CSS)과 이미지 주소(배경 이미지 포함)를 함께 모은다.
//  - 이름·소개·스토리(날짜·글·숫자)는 요약용으로만 추정한다(날짜 표기 '2026년 2월 23일 오전 12:27'을 기준으로 항목을 나눔).
// 아무것도 누르지 않는다(프로필의 하트·댓글·메뉴 버튼은 반응·쓰기라 절대 누르지 않음). 스크롤만 한다.

export interface ProfileStory {
  date: string;
  text: string;
  /** 항목 안의 숫자(보통 표정 수, 댓글 수 순서). 뜻은 확인되지 않은 추정 */
  numbers: number[];
  links: string[];
}

export interface ProfileExtraction {
  ok: boolean;
  reason?: "login" | "empty";
  pageUrl: string;
  name: string | null;
  description: string | null;
  html: string | null;
  css: string;
  cssTruncated: boolean;
  imageUrls: string[];
  stories: ProfileStory[];
  scrollRounds: number;
}

export async function captureProfileInPage(opts: { waitMs: number; maxRounds: number; maxCssBytes: number; readyMs: number }): Promise<ProfileExtraction> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const base = { pageUrl: location.href, name: null, description: null, html: null, css: "", cssTruncated: false, imageUrls: [], stories: [], scrollRounds: 0 };
  if (/(^|\.)auth\.band\.us$/.test(location.hostname) || document.querySelector("input[type=password]")) return { ...base, ok: false, reason: "login" };

  const pickRoot = () => document.querySelector("main#content, #content, [role='main'], .midContent, main") ?? document.body;
  // 처음 그려질 때까지
  for (const t0 = Date.now(); Date.now() - t0 < opts.readyMs && txt(pickRoot()).length < 5; ) await sleep(200);

  // 끝까지 스크롤(스토리 더 불러오기). 높이가 3번 연속 그대로면 끝
  let rounds = 0;
  let same = 0;
  let lastH = -1;
  while (rounds < opts.maxRounds && same < 3) {
    const scrollers = [document.scrollingElement ?? document.documentElement, ...Array.from(pickRoot().querySelectorAll("*")).filter((el) => el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))];
    for (const s of scrollers) s.scrollTop = s.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(opts.waitMs);
    const h = scrollers.reduce((n, s) => n + s.scrollHeight, 0) + pickRoot().querySelectorAll("*").length;
    same = h === lastH ? same + 1 : 0;
    lastH = h;
    rounds++;
  }
  window.scrollTo(0, 0);

  const root = pickRoot();
  if (txt(root).length < 2) return { ...base, ok: false, reason: "empty", scrollRounds: rounds };

  // ---- 복제·정리 ----
  const abs = (u: string) => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return "";
    }
  };
  const origAll = [root, ...Array.from(root.querySelectorAll("*"))];
  const clone = root.cloneNode(true) as Element;
  const cloneAll = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const images = new Set<string>();
  const bgRe = /url\((['"]?)(.*?)\1\)/g;
  origAll.forEach((o, i) => {
    const c = cloneAll[i] as HTMLElement | undefined;
    if (!c) return;
    // 배경 이미지(커버 사진 등)는 계산된 스타일에서 주소를 읽어 복제본에 직접 적는다
    const bg = getComputedStyle(o).backgroundImage;
    if (bg && bg !== "none" && bg.includes("url(")) {
      const fixed = bg.replace(bgRe, (_m, _q, u) => {
        const a = abs(u);
        if (/^https?:/.test(a)) images.add(a);
        return `url("${a}")`;
      });
      c.style.backgroundImage = fixed;
    }
    if (o.tagName === "IMG") {
      const img = o as HTMLImageElement;
      const src = img.currentSrc || img.src || img.getAttribute("data-src") || "";
      const a = abs(src);
      if (a) {
        c.setAttribute("src", a);
        if (/^https?:/.test(a)) images.add(a);
      }
      c.removeAttribute("srcset");
      c.removeAttribute("loading");
    }
    if (o.tagName === "A") {
      const h = (o as HTMLAnchorElement).href;
      if (h && /^https?:/.test(h)) c.setAttribute("href", h);
      else c.removeAttribute("href");
      c.setAttribute("target", "_blank");
      c.setAttribute("rel", "noreferrer");
    }
  });
  clone.querySelectorAll("script, noscript, iframe, object, embed, input, textarea, select, form, link, meta").forEach((el) => el.remove());
  for (const el of [clone, ...Array.from(clone.querySelectorAll("*"))])
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name) || a.name === "value" || (/^data-/i.test(a.name) && a.name !== "data-viewname")) el.removeAttribute(a.name);

  // ---- 페이지 스타일 ----
  let css = "";
  let cssTruncated = false;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 다른 곳의 스타일은 읽을 수 없음
    }
    const baseHref = sheet.href ?? location.href;
    for (const r of Array.from(rules ?? [])) {
      const t = r.cssText.replace(bgRe, (_m, _q, u) => {
        if (/^data:/.test(u)) return `url("${u}")`;
        try {
          return `url("${new URL(u, baseHref).href}")`;
        } catch {
          return "none";
        }
      });
      if (css.length + t.length > opts.maxCssBytes) {
        cssTruncated = true;
        break;
      }
      css += t + "\n";
    }
    if (cssTruncated) break;
  }

  // ---- 요약(추정) ----
  const DATE = /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일(\s*(오전|오후)\s*\d{1,2}:\d{2})?$/;
  const dateEls = Array.from(root.querySelectorAll("*")).filter((el) => el.children.length === 0 && DATE.test(txt(el)));
  const stories: ProfileStory[] = [];
  for (const d of dateEls) {
    let item: Element = d;
    for (let p = d.parentElement; p && p !== root; p = p.parentElement) {
      if (dateEls.filter((x) => p.contains(x)).length > 1) break;
      item = p;
    }
    if (item === d) continue;
    const leaves = Array.from(item.querySelectorAll("*")).filter((el) => el.children.length === 0);
    const numbers = leaves.map((el) => txt(el)).filter((t) => /^\d[\d,]*$/.test(t)).map((t) => Number(t.replace(/,/g, "")));
    const text = leaves
      .filter((el) => el !== d && !/^\d[\d,]*$/.test(txt(el)) && txt(el))
      .map((el) => txt(el))
      .join("\n")
      .trim();
    const links = Array.from(item.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((h) => /^https?:/.test(h));
    stories.push({ date: txt(d), text, numbers, links: [...new Set(links)] });
  }
  // 이름: 첫 스토리 위쪽에서 글자가 가장 큰 짧은 글
  const firstStoryTop = dateEls[0]?.getBoundingClientRect().top ?? Infinity;
  let name: string | null = null;
  let nameEl: Element | null = null;
  let best = 0;
  for (const el of Array.from(root.querySelectorAll("h1, h2, h3, strong, b, span, div, p"))) {
    const t = txt(el);
    if (!t || t.length > 40 || el.children.length > 2) continue;
    const r = el.getBoundingClientRect();
    if (r.top > firstStoryTop) continue;
    const size = parseFloat(getComputedStyle(el).fontSize) || 0;
    if (size > best) {
      best = size;
      name = t;
      nameEl = el;
    }
  }
  const description = nameEl?.nextElementSibling && txt(nameEl.nextElementSibling).length <= 80 ? txt(nameEl.nextElementSibling) || null : null;

  return {
    ok: true,
    pageUrl: location.href,
    name,
    description,
    html: clone.outerHTML,
    css,
    cssTruncated,
    imageUrls: [...images],
    stories,
    scrollRounds: rounds,
  };
}
