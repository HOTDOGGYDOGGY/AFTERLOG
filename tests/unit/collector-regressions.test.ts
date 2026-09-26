// @vitest-environment node
// v1.2 검토에서 재현된 수집기 결함(C01~C06)의 수정 후 회귀 테스트.
// 검토 패키지의 review-regressions.test.ts는 '잘못된 값'을 기대했다. 여기서는 올바른 동작을 기대한다.
import "fake-indexeddb/auto";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_DIR } from "./helpers";

globalThis.DOMParser = new JSDOM().window.DOMParser;

import { cdb, _resetCollectorDbForTests } from "../../collector/src/db";
import { createJob, DEFAULT_OPTIONS, Engine } from "../../collector/src/engine";
import type { CollectorBrowser } from "../../collector/src/browser";
import { DiagRecorder } from "../../collector/src/diagnostics/recorder";
import { extractPostInPage } from "../../collector/src/page/extractPost";
import { sampleStructureInPage } from "../../collector/src/diagnostics/structure";
import { POST_PROBES } from "../../collector/src/diagnostics/probes";
import { countBucket, STRUCT_ROLES, STRUCT_TAGS } from "../../collector/src/diagnostics/schema";
import { validateEvent } from "../../collector/src/diagnostics/serializer";

const postHtml = (no: number) =>
  readFileSync(FIXTURE_DIR + "post-synthetic.html", "utf8")
    .replace(/\.\/page_files\//g, "https://img.test/")
    .replace('href="https://band.us/band/1/post/1"', `href="https://band.us/band/1/post/${no}"`);

function withDom<T>(html: string, url: string, fn: () => Promise<T>): Promise<T> {
  const dom = new JSDOM(html, { url });
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { document: g.document, location: g.location };
  g.document = dom.window.document;
  g.location = dom.window.location;
  return fn().finally(() => {
    g.document = prev.document;
    g.location = prev.location;
  });
}

/** 글 추출만 하는 가짜 브라우저 */
function browserFor(pages: Record<string, string>): CollectorBrowser {
  return {
    extractPost: async (t) => {
      const url = t.url!;
      const ex = await withDom(pages[url], url, () => extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: POST_PROBES }));
      return { ex, loadMs: 100 };
    },
    openList: async () => {},
    discoverRound: async () => ({ links: [], scrollHeight: 0, loading: false, atBottom: true, endMarker: false, loginRequired: false }),
    sampleStructure: async () => null,
    fetchAsset: async () => ({ ok: false, code: "assetNetwork" }),
    dispose: async () => {},
  };
}

function clock(start = 100_000) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), lock: <T,>(_n: string, f: () => Promise<T>) => f() };
}

beforeEach(() => {
  _resetCollectorDbForTests(`reg-${Math.random()}`);
});

