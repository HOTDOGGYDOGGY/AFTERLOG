// 밴드 탭 안에서 실행되는 함수(chrome.scripting.executeScript의 func).
// 주의: 직렬화되어 페이지에 주입되므로 바깥 변수·import를 쓰면 안 된다. 자체 완결형으로 유지할 것.
// 하는 일: 게시글 상세가 안정될 때까지 기다린 뒤 게시글 카드(cPostCard)만 복제해서 돌려준다.
// 쓰기 동작(표정·댓글·클릭)은 하지 않는다. 로그인 정보·배경 화면은 복사하지 않는다.

export interface PostExtraction {
  ok: boolean;
  /** 실패 원인 분류 */
  reason?: "login" | "not-found" | "timeout" | "multiple";
  message?: string;
  pageUrl: string;
  /** 글 작성자 링크 등에서 찾은 게시글 주소 */
  postHref: string | null;
  bandName: string | null;
  html: string | null;
  commentsShown: number | null;
  commentsFound: number;
  imageUrls: string[];
  /** 로그인한 사용자 확인용(약한 근거: 내 프로필 사진 파일명) */
  accountMarker: string | null;
  waitedMs: number;
  /** 알려진 확인 위치별 발견 개수(진단용, 숫자만) */
  probeCounts: Record<string, number>;
}

