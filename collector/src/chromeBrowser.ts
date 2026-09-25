// chrome API로 동작하는 수집 브라우저. 수집 관리 페이지(확장 페이지)에서 쓴다.
// 수집 전용 창을 하나 열고 그 안에서만 이동한다. 사용자의 탭(tabId)은 이동시키지 않고 읽기만 한다.
import { BAND_ORIGINS, LIMITS, MIN_DELAY_MS } from "./config";
import { BrowserError, fetchImage, type CollectorBrowser } from "./browser";
import { extractPostInPage, type PostExtraction } from "./page/extractPost";
import { discoverRoundInPage, type DiscoverRound } from "./page/discoverLinks";
import { sampleStructureInPage } from "./diagnostics/structure";
import { POST_PROBES } from "./diagnostics/probes";
import { STRUCT_ROLES, STRUCT_TAGS } from "./diagnostics/schema";
import { STRUCT_LIMITS } from "./diagnostics/serializer";

export class ChromeBrowser implements CollectorBrowser {
  private windowId: number | null = null;
  private tabId: number | null = null;

  private async collectTab(): Promise<number> {
    if (this.tabId !== null) {
      try {
        await chrome.tabs.get(this.tabId);
        return this.tabId;
      } catch {
        this.tabId = null;
      }
    }
    // 백그라운드 탭은 화면 갱신이 멈출 수 있어, 초점을 뺏지 않는 별도 창을 쓴다
    const w = await chrome.windows.create({ url: "about:blank", focused: false, width: 1100, height: 900, type: "normal" });
    this.windowId = w?.id ?? null;
    this.tabId = w?.tabs?.[0]?.id ?? null;
    if (this.tabId === null) throw new BrowserError("other", "수집용 창을 열지 못했습니다.");
    return this.tabId;
  }

  private async navigate(url: string): Promise<{ tabId: number; ms: number }> {
    const tabId = await this.collectTab();
    const t0 = Date.now();
    await chrome.tabs.update(tabId, { url });
    const deadline = t0 + LIMITS.pageTimeoutMs;
    await new Promise((r) => setTimeout(r, 300));
    for (;;) {
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        this.tabId = null;
        throw new BrowserError("tabClosed", "수집용 창이 닫혔습니다. 이어받기를 누르면 다시 엽니다.");
      }
      if (tab.status === "complete" && tab.url && tab.url !== "about:blank") {
        const origin = new URL(tab.url).origin;
        if (!BAND_ORIGINS.includes(origin)) {
          if (/auth\.band\.us|nid\.naver\.com|login/i.test(tab.url)) throw new BrowserError("loginRequired", "밴드에 로그인해야 합니다.");
          throw new BrowserError("navigationFailed", "밴드가 아닌 곳으로 이동했습니다.");
        }
        return { tabId, ms: Date.now() - t0 };
      }
      if (Date.now() > deadline) throw new BrowserError("loadTimeout", "페이지가 제시간에 열리지 않았습니다.");
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  private async exec<A extends unknown[], R>(tabId: number, func: (...args: A) => Promise<R> | R, args: A): Promise<R> {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: func as never, args: args as never, world: "ISOLATED" });
    if (!res) throw new BrowserError("other", "페이지에서 스크립트를 실행하지 못했습니다.");
    return res.result as R;
  }

  async extractPost(target: { url?: string; tabId?: number }) {
    let tabId: number;
    let ms = 0;
    if (target.tabId !== undefined) tabId = target.tabId;
    else ({ tabId, ms } = await this.navigate(target.url!));
    const ex = await this.exec<[{ timeoutMs: number; stableMs: number; probes: [string, string][] }], PostExtraction>(tabId, extractPostInPage, [
      { timeoutMs: LIMITS.pageTimeoutMs, stableMs: Math.max(750, MIN_DELAY_MS), probes: POST_PROBES },
    ]);
    return { ex, loadMs: ms + ex.waitedMs };
  }

  async openList(url: string) {
    await this.navigate(url);
    await new Promise((r) => setTimeout(r, MIN_DELAY_MS));
  }

  async discoverRound(bandNo: string): Promise<DiscoverRound> {
    const tabId = await this.collectTab();
    return this.exec<[{ bandNo: string; waitMs: number }], DiscoverRound>(tabId, discoverRoundInPage, [{ bandNo, waitMs: Math.max(1000, MIN_DELAY_MS) }]);
  }

  async sampleStructure(target: { url?: string; tabId?: number }) {
    const tabId = target.tabId ?? (await this.collectTab());
    return this.exec(tabId, sampleStructureInPage, [
      { scope: "postCard", probes: POST_PROBES, tags: [...STRUCT_TAGS], roles: [...STRUCT_ROLES], maxDepth: STRUCT_LIMITS.maxDepth, maxNodes: STRUCT_LIMITS.maxNodes },
    ] as [Parameters<typeof sampleStructureInPage>[0]]);
  }

  fetchAsset(url: string) {
    return fetchImage(url);
  }

  async dispose() {
    if (this.windowId !== null) await chrome.windows.remove(this.windowId).catch(() => undefined);
    this.windowId = null;
    this.tabId = null;
  }
}
