// chrome API로 동작하는 수집 브라우저. 수집 관리 페이지(확장 페이지)에서 쓴다.
// 수집 전용 창(목록용·글용)을 열고 그 안에서만 이동한다. 사용자의 탭(tabId)은 이동시키지 않고 읽기만 한다.
import { BAND_ORIGINS, LIMITS, MIN_DELAY_MS } from "./config";
import { BrowserError, fetchImage, type CollectorBrowser, type TabRole } from "./browser";
import { captureProfileInPage, type ProfileExtraction } from "./page/profile";
import { captureProfilePopupInPage, type ProfilePopupExtraction } from "./page/profilePopup";
import { resolvePopupMemberInPage, type PopupMemberResult } from "./page/popupMember";
import { readMemberPhotosInPage, type MemberPhotosRead } from "./page/memberPhotos";
import { readProfileScreenInPage, type ProfileScreenRead } from "./page/profileScreen";
import { openCommentPostInPage, readMemberCommentsInPage, type MemberCommentsRound, type OpenCommentPostResult } from "./page/memberComments";
import { extractPostInPage, type PostExtraction } from "./page/extractPost";
import { discoverRoundInPage, type DiscoverRound } from "./page/discoverLinks";
import { sampleStructureInPage } from "./diagnostics/structure";
import { POST_PROBES, PROFILE_PROBES } from "./diagnostics/probes";
import { STRUCT_ROLES, STRUCT_TAGS } from "./diagnostics/schema";
import { STRUCT_LIMITS } from "./diagnostics/serializer";

export class ChromeBrowser implements CollectorBrowser {
  // 역할별 창·탭(선택 수집 명세 7.2): 목록·댓글 목록을 훑는 탭(discover)과 글을 여는 탭(body)을 나눠,
  // 한쪽의 이동이 다른 쪽이 읽는 페이지를 바꾸지 않게 한다. 각 탭 안에서는 엔진이 한 번에 하나만 실행한다.
  private windows: Record<TabRole, number | null> = { discover: null, body: null };
  private tabs: Record<TabRole, number | null> = { discover: null, body: null };

