// 선택 영역의 일반화한 구조 표본(명세 v1.1 20.5). 페이지 안에서 실행된다(자체 완결형).
// 태그는 허용 목록으로, 역할은 표준 role만, 텍스트는 '있음' 여부만. class/id/속성 원문·주소·글자는 넣지 않는다.
// 같은 모양의 반복 행은 대표 1개 + 반복 구간으로 줄인다. 깊이 8, 노드 150 상한.

export function sampleStructureInPage(args: {
  scope: "postCard" | "main";
  probes: [string, string][];
  tags: string[];
  roles: string[];
  maxDepth: number;
  maxNodes: number;
}) {
  const root =
    args.scope === "postCard"
      ? document.querySelector(".cPostCard") ?? document.querySelector("main, [role=main]") ?? document.body
      : document.querySelector("main, [role=main]") ?? document.body;
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
