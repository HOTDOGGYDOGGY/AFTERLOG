// 인물 프로필 화면(/band/숫자/member/식별자/profile)에서 실행되는 함수. 페이지에 주입되므로 자체 완결형으로 유지한다.
// 두 가지를 함께 만든다:
//  1) 구조 자료: 프로필 카드·스토리 목록과, 스토리마다 상세 레이어를 열어 읽은 전문·반응 수·댓글(실제 저장 표본의 구조). 해석은 앱과 같은 해석기(src/importers/band/profile.ts)가 한다.
//  2) 보관 화면(스냅숏): 보이는 모습 그대로의 HTML·CSS·이미지 주소.
// 누르는 것: 스토리 상세 열기(a.storyDetailLink._storyDetail) · 상세의 '이전 댓글/답글 더보기'류 · 상세 닫기(._btnClose)만.
// 하트·표정·댓글쓰기·메뉴(차단·신고)·입력칸은 절대 누르지 않는다.

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
  /** 구조 자료(정리된 HTML): 프로필 영역 + 연 스토리 상세들 */
  structureHtml?: string | null;
  /** 스토리 상세: 연 수 · 목록 항목 수 · 확인 실패(다른 스토리가 열림 등) · 닫지 못함 */
  storyDetails?: { opened: number; listed: number; mismatched: number; notClosed: number; commentClicks: number; stoppedEarly: boolean };
  /** 진단용: 확인 위치별 개수(스크롤 후, 상세를 열기 전 화면) */
  probeCounts?: Record<string, number>;
  /** 읽는 동안 페이지가 '숨김' 상태였던 적이 있는가(다른 창에 가려진 창은 밴드가 목록을 늦게/안 불러올 수 있음) */
  hiddenSeen?: boolean;
  /** 창을 앞으로 가져와 다시 읽었는가(첫 읽기에서 스토리 0개였을 때) */
  rechecked?: { listedBefore: number; listedAfter: number };
}