describe("C01 점유 중인 과제가 남으면 완료로 표시하지 않는다", () => {
  const url = "https://band.us/band/1/post/1";
  async function jobWithHeldTask(leaseUntil: number, owner: string | null = "old-run") {
    const job = await createJob({ label: "r", scope: "post-urls", bandNo: "1", options: { ...DEFAULT_OPTIONS, includeImages: false, diagnostics: true }, posts: [{ key: "band:1:post:1", url }] });
    const task = (await cdb().tasks.where("jobId").equals(job.id).first())!;
    await cdb().tasks.update(task.id, { status: "inFlight", leaseUntil, leaseOwner: owner });
    return { job, task };
  }

  it("유효한 점유(단독 실행 보장 없음): 만료까지 기다린 뒤 재회수해서 이어받는다", async () => {
    const { job, task } = await jobWithHeldTask(200_000);
    const c = clock(100_000);
    const e = new Engine({ browser: browserFor({ [url]: postHtml(1) }), ...c });
    expect(await e.run(job.id)).toBe("done");
    // 만료 시각 전에는 완료 처리하지 않았다
    const fin = (await cdb().jobs.get(job.id))!;
    expect(Date.parse(fin.finishedAt!)).toBeGreaterThanOrEqual(200_000);
    expect(await cdb().tasks.where("[jobId+status]").equals([job.id, "inFlight"]).count()).toBe(0);
    expect(["succeeded", "partial"]).toContain((await cdb().tasks.get(task.id))!.status);
    expect(await cdb().captures.where("jobId").equals(job.id).count()).toBe(1);
    const codes = (await cdb().diag.toArray()).map((r) => (r.event as { e?: { code?: string } }).e?.code);
    expect(codes).toContain("leaseRecovered");
  });

  it("단독 실행이 보장되면 끝난 실행이 남긴 점유는 기다리지 않고 바로 재회수", async () => {
    const { job, task } = await jobWithHeldTask(10_000_000);
    const c = clock(100_000);
    const e = new Engine({ browser: browserFor({ [url]: postHtml(1) }), ...c, exclusiveLock: true });
    expect(await e.run(job.id)).toBe("done");
    expect(["succeeded", "partial"]).toContain((await cdb().tasks.get(task.id))!.status);
    expect(c.now()).toBeLessThan(10_000_000);
  });

  it("점유 중에 멈추기를 누르면 완료가 아니라 일시정지", async () => {
    const { job } = await jobWithHeldTask(10_000_000);
    const c = clock(100_000);
    const e = new Engine({ browser: browserFor({}), now: c.now, lock: c.lock, sleep: async (ms) => { await c.sleep(ms); e.requestStop(); } });
    expect(await e.run(job.id)).toBe("paused");
    expect((await cdb().jobs.get(job.id))!.status).toBe("paused");
    expect(await cdb().tasks.where("[jobId+status]").equals([job.id, "inFlight"]).count()).toBe(1);
  });
});

