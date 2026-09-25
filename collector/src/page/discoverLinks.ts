// 목록 화면(밴드 글 목록·멤버 작성글 목록)에서 글 주소를 모으는 함수. 페이지에 주입된다(자체 완결형).
// 한 번 호출 = 한 회차: 지금 보이는 글 링크를 모으고, 끝까지 스크롤한 뒤 새로 로딩될 때까지 잠깐 기다린다.

export interface DiscoverRound {
  links: string[];
  scrollHeight: number;
  /** 목록 아래쪽에 로딩 표시가 보이는지(좁은 기준. 넓게 잡으면 끝나지 않는 문제가 있었다) */
  loading: boolean;
  /** 스크롤이 문서 끝에 닿았는지 */
  atBottom: boolean;
  /** 명시적인 끝 표시를 찾았는지(검증된 표시가 없으면 false) */
  endMarker: boolean;
  loginRequired: boolean;
}

export async function discoverRoundInPage(opts: { bandNo: string; waitMs: number }): Promise<DiscoverRound> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const re = new RegExp(`/band/${opts.bandNo}/post/(\\d+)(?:[/?#]|$)`);
  const collect = () =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((h) => re.test(new URL(h, location.href).pathname + "/"))
      .map((h) => {
        const u = new URL(h, location.href);
        const m = u.pathname.match(re) ?? (u.pathname + "/").match(re);
        return `${u.origin}/band/${opts.bandNo}/post/${m![1]}`;
      });
  const before = collect();
  window.scrollTo(0, document.documentElement.scrollHeight);
  await sleep(opts.waitMs);
  const after = collect();
  // 로딩 표시: 밴드가 쓰는 좁은 클래스만, 그리고 화면 아래쪽(목록 끝 근처)에 실제로 보일 때만.
  // 예전의 [class*='loading']은 이미지 지연 로딩 등 항상 보이는 요소까지 잡아 목록 끝을 영영 인정하지 않았다.
  const vh = window.innerHeight || 800;
  const loading = Array.from(document.querySelectorAll(".uLoading, ._loading, ._listLoading, .loadingWrap")).some((el) => {
    const h = el as HTMLElement;
    if (h.offsetParent === null) return false;
    const r = h.getBoundingClientRect();
    return r.height > 0 && r.top < vh + 200 && r.bottom > vh * 0.3;
  });
  const atBottom = window.scrollY + vh >= document.documentElement.scrollHeight - 80;
  return {
    links: Array.from(new Set([...before, ...after])),
    scrollHeight: document.documentElement.scrollHeight,
    loading,
    atBottom,
    endMarker: false,
    loginRequired: /(^|\.)auth\.band\.us$/.test(location.hostname) || !!document.querySelector("input[type=password]"),
  };
}
