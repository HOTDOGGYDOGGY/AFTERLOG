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
    discoverRound: async () => ({ links: [], scrollHeight: 0, loading: false, endMarker: false, loginRequired: false }),
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