describe("C02 준비가 끝나지 않은 카드는 성공이 아니다", () => {
  it("작성자 영역이 없는 로딩 카드: timeout 실패", async () => {
    const r = await withDom('<div class="cPostCard">loading</div>', "https://band.us/band/1/post/1", () => extractPostInPage({ timeoutMs: 5, stableMs: 1000, probes: [] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout");
    expect(r.html).toBeNull();
  });
  it("작성자는 있지만 안정되기 전에 시간이 끝남: timeout 실패", async () => {
    const r = await withDom(postHtml(1), "https://band.us/band/1/post/1", () => extractPostInPage({ timeoutMs: 5, stableMs: 1000, probes: [] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout");
  });
  it("안정된 카드는 성공(정상 경로 유지)", async () => {
    const r = await withDom(postHtml(1), "https://band.us/band/1/post/1", () => extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: [] }));
    expect(r.ok).toBe(true);
    expect(r.html).toContain("postWriter");
  });
  it("엔진은 timeout을 재시도 가능한 loadTimeout으로 기록", async () => {
    const url = "https://band.us/band/1/post/1";
    const job = await createJob({ label: "r", scope: "post-urls", bandNo: "1", options: { ...DEFAULT_OPTIONS, includeImages: false }, posts: [{ key: "band:1:post:1", url }] });
    const b = browserFor({});
    b.extractPost = async () => ({ ex: await withDom('<div class="cPostCard">x</div>', url, () => extractPostInPage({ timeoutMs: 5, stableMs: 1000, probes: [] })), loadMs: 1 });
    expect(await new Engine({ browser: b, ...clock() }).run(job.id)).toBe("done");
    const t = (await cdb().tasks.where("jobId").equals(job.id).first())!;
    expect(t.status).toBe("failed");
    expect(t.errorCode).toBe("loadTimeout");
    expect(t.attempts).toBe(4);
  });
});

describe("C03 진단 과제 번호", () => {
  it("기록기를 다시 만들어도 다른 과제는 다른 번호, 같은 과제는 같은 번호", async () => {
    const job = await createJob({
      label: "r",
      scope: "post-urls",
      bandNo: "1",
      options: DEFAULT_OPTIONS,
      posts: [1, 2].map((i) => ({ key: `band:1:post:${i}`, url: `https://band.us/band/1/post/${i}` })),
    });
    const [a, b] = await cdb().tasks.where("jobId").equals(job.id).sortBy("order");
    let d = new DiagRecorder(job.id, true);
    await d.init();
    await d.event(a.id, { stage: "storage", state: "ok" });
    d = new DiagRecorder(job.id, true);
    await d.init();
    await d.event(b.id, { stage: "storage", state: "ok" });
    d = new DiagRecorder(job.id, true);
    await d.init();
    await d.event(a.id, { stage: "storage", state: "ok" });
    const rows = await cdb().diag.where("jobId").equals(job.id).sortBy("at");
    const nos = rows.map((r) => (r.event as { e: { task: number } }).e.task);
    expect(nos[0]).not.toBe(nos[1]);
    expect(nos[2]).toBe(nos[0]);
    // 순번도 이어진다
    expect(rows.map((r) => (r.event as { e: { seq: number } }).e.seq)).toEqual([1, 2, 3]);
  });
});

describe("C04 대상 범위가 없으면 넓히지 않는다", () => {
  const args = { scope: "postCard" as const, probes: POST_PROBES, tags: [...STRUCT_TAGS], roles: [...STRUCT_ROLES], maxDepth: 8, maxNodes: 150 };
  it("카드가 없으면 body를 표본으로 쓰지 않고 scopeMissing", async () => {
    const r = await withDom("<main><div>개인 목록</div></main>", "https://band.us/band/1/post/1", async () => sampleStructureInPage(args));
    expect(r).toEqual({ scopeMissing: true });
  });
  it("기록기는 scopeMissing을 사건으로만 남기고 구조 표본은 저장하지 않는다", async () => {
    const d = new DiagRecorder("j", true);
    await d.init();
    await d.structure({ scopeMissing: true });
    const rows = await cdb().diag.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toMatchObject({ type: "event", e: { stage: "scope", state: "fail", code: "scopeMissing" } });
  });
});

describe("C05 확인 못 한 개수와 0개 구분", () => {
  it("null·undefined는 unknown, 0은 0", () => {
    expect(countBucket(null)).toBe("unknown");
    expect(countBucket(undefined)).toBe("unknown");
    expect(countBucket(0)).toBe("0");
    expect(countBucket(3)).toBe("2to5");
    expect(validateEvent({ seq: 1, task: 0, stage: "reactions", state: "unknown", count: "unknown" }).count).toBe("unknown");
  });
});

describe("C06 배경 목록 + 상세 레이어", () => {
  const cardOf = (no: number) => new JSDOM(postHtml(no)).window.document.querySelector(".cPostCard")!.outerHTML;
  const layered = (no: number) => {
    const card = cardOf(no);
    const other = (n: number) => card.replace(`/band/1/post/${no}"`, `/band/1/post/${n}"`).replace("첫 줄 대사", `배경 글 ${n}`);
    return `<html><body><div class="feed">${other(10)}${other(11)}</div><div role="dialog">${card}</div></body></html>`;
  };
  it("주소의 글 번호와 맞는 카드만 고른다", async () => {
    const r = await withDom(layered(5), "https://band.us/band/1/post/5", () => extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: [] }));
    expect(r.ok).toBe(true);
    expect(r.html).toContain("첫 줄 대사");
    expect(r.html).not.toContain("배경 글");
    expect(r.postHref).toContain("/post/5");
  });
  it("후보를 확실히 못 고르면 첫 항목을 쓰지 않고 multiple", async () => {
    const card = cardOf(1);
    const r = await withDom(`<body>${card}${card}</body>`, "https://band.us/band/1/post/99", () => extractPostInPage({ timeoutMs: 300, stableMs: 0, probes: [] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("multiple");
  });
  it("저장본에서 입력칸·data-* 속성은 빠지고 data-viewname은 남는다", async () => {
    const html = postHtml(1).replace('class="cPostCard _postCard"', 'class="cPostCard _postCard" data-token="x1"><input type="hidden" name="csrf" value="SECRET_TOKEN"><div data-viewname="DCommentView" data-uid="u1"></div');
    const r = await withDom(html, "https://band.us/band/1/post/1", () => extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: [] }));
    expect(r.ok).toBe(true);
    expect(r.html).not.toContain("SECRET_TOKEN");
    expect(r.html).not.toContain("data-token");
    expect(r.html).not.toContain("data-uid");
    expect(r.html).toContain('data-viewname="DCommentView"');
  });
});

describe("실사용 진단(목록 단계에서 멈춤) 회귀", () => {
  const listUrl = "https://band.us/band/1/post";
  const pages = Object.fromEntries([1, 2, 3].map((n) => [`https://band.us/band/1/post/${n}`, postHtml(n)]));

  it("로딩 표시가 계속 보여도 새 글이 연속으로 없으면 목록을 끝내고 글 수집으로 넘어간다", async () => {
    const job = await createJob({ label: "r", scope: "list", bandNo: "1", options: { ...DEFAULT_OPTIONS, includeImages: false }, lists: [listUrl] });
    const b = browserFor(pages);
    let round = 0;
    b.discoverRound = async () => {
      round++;
      const links = round >= 2 ? [1, 2, 3].map((n) => `https://band.us/band/1/post/${n}`) : ["https://band.us/band/1/post/1"];
      return { links, scrollHeight: 5000, loading: true, atBottom: true, endMarker: false, loginRequired: false };
    };
    expect(await new Engine({ browser: b, ...clock() }).run(job.id)).toBe("done");
    expect(round).toBeLessThan(20);
    const tasks = await cdb().tasks.where("jobId").equals(job.id).toArray();
    expect(tasks.filter((t) => t.kind === "post" && (t.status === "succeeded" || t.status === "partial"))).toHaveLength(3);
  });

  it("목록 읽기가 중간에 끊기면(Frame … removed) 찾은 글부터 수집하고 목록은 '일부'로 남긴다", async () => {
    const job = await createJob({ label: "r", scope: "list", bandNo: "1", options: { ...DEFAULT_OPTIONS, includeImages: false }, lists: [listUrl] });
    const b = browserFor(pages);
    let round = 0;
    b.discoverRound = async () => {
      round++;
      if (round === 3) throw new Error("Frame with ID 0 was removed.");
      return { links: [`https://band.us/band/1/post/${round}`], scrollHeight: 1000 * round, loading: false, atBottom: true, endMarker: false, loginRequired: false };
    };
    expect(await new Engine({ browser: b, ...clock() }).run(job.id)).toBe("done");
    const tasks = await cdb().tasks.where("jobId").equals(job.id).toArray();
    const list = tasks.find((t) => t.kind === "list")!;
    expect(list.status).toBe("succeeded");
    expect(list.result?.coverage).toBe("partial");
    expect(list.result?.evidence).toContain("끊겨");
    expect(tasks.filter((t) => t.kind === "post" && t.status !== "pending")).toHaveLength(2);
  });
});

describe("실사용 진단(글 주소를 바로 연 화면에 .cPostCard 없음) 회귀", () => {
  // 진단 0.1.2: 작성자·본문·시간·댓글 목록은 1개씩 있는데 postCard 0 → '게시글을 찾지 못했습니다'
  const direct = (no: number, extra = "") =>
    `<html><body><div id="header"><a href="/band/1/post">목록</a></div><div id="content">${extra}<div class="postDetail">${postHtml(no)
      .replace(/^[\s\S]*?<article class="cPostCard _postCard">/, "<section class=\"detailBox\">")
      .replace(/<\/article>[\s\S]*$/, "</section>")}</div></div><aside class="bandSide"><p class="txtBody">공지 요약</p></aside></body></html>`;

  it("작성자 영역으로 게시글 범위를 찾아 저장하고, 해석 결과가 카드 저장본과 같다", async () => {
    const url = "https://band.us/band/1/post/1";
    const html = direct(1);
    expect(html).not.toContain("cPostCard");
    const r = await withDom(html, url, () => extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: POST_PROBES }));
    expect(r.ok).toBe(true);
    expect(r.html).not.toContain("공지 요약");
    expect(r.html).not.toContain("목록</a>");
    const viaCard = await withDom(postHtml(1), url, () => extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: [] }));
    const { parseBandHtml } = await import("../../src/importers/band/html");
    const a = parseBandHtml(r.html!).documents[0];
    const b = parseBandHtml(viaCard.html!).documents[0];
    expect(a.entries.length).toBeGreaterThan(3);
    expect(a.entries.map((e) => e.blocks)).toEqual(b.entries.map((e) => e.blocks));
    expect(r.commentsFound).toBe(viaCard.commentsFound);
  });

  it("엔진: 바로 연 화면도 카드 화면과 같은 결과로 확보된다(실패 아님)", async () => {
    const run = async (make: (n: number) => string) => {
      const pages = Object.fromEntries([1, 2].map((n) => [`https://band.us/band/1/post/${n}`, make(n)]));
      const job = await createJob({ label: "r", scope: "post-urls", bandNo: "1", options: { ...DEFAULT_OPTIONS, includeImages: false, skipCaptured: false }, posts: [1, 2].map((n) => ({ key: `band:1:post:${n}`, url: `https://band.us/band/1/post/${n}` })) });
      expect(await new Engine({ browser: browserFor(pages), ...clock() }).run(job.id)).toBe("done");
      return (await cdb().tasks.where("jobId").equals(job.id).toArray()).map((t) => [t.status, t.errorCode]);
    };
    const viaDirect = await run(direct);
    expect(viaDirect.every(([s]) => s === "succeeded" || s === "partial")).toBe(true);
    expect(viaDirect).toEqual(await run(postHtml));
  });

  it("작성자 영역이 둘인데 주소와 맞는 것을 못 고르면 추측하지 않는다", async () => {
    const two = direct(1).replace('<div class="postDetail">', `<div class="postDetail">${direct(2).match(/<section class="detailBox">[\s\S]*<\/section>/)![0]}</div><div class="postDetail">`);
    const r = await withDom(two, "https://band.us/band/1/post/99", () => extractPostInPage({ timeoutMs: 300, stableMs: 0, probes: [] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("multiple");
  });

  it("진단 구조 표본도 같은 범위를 쓴다(범위 없음이 아님)", async () => {
    const args = { scope: "postCard" as const, probes: POST_PROBES, tags: [...STRUCT_TAGS], roles: [...STRUCT_ROLES], maxDepth: 8, maxNodes: 150 };
    const r = await withDom(direct(1), "https://band.us/band/1/post/1", async () => sampleStructureInPage(args));
    expect(r).not.toBeNull();
    expect(!!r && "scopeMissing" in r).toBe(false);
  });
});

describe("실사용 진단(댓글 228개 중 72개) 회귀: 접힌 댓글 펼치기", () => {
  // 표시 댓글 10개인데 화면에는 8개. '이전 댓글 보기'를 누르면 2개가 더 온다
  function page(no: number) {
    return postHtml(no).replace(
      'class="sCommentList _heightDetectAreaForComment">',
      `class="sCommentList _heightDetectAreaForComment"><button type="button" class="prevComment _prevCommentBtn">이전 댓글 2개 보기</button>
       <a href="#" class="_btnMuteMember">이 멤버 댓글 숨기기</a><button type="button" class="button _seeTranslationBtn">번역 보기</button>
       <button type="button" class="moreComment" style="display:none">이전 댓글</button>`,
    );
  }
  async function run(html: string, wire: (w: Window & typeof globalThis, clicked: string[]) => void) {
    const dom = new JSDOM(html, { url: "https://band.us/band/1/post/1" });
    const clicked: string[] = [];
    dom.window.document.addEventListener("click", (e) => clicked.push(((e.target as Element).getAttribute("class") ?? "") + "|" + (e.target as Element).textContent?.trim()), true);
    wire(dom.window as unknown as Window & typeof globalThis, clicked);
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = { document: g.document, location: g.location };
    g.document = dom.window.document;
    g.location = dom.window.location;
    try {
      const r = await extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: [], expandMs: 20_000, expandWaitMs: 400 });
      return { r, clicked, found: dom.window.document.querySelectorAll(".cComment").length };
    } finally {
      g.document = prev.document;
      g.location = prev.location;
    }
  }

  it("'이전 댓글' 버튼만 눌러 모자란 댓글을 불러오고, 숨기기·번역·숨은 버튼은 누르지 않는다", async () => {
    const { r, clicked } = await run(page(1), (w) => {
      const btn = w.document.querySelector("._prevCommentBtn")!;
      btn.addEventListener("click", () =>
        setTimeout(() => {
          const list = w.document.querySelector(".sCommentList")!;
          const first = Array.from(list.querySelectorAll(".cComment")).find((c) => !c.querySelector(".cComment") && !!c.querySelector("._commentContent"))!;
          for (const t of ["펼친 댓글 하나", "펼친 댓글 둘"]) {
            const c = first.cloneNode(true) as Element;
            c.querySelector("._commentContent")!.textContent = t;
            first.parentElement!.insertBefore(c, first);
          }
          btn.remove();
        }, 50),
      );
    });
    expect(r.ok).toBe(true);
    expect(clicked).toEqual(["prevComment _prevCommentBtn|이전 댓글 2개 보기"]);
    expect(r.expandClicks).toBe(1);
    expect(r.html).toContain("펼친 댓글 둘");
    const { parseBandHtml } = await import("../../src/importers/band/html");
    const doc = parseBandHtml(r.html!).documents[0];
    expect(doc.entries.filter((e) => e.kind !== "post")).toHaveLength(10);
    expect(r.commentsShown).toBe(10);
  });

  it("눌러도 아무 변화가 없는 버튼은 한 번만 누르고 멈춘다(일부 확보로 남음)", async () => {
    const { r, clicked } = await run(page(1), () => undefined);
    expect(r.ok).toBe(true);
    expect(clicked.filter((c) => c.includes("_prevCommentBtn"))).toHaveLength(1);
    expect(r.expandClicks).toBe(1);
  });

  it("댓글이 이미 다 있으면 아무것도 누르지 않는다", async () => {
    const full = page(1).replace('<span class="count">10</span>', '<span class="count">8</span>');
    const { r, clicked } = await run(full, () => undefined);
    expect(r.ok).toBe(true);
    expect(clicked).toEqual([]);
    expect(r.expandClicks).toBe(0);
  });

  it("댓글이 모자란(일부) 저장본은 다음 작업에서 재사용하지 않고 다시 연다", async () => {
    const url = "https://band.us/band/1/post/1";
    const job = await createJob({ label: "r", scope: "post-urls", bandNo: "1", options: { ...DEFAULT_OPTIONS, includeImages: false }, posts: [{ key: "band:1:post:1", url }] });
    await new Engine({ browser: browserFor({ [url]: postHtml(1) }), ...clock() }).run(job.id);
    expect((await cdb().tasks.where("jobId").equals(job.id).first())!.status).toBe("partial");
    const job2 = await createJob({ label: "r2", scope: "post-urls", bandNo: "1", options: { ...DEFAULT_OPTIONS, includeImages: false }, posts: [{ key: "band:1:post:1", url }] });
    expect((await cdb().tasks.where("jobId").equals(job2.id).first())!.status).toBe("pending");
  });
});