  private async collectTab(role: TabRole): Promise<number> {
    const cur = this.tabs[role];
    if (cur !== null) {
      try {
        await chrome.tabs.get(cur);
        return cur;
      } catch {
        this.tabs[role] = null;
      }
    }
    // 백그라운드 탭은 화면 갱신이 멈출 수 있어(무한 스크롤이 안 불러와짐), 역할마다 초점을 뺏지 않는 별도 창을 쓴다
    const w = await chrome.windows.create({ url: "about:blank", focused: false, width: 1100, height: 900, type: "normal" });
    this.windows[role] = w?.id ?? null;
    const tabId = w?.tabs?.[0]?.id ?? null;
    if (tabId === null) throw new BrowserError("other", "수집용 창을 열지 못했습니다.");
    this.tabs[role] = tabId;
    // 오래 뒤에 있는 창이라 크롬의 메모리 절약 기능이 탭을 비우면 읽던 페이지가 사라진다(Frame … was removed)
    await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => undefined);
    return tabId;
  }

  private forget(tabId: number) {
    for (const r of ["discover", "body"] as const) if (this.tabs[r] === tabId) this.tabs[r] = null;
  }

  private async navigate(url: string, role: TabRole): Promise<{ tabId: number; ms: number }> {
    const tabId = await this.collectTab(role);
    const t0 = Date.now();
    await chrome.tabs.update(tabId, { url });
    const deadline = t0 + LIMITS.pageTimeoutMs;
    await new Promise((r) => setTimeout(r, 300));
    for (;;) {
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        this.forget(tabId);
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

  /**
   * 페이지에서 함수 실행. 크롬이 탭을 비우거나 페이지가 새로 고쳐져 프레임이 사라지면(Frame with ID 0 was removed 등)
   * 페이지가 다시 준비될 때까지 기다렸다가 두 번까지 다시 시도한다.
   */
  private async exec<A extends unknown[], R>(tabId: number, func: (...args: A) => Promise<R> | R, args: A): Promise<R> {
    for (let attempt = 0; ; attempt++) {
      try {
        const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: func as never, args: args as never, world: "ISOLATED" });
        if (!res) throw new BrowserError("other", "페이지에서 스크립트를 실행하지 못했습니다.");
        return res.result as R;
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        const gone = /Frame with ID \d+ was removed|No frame with id|frame was removed|was discarded|The tab was closed|No tab with id|Cannot access contents of the page/i.test(msg);
        if (!gone) throw e;
        if (attempt >= 2)
          throw new BrowserError("frameGone", "수집 창의 페이지가 사라졌습니다(크롬이 탭을 정리했거나 페이지가 새로 고쳐짐). 이어받기를 누르면 이어서 합니다.");
        await this.waitReady(tabId);
      }
    }
  }

  /** 탭이 다시 불러와질 때까지(최대 페이지 제한 시간) */
  private async waitReady(tabId: number) {
    const deadline = Date.now() + LIMITS.pageTimeoutMs;
    await new Promise((r) => setTimeout(r, 800));
    for (;;) {
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        this.forget(tabId);
        throw new BrowserError("tabClosed", "수집용 창이 닫혔습니다. 이어받기를 누르면 다시 엽니다.");
      }
      if (tab.discarded) await chrome.tabs.reload(tabId).catch(() => undefined);
      else if (tab.status === "complete") return;
      if (Date.now() > deadline) throw new BrowserError("loadTimeout", "페이지가 제시간에 다시 열리지 않았습니다.");
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async extractPost(target: { url?: string; tabId?: number }) {
    let tabId: number;
    let ms = 0;
    if (target.tabId !== undefined) tabId = target.tabId;
    else ({ tabId, ms } = await this.navigate(target.url!, "body"));
    const ex = await this.exec<[{ timeoutMs: number; stableMs: number; probes: [string, string][]; expandMs: number }], PostExtraction>(tabId, extractPostInPage, [
      { timeoutMs: LIMITS.pageTimeoutMs, stableMs: Math.max(750, MIN_DELAY_MS), probes: POST_PROBES, expandMs: LIMITS.expandMs },
    ]);
    // 이동 뒤에 다른 글로 바뀌었으면(프레임 교체 등) 저장하지 않는다(F11)
    if (ex.ok && target.url) {
      const want = target.url.match(/\/post\/(\d+)/)?.[1];
      const got = (ex.postHref ?? ex.pageUrl).match(/\/post\/(\d+)/)?.[1];
      if (want && got && want !== got) throw new BrowserError("frameGone", "읽는 사이 다른 글로 바뀌어 저장하지 않았습니다. 다시 시도합니다.");
    }
    return { ex, loadMs: ms + ex.waitedMs };
  }

  async openList(url: string) {
    await this.navigate(url, "discover");
    await new Promise((r) => setTimeout(r, MIN_DELAY_MS));
  }

  async discoverRound(bandNo: string): Promise<DiscoverRound> {
    const tabId = await this.collectTab("discover");
    return this.exec<[{ bandNo: string; waitMs: number }], DiscoverRound>(tabId, discoverRoundInPage, [{ bandNo, waitMs: Math.max(1000, MIN_DELAY_MS) }]);
  }

  async readMemberComments(opts: { from: number; scroll: boolean }): Promise<MemberCommentsRound> {
    const tabId = await this.collectTab("discover");
    return this.exec<[{ from: number; waitMs: number; scroll: boolean }], MemberCommentsRound>(tabId, readMemberCommentsInPage, [
      { from: opts.from, scroll: opts.scroll, waitMs: Math.max(1000, MIN_DELAY_MS) },
    ]);
  }

  async openCommentPost(opts: { seq: number; expectText: string; expectDate: string; bandNo: string }): Promise<OpenCommentPostResult> {
    const tabId = await this.collectTab("discover");
    return this.exec<[{ seq: number; expectText: string; expectDate: string; bandNo: string; timeoutMs: number }], OpenCommentPostResult>(tabId, openCommentPostInPage, [
      { ...opts, timeoutMs: Math.min(LIMITS.pageTimeoutMs, 15_000) },
    ]);
  }

  async captureProfile(url: string) {
    const { tabId, ms } = await this.navigate(url, "body");
    const t0 = Date.now();
    const ex = await this.exec<Parameters<typeof captureProfileInPage>, ProfileExtraction>(tabId, captureProfileInPage, [
      { waitMs: Math.max(1000, MIN_DELAY_MS), maxRounds: 200, maxCssBytes: 3 * 1024 * 1024, readyMs: LIMITS.pageTimeoutMs, openStories: true, storyMs: 60_000, storiesTotalMs: LIMITS.expandMs, probes: PROFILE_PROBES },
    ]);
    return { ex, loadMs: ms + (Date.now() - t0) };
  }

  /**
   * 팝업의 인물 주소 알아내기: 사용자 탭에서 '스토리 보기'(없으면 '작성글 보기')만 눌러 바뀐 주소를 읽고, 사용자 화면은 뒤로 돌려 둔다.
   * 누른 뒤 페이지가 통째로 바뀌면 주입 스크립트가 끊기므로 탭 주소로 확인한다. 다시 누르지 않도록 재시도하지 않는다.
   */
  async resolvePopupMember(tabId: number): Promise<PopupMemberResult> {
    const timeoutMs = 10_000;
    const startUrl = (await chrome.tabs.get(tabId)).url ?? "";
    let res: PopupMemberResult | null = null;
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: resolvePopupMemberInPage as never, args: [{ timeoutMs }] as never, world: "ISOLATED" });
      res = (r?.result as PopupMemberResult | undefined) ?? null;
    } catch {
      res = null; // 페이지가 바뀌며 스크립트가 끊김: 아래에서 탭 주소로 확인
    }
    if (res && !res.ok && res.reason !== "noChange") return res;
    let memberUrl = res?.memberUrl ?? null;
    for (const t0 = Date.now(); !memberUrl && Date.now() - t0 < timeoutMs; ) {
      await new Promise((r) => setTimeout(r, 200));
      const u = (await chrome.tabs.get(tabId)).url ?? "";
      if (u !== startUrl && /\/member\/[^/?#]+/.test(new URL(u).pathname)) memberUrl = u;
    }
    // 사용자가 보던 화면으로 되돌린다
    if ((await chrome.tabs.get(tabId)).url !== startUrl) await chrome.tabs.goBack(tabId).catch(() => undefined);
    if (!memberUrl) return { ok: false, reason: "noChange", memberUrl: null, via: res?.via ?? null, name: res?.name ?? null, startUrl };
    return { ok: true, memberUrl, via: res?.via ?? null, name: res?.name ?? null, startUrl };
  }

  async readMemberPhotos(url: string) {
    const { tabId } = await this.navigate(url, "body");
    return this.exec<Parameters<typeof readMemberPhotosInPage>, MemberPhotosRead>(tabId, readMemberPhotosInPage, [{ waitMs: Math.max(1000, MIN_DELAY_MS), readyMs: LIMITS.pageTimeoutMs, maxRounds: 200 }]);
  }

  /** '직접 열며 수집': 사용자 탭의 지금 화면을 그대로 읽는다(누르거나 스크롤하지 않음) */
  async readProfileScreen(tabId: number) {
    return this.exec<[], ProfileScreenRead>(tabId, readProfileScreenInPage, []);
  }

  async captureProfilePopup(tabId: number) {
    return this.exec<[], ProfilePopupExtraction>(tabId, captureProfilePopupInPage, []);
  }

  async sampleStructure(target: { url?: string; tabId?: number }, scope: "postCard" | "profile" = "postCard") {
    const tabId = target.tabId ?? (await this.collectTab("body"));
    return this.exec(tabId, sampleStructureInPage, [
      { scope, probes: scope === "profile" ? PROFILE_PROBES : POST_PROBES, tags: [...STRUCT_TAGS], roles: [...STRUCT_ROLES], maxDepth: STRUCT_LIMITS.maxDepth, maxNodes: STRUCT_LIMITS.maxNodes },
    ] as [Parameters<typeof sampleStructureInPage>[0]]);
  }

  fetchAsset(url: string) {
    return fetchImage(url);
  }

  async dispose() {
    for (const r of ["discover", "body"] as const) {
      const w = this.windows[r];
      if (w !== null) await chrome.windows.remove(w).catch(() => undefined);
      this.windows[r] = null;
      this.tabs[r] = null;
    }
  }
}
