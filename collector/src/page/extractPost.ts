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

  let lastSig = "";
  let stableSince = 0;
  let card: Element | null = null;
  while (Date.now() - t0 < opts.timeoutMs) {
    if (loginLike()) return { ...base, ok: false, reason: "login", message: "로그인이 필요한 화면입니다.", waitedMs: Date.now() - t0, probeCounts: {} };
    const cards = document.querySelectorAll(".cPostCard");
    if (cards.length > 1)
      return { ...base, ok: false, reason: "multiple", message: `게시글 카드가 ${cards.length}개 보입니다. 대상 글을 하나만 연 상태에서 다시 시도하세요.`, waitedMs: Date.now() - t0, probeCounts: countProbes(document) };
    card = cards[0] ?? null;
    if (card && card.querySelector(".postWriterInfoWrap, .postWriter")) {
      const n = card.querySelectorAll(".cComment").length;
      const loading = Array.from(card.querySelectorAll(".uLoading, ._loading")).some((el) => (el as HTMLElement).offsetParent !== null);
      const sig = `${n}:${card.innerHTML.length}:${loading}`;
      if (sig !== lastSig) {
        lastSig = sig;
        stableSince = Date.now();
      } else if (!loading && Date.now() - stableSince >= opts.stableMs) break;
    }
    await sleep(250);
  }
  if (!card) return { ...base, ok: false, reason: "not-found", message: "게시글을 찾지 못했습니다(삭제·권한 없음·화면 구조 변경 가능).", waitedMs: Date.now() - t0, probeCounts: countProbes(document) };

  const clone = card.cloneNode(true) as Element;
  // 저장본에서 스크립트·이벤트 속성 제거, 이미지 주소는 절대 주소로
  clone.querySelectorAll("script, noscript, iframe, style").forEach((el) => el.remove());
  const walker = [clone, ...Array.from(clone.querySelectorAll("*"))];
  for (const el of walker) for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
  const origImgs = Array.from(card.querySelectorAll("img"));
  Array.from(clone.querySelectorAll("img")).forEach((img, i) => {
    const abs = (origImgs[i] as HTMLImageElement | undefined)?.src || img.getAttribute("src") || "";
    img.setAttribute("src", abs);
    img.removeAttribute("srcset");
  });
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