describe("프로필 명세 P0: 댓글 누적(C01~C06)", () => {
  // 표시 댓글 10개, 화면 8개. 버튼을 누르면 위에 2개가 새로 오고, 가상 목록처럼 아래 2개가 화면에서 사라진다
  const page = (html = postHtml(1)) =>
    html.replace(
      'class="sCommentList _heightDetectAreaForComment">',
      `class="sCommentList _heightDetectAreaForComment"><button type="button" class="prevComment _prevCommentBtn">이전 댓글 2개 보기</button>`,
    );
  async function run(html: string, wire: (w: Window & typeof globalThis) => void) {
    const dom = new JSDOM(html, { url: "https://band.us/band/1/post/1" });
    wire(dom.window as unknown as Window & typeof globalThis);
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = { document: g.document, location: g.location };
    g.document = dom.window.document;
    g.location = dom.window.location;
    try {
      return await extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: [], expandMs: 20_000, expandWaitMs: 400 });
    } finally {
      g.document = prev.document;
      g.location = prev.location;
    }
  }
  const topComments = (w: Window) =>
    Array.from(w.document.querySelectorAll(".dPostCommentMainView .cComment")).filter((c) => !c.parentElement?.closest(".sReplyList") && !!c.querySelector("._commentContent"));
  const loadPrev = (w: Window, texts: string[], dropBottom: number) => {
    const list = topComments(w);
    const first = list[0];
    for (const t of texts) {
      const c = first.cloneNode(true) as Element;
      c.querySelectorAll(".sReplyList").forEach((x) => x.remove());
      c.querySelector("._commentContent")!.textContent = t;
      c.querySelector("time")?.setAttribute("title", `2026년 1월 1일 오전 1:0${texts.indexOf(t)}`);
      first.parentElement!.insertBefore(c, first);
    }
    // 가상 목록: 화면 아래쪽 댓글은 빠진다(답글이 없는 것부터)
    const plain = topComments(w).filter((c) => !c.querySelector(".sReplyList .cComment"));
    if (dropBottom > 0) for (const c of plain.slice(-dropBottom)) c.remove();
  };
  const parse = async (html: string) => (await import("../../src/importers/band/html")).parseBandHtml(html).documents[0];

  it("C01·C02 화면의 댓글 수가 그대로여도(가상 목록) 서로 다른 댓글을 모두 누적해 저장한다", async () => {
    const r = await run(page(), (w) => {
      const btn = w.document.querySelector("._prevCommentBtn")!;
      btn.addEventListener("click", () =>
        setTimeout(() => {
          loadPrev(w, ["펼친 댓글 하나", "펼친 댓글 둘"], 2);
          btn.remove();
        }, 30),
      );
    });
    expect(r.ok).toBe(true);
    expect(r.commentsInDom).toBe(8);
    expect(r.commentsFound).toBe(10);
    expect(r.commentsKeptFromEarlier).toBe(2);
    const doc = await parse(r.html!);
    const texts = doc.entries.filter((e) => e.kind !== "post").map((e) => e.blocks.map((b) => ("text" in b ? b.text : "")).join(""));
    expect(texts).toHaveLength(10);
    expect(texts[0]).toBe("펼친 댓글 하나");
    // 답글 관계도 유지된다
    expect(doc.entries.some((e) => e.kind !== "post" && e.parentTempId !== doc.entries[0].tempId)).toBe(true);
  });

  it("C03 표시 댓글 수가 없어도 '이전 댓글' 버튼이 있으면 펼친다", async () => {
    const html = page().replace('<span class="count">10</span>', '<span class="count"></span>');
    const r = await run(html, (w) => {
      const btn = w.document.querySelector("._prevCommentBtn")!;
      btn.addEventListener("click", () =>
        setTimeout(() => {
          loadPrev(w, ["펼친 댓글 하나"], 0);
          btn.remove();
        }, 30),
      );
    });
    expect(r.commentsShown).toBeNull();
    expect(r.expandClicks).toBe(1);
    expect(r.commentsFound).toBe(9);
    expect(r.expandStop).toBe("noButton");
  });

  it("C04 펼치는 중 게시글 카드가 다시 그려져도 읽어 둔 댓글을 잃지 않는다", async () => {
    const r = await run(page(), (w) => {
      const btn = w.document.querySelector("._prevCommentBtn")!;
      btn.addEventListener("click", () =>
        setTimeout(() => {
          loadPrev(w, ["펼친 댓글 하나", "펼친 댓글 둘"], 2);
          btn.remove();
          const card = w.document.querySelector(".cPostCard")!;
          card.replaceWith(card.cloneNode(true));
        }, 30),
      );
    });
    expect(r.ok).toBe(true);
    expect(r.cardReplaced).toBeGreaterThanOrEqual(1);
    expect(r.commentsFound).toBe(10);
  });

  it("C05 같은 사람이 같은 분에 같은 문장을 두 번 쓰면 둘 다 남는다", async () => {
    const dom = new JSDOM(postHtml(1));
    const first = topComments(dom.window as unknown as Window)[0];
    const twin = first.cloneNode(true) as Element;
    twin.querySelectorAll(".sReplyList").forEach((x) => x.remove());
    const solo = first.cloneNode(true) as Element;
    solo.querySelectorAll(".sReplyList").forEach((x) => x.remove());
    first.parentElement!.insertBefore(twin, first);
    first.parentElement!.insertBefore(solo, first);
    const html = page(dom.serialize()).replace('<span class="count">10</span>', '<span class="count">12</span>');
    const r = await run(html, (w) => {
      const btn = w.document.querySelector("._prevCommentBtn")!;
      btn.addEventListener("click", () => setTimeout(() => (loadPrev(w, ["새 댓글"], 1), btn.remove()), 30));
    });
    // 처음 화면 10개(같은 댓글 두 벌 포함) + 새 1개. 화면에서 빠진 1개도 누적본에 남는다
    expect(r.commentsFound).toBe(11);
    const doc = await parse(r.html!);
    const same = doc.entries.filter((e) => e.kind !== "post" && JSON.stringify(e.blocks) === JSON.stringify(doc.entries.find((x) => x.kind !== "post" && x.tempId !== doc.entries[0].tempId && JSON.stringify(x.blocks) === JSON.stringify(e.blocks) && x !== e)?.blocks));
    expect(same.length).toBeGreaterThanOrEqual(2);
  });

  it("C06 다시 열었을 때 댓글이 적게 보여도 앞서 저장한 더 큰 자료를 지우지 않는다", async () => {
    const url = "https://band.us/band/1/post/1";
    const full = postHtml(1).replace('<span class="count">10</span>', '<span class="count">8</span>');
    let html = full;
    const job = await createJob({ label: "c06", scope: "post-urls", bandNo: "1", options: { ...DEFAULT_OPTIONS, includeImages: false }, posts: [{ key: "band:1:post:1", url }] });
    const browser = browserFor({});
    browser.extractPost = async () => ({ ex: await withDom(html, url, () => extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: [] })), loadMs: 10 });
    await new Engine({ browser, ...clock() }).run(job.id);
    const before = (await cdb().captures.where("jobId").equals(job.id).first())!;
    expect(before.commentsFound).toBe(8);
    // 두 번째 관측: 댓글이 3개만 보임
    const dom = new JSDOM(full);
    topComments(dom.window as unknown as Window).slice(1).forEach((c) => c.remove());
    html = dom.serialize();
    const t = (await cdb().tasks.where("jobId").equals(job.id).first())!;
    await cdb().tasks.update(t.id, { status: "pending", attempts: 0 });
    await cdb().jobs.update(job.id, { status: "paused" });
    await new Engine({ browser, ...clock(200_000) }).run(job.id);
    const caps = await cdb().captures.where("jobId").equals(job.id).toArray();
    expect(caps).toHaveLength(1);
    expect(caps[0].id).toBe(before.id);
    const t2 = (await cdb().tasks.get(t.id))!;
    expect(t2.errorCode).toBe("keptEarlier");
    expect(t2.result?.commentsFound).toBe(8);
  });
});

describe("프로필 화면 구조 진단(D01)", () => {
  it("열린 스토리 상세를 범위로, 이름·글·주소·식별자 없이 구조와 확인 위치만", async () => {
    const { PROFILE_PROBES } = await import("../../collector/src/diagnostics/probes");
    const html = readFileSync(FIXTURE_DIR + "profile/profile-page.html", "utf8");
    const args = { scope: "profile" as const, probes: PROFILE_PROBES, tags: [...STRUCT_TAGS], roles: [...STRUCT_ROLES], maxDepth: 8, maxNodes: 150 };
    const r = await withDom(html, "https://www.band.us/band/100200300/member/AbCdEf%3D%3D%3D/profile", async () => sampleStructureInPage(args));
    const out = JSON.stringify(r);
    expect(out).toContain("storyDetail");
    expect(out).not.toMatch(/[가-힣]/);
    expect(out).not.toMatch(/band\.us|AbCdEf|100200300|profile_files/);
  });
});
