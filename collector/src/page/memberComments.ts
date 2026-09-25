// 멤버 댓글 목록(작성댓글) 화면에서 실행되는 함수들. 페이지에 주입되므로 자체 완결형으로 유지한다(바깥 변수·import 금지).
// 실제 저장 샘플 기준 구조: [data-viewname=DBandMemberCommentListView] > a.cCommentOnly > p.comment(댓글) · p.body(원글 발췌) · p.date
// 원글 레이어의 닫기 버튼(샘플): button.btnCloseLyPost._btnClose
// 목록 항목에는 원글 주소가 없다(href가 목록 자신). 원글은 항목을 누르면 레이어로 열리고, 레이어의 작성자 링크에 글 번호가 있다.
// 쓰기 동작은 하지 않는다. 누르는 곳은 항목의 원글 발췌(p.body)뿐이며, 선택용 체크박스(label·input)는 절대 누르지 않는다.

export interface MemberCommentItem {
  seq: number;
  html: string;
  text: string;
  excerpt: string;
  dateText: string;
}

export interface MemberCommentsRound {
  /** 댓글 목록 영역을 찾았는지 */
  listFound: boolean;
  memberName: string | null;
  /** 지금 목록에 있는 항목 수 */
  total: number;
  /** seq >= from 인 항목 */
  items: MemberCommentItem[];
  loading: boolean;
  atBottom: boolean;
  loginRequired: boolean;
}

export async function readMemberCommentsInPage(opts: { from: number; waitMs: number; scroll: boolean }): Promise<MemberCommentsRound> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const loginRequired = /(^|\.)auth\.band\.us$/.test(location.hostname) || !!document.querySelector("input[type=password]");
  const list = document.querySelector('[data-viewname="DBandMemberCommentListView"]');
  const memberName = txt(document.querySelector(".accountSectionHeader .title .sf_color")) || null;
  if (opts.scroll && list) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(opts.waitMs);
  }
  const all = list ? Array.from(list.querySelectorAll(".cCommentOnly")) : [];
  const clean = (el: Element) => {
    const c = el.cloneNode(true) as Element;
    c.querySelectorAll("label, input, script, style, iframe, button, form").forEach((x) => x.remove());
    for (const n of [c, ...Array.from(c.querySelectorAll("*"))])
      for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name) || a.name === "href" || a.name === "value" || (/^data-/i.test(a.name) && a.name !== "data-viewname")) n.removeAttribute(a.name);
    return c.outerHTML;
  };
  const items = all.slice(opts.from).map((el, i) => ({
    seq: opts.from + i,
    html: clean(el),
    text: txt(el.querySelector("p.comment")),
    excerpt: txt(el.querySelector("p.body")),
    dateText: txt(el.querySelector("p.date")),
  }));
  const vh = window.innerHeight || 800;
  const loading = Array.from(document.querySelectorAll(".uLoading, ._loading, ._listLoading, .loadingWrap")).some((el) => {
    const h = el as HTMLElement;
    if (h.offsetParent === null) return false;
    const r = h.getBoundingClientRect();
    return r.height > 0 && r.top < vh + 200 && r.bottom > vh * 0.3;
  });
  return {
    listFound: !!list,
    memberName,
    total: all.length,
    items,
    loading,
    atBottom: window.scrollY + vh >= document.documentElement.scrollHeight - 80,
    loginRequired,
  };
}

export interface OpenCommentPostResult {
  ok: boolean;
  postNo?: string;
  /** moved: 목록이 바뀌어 같은 항목이 아님 · noLayer: 눌러도 원글이 열리지 않음 · noPostNo: 글 번호를 못 찾음 */
  reason?: "moved" | "noLayer" | "noPostNo";
  /** 레이어를 닫았는지(못 닫으면 다음 항목 전에 목록을 다시 연다) */
  closed: boolean;
}

export async function openCommentPostInPage(opts: { seq: number; expectText: string; expectDate: string; bandNo: string; timeoutMs: number }): Promise<OpenCommentPostResult> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const list = document.querySelector('[data-viewname="DBandMemberCommentListView"]');
  const el = list ? list.querySelectorAll(".cCommentOnly")[opts.seq] : undefined;
  if (!el || txt(el.querySelector("p.comment")) !== opts.expectText || txt(el.querySelector("p.date")) !== opts.expectDate) return { ok: false, reason: "moved", closed: true };
  const LAYER = '[role="dialog"], [aria-modal="true"], .layerContainerView, .lyPostViewer, .postDetailLayer';
  const re = new RegExp(`/band/${opts.bandNo}/post/(\\d+)(?:[/?#]|$)`);
  const layerCard = () => Array.from(document.querySelectorAll(".cPostCard")).find((c) => c.closest(LAYER)) ?? null;
  const postNoOf = (card: Element) => {
    for (const a of Array.from(card.querySelectorAll('.postWriterInfoWrap a[href*="/post/"], a[href*="/post/"]'))) {
      const m = (new URL((a as HTMLAnchorElement).href, location.href).pathname + "/").match(re);
      if (m) return m[1];
    }
    return null;
  };
  const before = layerCard();
  const beforeNo = before ? postNoOf(before) : null;
  const path0 = location.pathname;
  // 원글 발췌를 누른다(체크박스·라벨이 아닌 곳)
  const target = (el.querySelector("p.body") ?? el.querySelector("p.comment")) as HTMLElement | null;
  if (!target) return { ok: false, reason: "noLayer", closed: true };
  target.click();
  const t0 = Date.now();
  let postNo: string | null = null;
  while (Date.now() - t0 < opts.timeoutMs) {
    const card = layerCard();
    const no = card ? postNoOf(card) : null;
    const byPath = (location.pathname + "/").match(re);
    if (no && (card !== before || no !== beforeNo)) {
      postNo = no;
      break;
    }
    if (byPath && location.pathname !== path0) {
      postNo = byPath[1];
      break;
    }
    await sleep(150);
  }
  // 닫기: 레이어의 닫기 버튼 → Esc → (주소가 바뀌었으면) 뒤로
  const close = async () => {
    const btn = document.querySelector(
      `${LAYER.split(", ").map((s) => `${s} ._btnClose, ${s} .btnCloseLyPost, ${s} ._btnLyClose, ${s} .btnLyClose, ${s} .btnClose, ${s} button[aria-label*="닫기"]`).join(", ")}`,
    ) as HTMLElement | null;
    if (btn) btn.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    for (let i = 0; i < 20 && layerCard(); i++) await sleep(100);
    if (layerCard() && location.pathname !== path0) {
      history.back();
      for (let i = 0; i < 20 && layerCard(); i++) await sleep(100);
    }
    return !layerCard();
  };
  const closed = await close();
  if (!postNo) return { ok: false, reason: layerCard() || before ? "noPostNo" : "noLayer", closed };
  return { ok: true, postNo, closed };
}
