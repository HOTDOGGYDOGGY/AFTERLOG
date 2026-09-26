// 인물 화면 '사진' 탭(/band/N/member/KEY/photo)에서 실행. 페이지에 주입되므로 자체 완결형.
// 실제 저장 표본 구조: [DBandMemberPhotoLayoutView] > [DBandMemberPhotoListView] > [DBandMemberPhotoListItemView] a._link img._img.
// 끝까지 스크롤해 목록을 모두 불러온 뒤 사진 주소만 읽는다. 사진을 누르지 않는다.
export interface MemberPhotosRead {
  ok: boolean;
  reason?: "login" | "notFound";
  /** 밴드가 사진이 없다고 표시함 */
  empty: boolean;
  srcs: string[];
  rounds: number;
}

export async function readMemberPhotosInPage(opts: { waitMs: number; readyMs: number; maxRounds: number }): Promise<MemberPhotosRead> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  if (/(^|\.)auth\.band\.us$/.test(location.hostname) || document.querySelector("input[type=password]")) return { ok: false, reason: "login", empty: false, srcs: [], rounds: 0 };
  const layout = () => document.querySelector("[data-viewname='DBandMemberPhotoLayoutView']");
  const items = () => Array.from(document.querySelectorAll("[data-viewname='DBandMemberPhotoListItemView']"));
  for (const t0 = Date.now(); Date.now() - t0 < opts.readyMs && !items().length && !layout()?.querySelector(".uEmpty"); ) await sleep(250);
  if (!layout()) return { ok: false, reason: "notFound", empty: false, srcs: [], rounds: 0 };
  let rounds = 0;
  let same = 0;
  let last = -1;
  while (rounds < opts.maxRounds && same < 3) {
    // 마지막 사진을 보이게 한 뒤 맨 아래까지(더 불러오기는 목록 끝이 보일 때 일어난다)
    const lastItem = items().at(-1) as HTMLElement | undefined;
    if (lastItem && typeof lastItem.scrollIntoView === "function") lastItem.scrollIntoView({ block: "end" });
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(opts.waitMs);
    const n = items().length;
    same = n === last ? same + 1 : 0;
    last = n;
    rounds++;
  }
  // 늦게 불러오는 사진(src가 비어 있음)은 하나씩 화면에 보여 준 뒤 읽는다
  for (const li of items()) {
    const im = li.querySelector("img") as HTMLImageElement | null;
    if (im && !(im.currentSrc || im.getAttribute("src"))) {
      (li as HTMLElement).scrollIntoView?.({ block: "center" });
      await sleep(200);
    }
  }
  const srcs = items()
    .map((li) => {
      const im = li.querySelector("img") as HTMLImageElement | null;
      return im?.currentSrc || im?.src || im?.getAttribute("data-src") || "";
    })
    .filter((u) => /^https?:/.test(u));
  window.scrollTo(0, 0);
  return { ok: true, empty: !items().length && !!layout()?.querySelector(".uEmpty"), srcs: [...new Set(srcs)], rounds };
}
