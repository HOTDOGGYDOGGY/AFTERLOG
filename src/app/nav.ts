// 앱 탐색 상태 = 주소의 해시. 새로고침하면 같은 플랫폼·글·인물·댓글로 돌아오고, 브라우저 뒤로가기가 앱 안의 이동을 되돌린다.
// 형식: #/band · #/band/post/<문서>[/<항목>] · #/band/person/<인물키> · #/band/chat · #/kakao 등
import { useCallback, useEffect, useState } from "react";
import { PLATFORMS, type PlatformId } from "./shell/platforms";

export type BandRoute =
  | { screen: "home" }
  | { screen: "post"; docId: string; entryId?: string }
  | { screen: "person"; person: string; tab?: PersonTab }
  | { screen: "chat" };
export type PersonTab = "posts" | "comments" | "stories" | "reactions";

export interface Route {
  platform: PlatformId;
  band: BandRoute;
}

const enc = encodeURIComponent;

export function formatRoute(r: Route): string {
  if (r.platform !== "band") return `#/${r.platform}`;
  const b = r.band;
  if (b.screen === "post") return `#/band/post/${enc(b.docId)}${b.entryId ? `/${enc(b.entryId)}` : ""}`;
  if (b.screen === "person") return `#/band/person/${enc(b.person)}${b.tab && b.tab !== "posts" ? `/${b.tab}` : ""}`;
  if (b.screen === "chat") return "#/band/chat";
  return "#/band";
}

export function parseRoute(hash: string, fallback: PlatformId = "band"): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
  const p = PLATFORMS.find((m) => m.id === parts[0])?.id ?? (parts[0] ? "band" : fallback);
  let band: BandRoute = { screen: "home" };
  if (p === "band") {
    if (parts[1] === "post" && parts[2]) band = { screen: "post", docId: parts[2], entryId: parts[3] || undefined };
    else if (parts[1] === "person" && parts[2]) band = { screen: "person", person: parts[2], tab: (["posts", "comments", "stories", "reactions"] as const).find((t) => t === parts[3]) };
    else if (parts[1] === "chat") band = { screen: "chat" };
  }
  return { platform: p, band };
}

const LAST_PLATFORM = "afterlog.platform";

/** 해시 경로 상태. navigate는 기본적으로 기록을 쌓아 뒤로가기로 돌아올 수 있게 한다 */
export function useRoute() {
  const [route, setRoute] = useState<Route>(() => {
    let last: PlatformId = "band";
    try {
      last = (localStorage.getItem(LAST_PLATFORM) as PlatformId) || "band";
    } catch {
      /* 무시 */
    }
    return parseRoute(location.hash, last);
  });
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("hashchange", on);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LAST_PLATFORM, route.platform);
    } catch {
      /* 무시 */
    }
  }, [route.platform]);
  const navigate = useCallback((next: Route, opts: { replace?: boolean } = {}) => {
    const h = formatRoute(next);
    if (h !== location.hash) {
      // 앱 안에서 쌓은 기록의 깊이를 남겨 '닫기'가 앱 밖으로 나가지 않게 한다
      const depth = (history.state as { alDepth?: number } | null)?.alDepth ?? 0;
      if (opts.replace) history.replaceState({ alDepth: depth }, "", h);
      else history.pushState({ alDepth: depth + 1 }, "", h);
    }
    setRoute(next);
  }, []);
  return { route, navigate };
}

/** 앱 안에서 이동해 온 기록이 있으면 뒤로가기, 없으면(주소로 바로 연 경우) false */
export function backInApp(): boolean {
  const depth = (history.state as { alDepth?: number } | null)?.alDepth ?? 0;
  if (depth > 0) {
    history.back();
    return true;
  }
  return false;
}

/** 화면별 스크롤 위치(새로고침 후에도 이 탭 안에서 복원) */
const SCROLL_KEY = "afterlog.scroll";
export function saveScroll(key: string, top: number) {
  try {
    const m = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "{}");
    m[key] = Math.round(top);
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(m));
  } catch {
    /* 무시 */
  }
}
export function loadScroll(key: string): number | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "{}")[key];
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}