export async function captureProfileInPage(opts: {
  waitMs: number;
  maxRounds: number;
  maxCssBytes: number;
  readyMs: number;
  /** 스토리 상세를 열어 전문·댓글 읽기(기본 켬) */
  openStories?: boolean;
  /** 스토리 하나에 쓸 시간 · 전체 스토리 상세 시간 */
  storyMs?: number;
  storiesTotalMs?: number;
  /** 진단용 확인 위치(개수만 돌려준다) */
  probes?: [string, string][];
}): Promise<ProfileExtraction> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const base = { pageUrl: location.href, name: null, description: null, html: null, css: "", cssTruncated: false, imageUrls: [], stories: [], scrollRounds: 0 };
  if (/(^|\.)auth\.band\.us$/.test(location.hostname) || document.querySelector("input[type=password]")) return { ...base, ok: false, reason: "login" };
  let hiddenSeen = document.visibilityState === "hidden";
  const onVis = () => {
    if (document.visibilityState === "hidden") hiddenSeen = true;
  };
  document.addEventListener("visibilitychange", onVis);

  const pickRoot = () => document.querySelector("main#content, #content, [role='main'], .midContent, main") ?? document.body;
  // 처음 그려질 때까지
  for (const t0 = Date.now(); Date.now() - t0 < opts.readyMs && txt(pickRoot()).length < 5; ) await sleep(200);

  // 스토리 목록이 채워지거나 밴드가 '스토리가 없다'고 표시할 때까지 기다린다(실사용: 목록보다 카드가 먼저 그려짐).
  // 빈 안내가 먼저 떴다가 목록이 오는 경우를 위해 빈 안내면 조금 더 본다
  const storyState = () => {
    const l = document.querySelector("[data-viewname='DProfileStoryListView']");
    if (!l) return "none";
    if (l.querySelector("[data-viewname='DProfileStoryListItemView']")) return "items";
    return l.querySelector(".uEmpty") ? "empty" : "loading";
  };
  for (const t0 = Date.now(); Date.now() - t0 < opts.readyMs && (storyState() === "loading" || storyState() === "none"); ) {
    await sleep(250);
    onVis();
    if (storyState() === "none" && Date.now() - t0 > 4000) break;
  }
  if (storyState() === "empty") for (let i = 0; i < 10 && storyState() === "empty"; i++) await sleep(300);

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

  const probeCounts: Record<string, number> = {};
  for (const [id, sel] of opts.probes ?? []) {
    try {
      probeCounts[id] = document.querySelectorAll(sel).length;
    } catch {
      probeCounts[id] = 0;
    }
  }

  // ---- 스토리 상세(읽기 전용 열기 → 댓글 펼치기 → 복제 → 닫기) ----
  const cleanClone = (el: Element) => {
    const c = el.cloneNode(true) as Element;
    const oi = Array.from(el.querySelectorAll("img"));
    Array.from(c.querySelectorAll("img")).forEach((im, i) => {
      const o = oi[i] as HTMLImageElement | undefined;
      const src = o?.currentSrc || o?.src || im.getAttribute("src") || "";
      if (src) im.setAttribute("src", src);
      im.removeAttribute("srcset");
    });
    // 배경 이미지(커버)는 계산된 값을 style에 적는다
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
  const visible = (el: Element | null): el is HTMLElement => {
    if (!el) return false;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === "none" || st.visibility === "hidden") return false;
    }
    return true;
  };
  const openDetail = () => Array.from(document.querySelectorAll("[data-viewname='DProfileStoryDetailView']")).find((d) => visible(d)) ?? null;
  const TEXT_OK = /^(이전\s*댓글|이전\s*답글|지난\s*댓글|댓글\s*\d*\s*개?\s*더\s*보기|답글\s*\d*\s*개?\s*(더\s*)?보기|이전\s*댓글\s*\d*\s*개?\s*(더\s*)?보기)/;
  const CLASS_OK = /prevComment|PrevComment|moreComment|MoreComment|commentMore|CommentMore|prevReply|PrevReply|replyMore|ReplyMore|moreReply|MoreReply|previousComment|PreviousComment/;
  const CLASS_DENY = /mute|Mute|emotion|Emotion|emote|Emote|translat|Translat|setting|Setting|submit|Submit|write|Write|delete|Delete|remove|Remove|report|Report|_replyBtn|share|Share|like|Like|menu|Menu|upload|Upload|edit|Edit|sticker|Sticker|send|Send/;
  const details: string[] = [];
  const sd = { opened: 0, listed: 0, mismatched: 0, notClosed: 0, commentClicks: 0, stoppedEarly: false };
  const items = Array.from(document.querySelectorAll("[data-viewname='DProfileStoryListItemView']"));
  sd.listed = items.length;
  if (opts.openStories !== false) {
    const allUntil = Date.now() + (opts.storiesTotalMs ?? 10 * 60_000);
    for (const li of items) {
      if (Date.now() > allUntil) {
        sd.stoppedEarly = true;
        break;
      }
      const link = li.querySelector("a.storyDetailLink._storyDetail, a._storyDetail") as HTMLElement | null;
      if (!link) continue;
      const wantTime = txt(li.querySelector("time"));
      const path0 = location.pathname;
      const before = openDetail();
      link.click();
      let d: HTMLElement | null = null;
      for (const t0 = Date.now(); Date.now() - t0 < Math.min(opts.readyMs, 15_000); ) {
        await sleep(150);
        const cur = openDetail();
        if (cur && cur !== before && txt(cur).length > 2) {
          d = cur;
          break;
        }
      }
      if (!d) continue;
      await sleep(Math.min(opts.waitMs, 800));
      // 다른 스토리가 열렸으면 쓰지 않는다
      const gotTime = txt(d.querySelector(".postListInfoWrap time, time"));
      if (wantTime && gotTime && wantTime.replace(/\s+/g, "") !== gotTime.replace(/\s+/g, "")) {
        sd.mismatched++;
      } else {
        // 댓글 펼치기(허용 목록 버튼만). 새 댓글이 없는 상태가 이어지면 멈춘다
        const until = Date.now() + (opts.storyMs ?? 60_000);
        const tried = new WeakSet<Element>();
        let stall = 0;
        const area = () => d!.querySelector("[data-viewname='DBandProfileStoryCommentListView']") ?? d!;
        while (Date.now() < until && stall < 4) {
          const btn = Array.from(area().querySelectorAll('button, a, [role="button"]')).find((el) => {
            if (tried.has(el) || !visible(el)) return false;
            if (el.closest('form, textarea, [contenteditable="true"], .cCommentWriteNew, ._commentInputRegion, .mentions-input')) return false;
            const cls = (el.getAttribute("class") ?? "") + " " + (el.getAttribute("data-uiselector") ?? "");
            if (CLASS_DENY.test(cls)) return false;
            const t = txt(el);
            return TEXT_OK.test(t) || (CLASS_OK.test(cls) && t.length <= 40);
          }) as HTMLElement | undefined;
          if (!btn) break;
          const n0 = d.querySelectorAll(".cComment").length;
          btn.click();
          sd.commentClicks++;
          tried.add(btn);
          let grew = false;
          for (const t0 = Date.now(); Date.now() - t0 < 5000; ) {
            await sleep(150);
            if (d.querySelectorAll(".cComment").length !== n0) {
              grew = true;
              await sleep(300);
              break;
            }
          }
          stall = grew ? 0 : stall + 1;
        }
        details.push(cleanClone(d));
        sd.opened++;
      }
      // 닫기: 상세 레이어의 닫기 버튼 → Esc → (주소가 바뀌었으면) 뒤로
      const layer = d.closest("[data-viewname='DProfileStoryDetailLayerView']") ?? d.parentElement;
      const closeBtn = (layer?.querySelector("._btnClose, .btnCloseLyPost") ?? null) as HTMLElement | null;
      if (closeBtn) closeBtn.click();
      else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
      for (let i = 0; i < 20 && openDetail() === d; i++) await sleep(100);
      if (openDetail() === d && location.pathname !== path0) {
        history.back();
        for (let i = 0; i < 20 && openDetail() === d; i++) await sleep(100);
      }
      if (openDetail() === d) {
        sd.notClosed++;
        sd.stoppedEarly = true;
        break;
      }
      await sleep(Math.min(opts.waitMs, 600));
    }
  }
  const profileEl = document.querySelector("[data-viewname='DProfileView']");
  const listEl = document.querySelector("[data-viewname='DProfileStoryListView']");
  const structureHtml = profileEl
    ? `<div data-afterlog="profile">${cleanClone(profileEl)}${listEl && !profileEl.contains(listEl) ? cleanClone(listEl) : ""}<div data-afterlog="details">${details.join("")}</div></div>`
    : null;

  const root = pickRoot();
  if (txt(root).length < 2) return { ...base, ok: false, reason: "empty", scrollRounds: rounds, structureHtml, storyDetails: sd, probeCounts, hiddenSeen };

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
    structureHtml,
    storyDetails: sd,
    probeCounts,
    hiddenSeen,
  };
}
