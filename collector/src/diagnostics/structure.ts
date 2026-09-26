// 선택 영역의 일반화한 구조 표본(명세 v1.1 20.5). 페이지 안에서 실행된다(자체 완결형).
// 태그는 허용 목록으로, 역할은 표준 role만, 텍스트는 '있음' 여부만. class/id/속성 원문·주소·글자는 넣지 않는다.
// 같은 모양의 반복 행은 대표 1개 + 반복 구간으로 줄인다. 깊이 8, 노드 150 상한.
// 대상 범위(글 카드)를 못 찾으면 main/body로 넓히지 않고 scopeMissing으로 끝낸다(C04).

export function sampleStructureInPage(args: {
  scope: "postCard" | "profile";
  probes: [string, string][];
  tags: string[];
  roles: string[];
  maxDepth: number;
  maxNodes: number;
}) {
  // 글 추출과 같은 규칙으로 대상 카드 하나를 고른다(C06). 여러 개인데 못 고르면 범위 없음
  const targetNo = ((globalThis.location?.pathname ?? "").match(/\/post\/(\d+)/) ?? [])[1] ?? null;
  // 글 주소를 바로 연 화면에는 .cPostCard가 없다: 작성자 영역을 하나만 품고 댓글(없으면 본문)까지 품는 가장 가까운 요소
  const scopeFromWriter = (w: Element): Element | null => {
    let bodyHit: Element | null = null;
    for (let a = w.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (a.querySelectorAll(".postWriterInfoWrap").length !== 1) break;
      if (a.querySelector(".dPostCommentMainView, .sCommentList")) return a;
      if (!bodyHit && a.querySelector(".postBody, .txtBody")) bodyHit = a;
    }
    return bodyHit;
  };
  // 프로필 화면: 열린 스토리 상세 → 프로필 본문 → 팝업 순. 없으면 넓히지 않는다
  let profileRoot: Element | null = null;
  if (args.scope === "profile") {
    const vis = (el: Element) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const st = n.ownerDocument?.defaultView?.getComputedStyle(n);
        if (st && (st.display === "none" || st.visibility === "hidden")) return false;
      }
      return true;
    };
    const pick = (sel: string) => Array.from(document.querySelectorAll(sel)).filter(vis);
    const cand = [pick("[data-viewname='DProfileStoryDetailView']"), pick("[data-viewname='DProfileMainLayoutView'], [data-viewname='DProfileView']"), pick("[data-viewname='DProfileLayerView']")].find((x) => x.length);
    if (!cand) return { scopeMissing: true as const };
    profileRoot = cand[0];
  }
  let cards = profileRoot ? [profileRoot] : Array.from(document.querySelectorAll(".cPostCard"));
  if (!cards.length && !profileRoot)
    cards = Array.from(document.querySelectorAll(".postWriterInfoWrap"))
      .map(scopeFromWriter)
      .filter((c, i, a): c is Element => !!c && a.indexOf(c) === i);
  let root: Element | null = cards.length === 1 ? cards[0] : null;
  if (!root && cards.length > 1 && targetNo) {
    const re = new RegExp(`/post/${targetNo}(?:[/?#]|$)`);
    for (const sel of ['.postWriterInfoWrap a[href*="/post/"]', 'a[href*="/post/"]']) {
      const hit = cards.filter((c) => Array.from(c.querySelectorAll(sel)).some((a) => re.test(a.getAttribute("href") || "")));
      if (hit.length === 1) {
        root = hit[0];
        break;
      }
    }
  }
  if (!root && cards.length > 1) {
    const inLayer = cards.filter((c) => c.closest('[role="dialog"], [aria-modal="true"], .lyPostViewer, .postViewer, .layerContainerView, .postDetailLayer, ._postDetailLayer'));
    if (inLayer.length === 1) root = inLayer[0];
  }
  if (!root) return { scopeMissing: true as const };
  let counter = 0;
  const probeOf = (el: Element) => args.probes.filter(([, sel]) => {
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  }).map(([id]) => id);
  const tagOf = (el: Element) => {
    const t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) return "h";
    if (t === "input" || t === "textarea" || t === "select") return "field";
    if (t.includes("-")) return "custom";
    return args.tags.includes(t) ? t : "other";
  };
  const bucket = (n: number) => (n <= 0 ? "0" : n === 1 ? "1" : n <= 5 ? "2to5" : n <= 20 ? "6to20" : n <= 100 ? "21to100" : "gt100");
  type N = { n: number; tag: string; role?: string; probes?: string[]; text?: boolean; media?: string; repeat?: string; truncated?: boolean; c?: N[] };
  const shape = (el: Element, d: number): string =>
    d > 3 ? tagOf(el) : `${tagOf(el)}(${Array.from(el.children).map((c) => shape(c, d + 1)).join(",")})`;
  const build = (el: Element, depth: number): N | null => {
    if (counter >= args.maxNodes) return null;
    const node: N = { n: ++counter, tag: tagOf(el) };
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role && args.roles.includes(role)) node.role = role;
    const p = probeOf(el);
    if (p.length) node.probes = p;
    if (Array.from(el.childNodes).some((c) => c.nodeType === 3 && (c.nodeValue ?? "").trim())) node.text = true;
    const tag = el.tagName.toLowerCase();
    if (tag === "img") node.media = "img";
    else if (tag === "a") node.media = "link";
    else if (tag === "video") node.media = "video";
    else if (tag === "audio") node.media = "audio";
    else if (node.tag === "field") node.media = "field";
    // 입력칸 안은 들여다보지 않는다
    if (node.tag === "field") return node;
    const kids = Array.from(el.children).filter((c) => !/^(script|style|noscript|template)$/i.test(c.tagName));
    if (!kids.length) return node;
    if (depth >= args.maxDepth) {
      node.truncated = true;
      return node;
    }
    const out: N[] = [];
    for (let i = 0; i < kids.length; ) {
      const s = shape(kids[i], 0);
      let j = i + 1;
      while (j < kids.length && shape(kids[j], 0) === s) j++;
      const child = build(kids[i], depth + 1);
      if (!child) {
        node.truncated = true;
        break;
      }
      if (j - i > 1) child.repeat = bucket(j - i);
      out.push(child);
      i = j;
    }
    if (out.length) node.c = out;
    return node;
  };
  return build(root, 1);
}