export async function extractPostInPage(opts: { timeoutMs: number; stableMs: number; probes: [string, string][] }): Promise<PostExtraction> {
  const t0 = Date.now();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const base = {
    pageUrl: location.href,
    postHref: null as string | null,
    bandName: null as string | null,
    html: null as string | null,
    commentsShown: null as number | null,
    commentsFound: 0,
    imageUrls: [] as string[],
    accountMarker: null as string | null,
    waitedMs: 0,
    probeCounts: {} as Record<string, number>,
  };
  const countProbes = (root: ParentNode) => {
    const out: Record<string, number> = {};
    for (const [id, sel] of opts.probes) {
      try {
        out[id] = root.querySelectorAll(sel).length;
      } catch {
        out[id] = 0;
      }
    }
    return out;
  };
  const loginLike = () => /(^|\.)auth\.band\.us$/.test(location.hostname) || /\/login/.test(location.pathname) || !!document.querySelector("input[type=password]");

  // 대상 글 번호(상세 주소에서). 배경 목록과 상세 레이어가 함께 있으면 이 번호로 고른다(C06)
  const targetNo = (location.pathname.match(/\/post\/(\d+)/) ?? [])[1] ?? null;
  const linksTo = (c: Element, sel: string) =>
    Array.from(c.querySelectorAll(sel)).some((a) => new RegExp(`/post/${targetNo}(?:[/?#]|$)`).test(a.getAttribute("href") || ""));
  const pick = (): { card: Element | null; count: number; ambiguous: boolean } => {
    const all = Array.from(document.querySelectorAll(".cPostCard"));
    if (all.length <= 1) return { card: all[0] ?? null, count: all.length, ambiguous: false };
    if (targetNo) {
      // 작성자 영역의 글 주소가 가장 강한 근거, 없으면 카드 안 아무 글 주소
      for (const sel of ['.postWriterInfoWrap a[href*="/post/"]', 'a[href*="/post/"]']) {
        const hit = all.filter((c) => linksTo(c, sel));
        if (hit.length === 1) return { card: hit[0], count: all.length, ambiguous: false };
      }
    }
    const inLayer = all.filter((c) => c.closest('[role="dialog"], [aria-modal="true"], .lyPostViewer, .postViewer, .layerContainerView, .postDetailLayer, ._postDetailLayer'));
    if (inLayer.length === 1) return { card: inLayer[0], count: all.length, ambiguous: false };
    // 여러 후보 중 임의로 첫 항목을 고르지 않는다
    return { card: null, count: all.length, ambiguous: true };
  };

  let lastSig = "";
  let stableSince = 0;
  let card: Element | null = null;
  let cardCount = 0;
  let ambiguous = false;
  let hasWriter = false;
  // 준비 완료 = 작성자 영역이 보이고, 로딩 표시가 없고, 일정 시간 내용이 바뀌지 않음(C02). 카드가 있다는 것만으로는 완료가 아니다
  let ready = false;
  while (Date.now() - t0 < opts.timeoutMs) {
    if (loginLike()) return { ...base, ok: false, reason: "login", message: "로그인이 필요한 화면입니다.", waitedMs: Date.now() - t0, probeCounts: {} };
    const p = pick();
    card = p.card;
    cardCount = p.count;
    ambiguous = p.ambiguous;
    hasWriter = !!card?.querySelector(".postWriterInfoWrap, .postWriter");
    if (card && hasWriter) {
      const n = card.querySelectorAll(".cComment").length;
      const loading = Array.from(card.querySelectorAll(".uLoading, ._loading")).some((el) => (el as HTMLElement).offsetParent !== null);
      const sig = `${n}:${card.innerHTML.length}:${loading}`;
      if (sig !== lastSig) {
        lastSig = sig;
        stableSince = Date.now();
      } else if (!loading && Date.now() - stableSince >= opts.stableMs) {
        ready = true;
        break;
      }
    }
    await sleep(250);
  }
  if (ambiguous)
    return {
      ...base,
      ok: false,
      reason: "multiple",
      message: `게시글 카드가 ${cardCount}개 보이는데 대상 글을 확실히 고르지 못했습니다. 대상 글 하나만 연 상태에서 다시 시도하세요.`,
      waitedMs: Date.now() - t0,
      probeCounts: countProbes(document),
    };
  if (!card) return { ...base, ok: false, reason: "not-found", message: "게시글을 찾지 못했습니다(삭제·권한 없음·화면 구조 변경 가능).", waitedMs: Date.now() - t0, probeCounts: countProbes(document) };
  if (!ready)
    return {
      ...base,
      ok: false,
      reason: "timeout",
      message: hasWriter ? "게시글 내용이 제한 시간 안에 안정되지 않았습니다(아직 불러오는 중일 수 있음)." : "게시글 카드는 보이지만 작성자 영역이 제한 시간 안에 나타나지 않았습니다.",
      waitedMs: Date.now() - t0,
      probeCounts: countProbes(card),
    };

  const clone = card.cloneNode(true) as Element;
  // 이미지 주소는 절대 주소로(요소를 지우기 전에, 원본과 순서가 같을 때 맞춘다)
  const origImgs = Array.from(card.querySelectorAll("img"));
  Array.from(clone.querySelectorAll("img")).forEach((img, i) => {
    const abs = (origImgs[i] as HTMLImageElement | undefined)?.src || img.getAttribute("src") || "";
    img.setAttribute("src", abs);
    img.removeAttribute("srcset");
  });
  // 저장본에서 스크립트와 입력칸(숨은 값 포함)은 뺀다(24.2)
  clone.querySelectorAll("script, noscript, iframe, style, input, textarea, select, form").forEach((el) => el.remove());
  // 이벤트 속성·값 속성·파서가 쓰지 않는 data-* 속성 제거(data-viewname은 댓글 구조 판별에 쓴다)
  for (const el of [clone, ...Array.from(clone.querySelectorAll("*"))])
    for (const a of Array.from(el.attributes))
      if (/^on/i.test(a.name) || a.name === "value" || (/^data-/i.test(a.name) && a.name !== "data-viewname")) el.removeAttribute(a.name);
  const imageUrls = Array.from(new Set(Array.from(clone.querySelectorAll("img")).map((i) => i.getAttribute("src") || "").filter((s) => /^https?:/.test(s))));
  const countEl = card.querySelector(".dPostCountView .comment .count");
  const shownRaw = txt(countEl).replace(/,/g, "");
  const face = document.querySelector("img._globalFaceImage, .btnMySetting img") as HTMLImageElement | null;
  const postLink = card.querySelector('.postWriterInfoWrap a[href*="/post/"]') as HTMLAnchorElement | null;
  return {
    ok: true,
    pageUrl: location.href,
    postHref: postLink?.href ?? null,
    bandName: txt(document.querySelector(".printInfo .name, .bandName .uriText")) || null,
    html: clone.outerHTML,
    commentsShown: /^\d+$/.test(shownRaw) ? Number(shownRaw) : null,
    commentsFound: card.querySelectorAll(".cComment").length,
    imageUrls,
    accountMarker: face?.src ? face.src.split(/[?#]/)[0].split("/").pop() ?? null : null,
    waitedMs: Date.now() - t0,
    probeCounts: countProbes(card),
  };
}
