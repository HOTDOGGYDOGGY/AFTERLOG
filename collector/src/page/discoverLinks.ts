// 목록 화면(밴드 글 목록·멤버 작성글 목록)에서 글 주소를 모으는 함수. 페이지에 주입된다(자체 완결형).
// 한 번 호출 = 한 회차: 지금 보이는 글 링크를 모으고, 끝까지 스크롤한 뒤 새로 로딩될 때까지 잠깐 기다린다.

export interface DiscoverRound {
  links: string[];
  scrollHeight: number;
  loading: boolean;
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
  const loading = Array.from(document.querySelectorAll(".uLoading, ._loading, [class*='loading']")).some((el) => (el as HTMLElement).offsetParent !== null);
  return {
    links: Array.from(new Set([...before, ...after])),
    scrollHeight: document.documentElement.scrollHeight,
    loading,
    endMarker: false,
    loginRequired: /(^|\.)auth\.band\.us$/.test(location.hostname) || !!document.querySelector("input[type=password]"),
  };
}
