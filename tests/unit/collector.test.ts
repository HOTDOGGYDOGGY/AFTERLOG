// @vitest-environment node
// 수집 확장: 엔진(가짜 브라우저)·진단(개인정보 제외)·내보내기 검사
import "fake-indexeddb/auto";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_DIR } from "./helpers";

globalThis.DOMParser = new JSDOM().window.DOMParser;

import { cdb, _resetCollectorDbForTests } from "../../collector/src/db";
import { createJob, DEFAULT_OPTIONS, Engine, periodContains } from "../../collector/src/engine";
import type { CollectorBrowser, FetchedAsset } from "../../collector/src/browser";
import { imageQuality, sniffImage } from "../../collector/src/browser";
import { extractPostInPage, type PostExtraction } from "../../collector/src/page/extractPost";
import { sampleStructureInPage } from "../../collector/src/diagnostics/structure";
import { POST_PROBES } from "../../collector/src/diagnostics/probes";
import { STRUCT_ROLES, STRUCT_TAGS } from "../../collector/src/diagnostics/schema";
import { serializeDiagnostic, STRUCT_LIMITS, validateEvent } from "../../collector/src/diagnostics/serializer";
import { buildDiagnosticText, pruneDiagnostics, DiagRecorder } from "../../collector/src/diagnostics/recorder";
import { exportJob } from "../../collector/src/exporter";
import { readArchive } from "../../src/archive/reader";
import { parsePostUrlList, parseBandUrl } from "../../collector/src/urls";

const SECRETS = ["비밀인물가나다", "SECRETBODY9731", "https://band.us/band/424242/post/777", "424242", "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "secret@example.com"];

/** 합성 게시글 HTML: 픽스처 + 모든 속성·본문에 비밀 문자열 주입(D01) */
function secretPostHtml(postNo: number, opts: { comments?: number; shown?: number; time?: string } = {}) {
  let html = readFileSync(FIXTURE_DIR + "post-synthetic.html", "utf8").replace(/\.\/page_files\//g, "https://img.test/");
  html = html.replace("첫 줄 대사.", `첫 줄 대사 ${SECRETS[1]} 글${postNo}.`);
  html = html.replace('class="cPostCard _postCard"', `class="cPostCard _postCard" data-secret="${SECRETS[4]}" title="${SECRETS[0]}" aria-label="${SECRETS[5]}"`);
  html = html.replace(/가람/g, SECRETS[0]);
  html = html.replace('href="https://band.us/band/1/post/1"', `href="https://band.us/band/424242/post/${postNo}"`);
  if (opts.time) html = html.replaceAll("2026년 3월 1일 오후 11:50", opts.time);
  if (opts.shown !== undefined) html = html.replace('<span class="count">10</span>', `<span class="count">${opts.shown}</span>`);
  return html;
}

async function extractFrom(html: string, url: string): Promise<PostExtraction> {
  const dom = new JSDOM(html, { url });
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { document: g.document, location: g.location };
  g.document = dom.window.document;
  g.location = dom.window.location;
  try {
    return await extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: POST_PROBES });
  } finally {
    g.document = prev.document;
    g.location = prev.location;
  }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

class FakeBrowser implements CollectorBrowser {
  pages = new Map<string, () => string | Error>();
  list: string[][] = [];
  round = 0;
  calls: string[] = [];
  account = "me.png";
  async extractPost(t: { url?: string; tabId?: number }) {
    const url = t.url ?? `https://band.us/band/424242/post/1`;
    this.calls.push(url);
    const make = this.pages.get(url);
    if (!make) throw new Error("없는 페이지");
    const html = make();
    if (html instanceof Error) throw html;
    const ex = await extractFrom(html, url);
    return { ex: { ...ex, accountMarker: this.account }, loadMs: 1200 };
  }
  async openList() {
    this.round = 0;
  }
  async discoverRound() {
    const links = this.list.slice(0, ++this.round).flat();
    return { links, scrollHeight: 1000, loading: false, endMarker: false, loginRequired: false };
  }
  async sampleStructure() {
    return { n: 1, tag: "div", c: [{ n: 2, tag: "article", probes: ["postCard"], text: true }] };
  }
  async fetchAsset(url: string): Promise<FetchedAsset> {
    if (url.includes("broken")) return { ok: false, code: "assetNotImage" };
    return { ok: true, blob: new Blob([PNG], { type: "image/png" }), mime: "image/png" };
  }
  async dispose() {}
}

const noSleep = async () => {};
/** 가짜 시계: sleep이 시간을 앞으로 보낸다(재시도 대기를 실제로 기다리지 않게) */
function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), lock: <T,>(_n: string, f: () => Promise<T>) => f() };
}
beforeEach(async () => {
  _resetCollectorDbForTests(`c-${Math.random()}`);
});

describe("주소 해석", () => {
  it("글·목록·멤버 목록을 구분하고 다른 사이트는 거부", () => {
    expect(parseBandUrl("https://www.band.us/band/12/post/34?x=1")).toMatchObject({ kind: "post", canonical: "https://band.us/band/12/post/34" });
    expect(parseBandUrl("https://band.us/band/12")).toMatchObject({ kind: "feed", canonical: "https://band.us/band/12/post" });
    expect(parseBandUrl("https://band.us/band/12/member/AbC%3D/post")).toMatchObject({ kind: "member-list", list: "post" });
    expect(parseBandUrl("https://evil.example/band/12/post/1")).toBeNull();
    const r = parsePostUrlList("https://band.us/band/1/post/2\nhttps://band.us/band/1/post/2  hello https://band.us/band/1/post/3");
    expect(r.posts.map((p) => p.postNo)).toEqual(["2", "3"]);
    expect(r.rejected).toEqual(["hello"]);
  });
  it("기간: 시작일 포함, 끝 날짜 포함, 시각 모르면 판단 불가", () => {
    expect(periodContains("2026-03-01T23:50", "2026-03-01", "2026-03-01")).toBe(true);
    expect(periodContains("2026-03-02T00:00", null, "2026-03-01")).toBe(false);
    expect(periodContains(null, "2026-01-01", null)).toBeNull();
  });
  it("이미지 판정: 바이트로 확인(T14), 축소본 표시(T15 유사)", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("<html>login</html>"))).toBeNull();
    expect(imageQuality("https://x.pstatic.net/a.jpg?type=s75")).toBe("thumbnail");
  });
});

describe("수집 엔진", () => {
  it("글 여러 개: 순서대로 확보, 표시 댓글 수와 다르면 '일부 확보'", async () => {
    const b = new FakeBrowser();
    for (let i = 1; i <= 3; i++) b.pages.set(`https://band.us/band/424242/post/${i}`, () => secretPostHtml(i, { shown: i === 2 ? 12 : 8 }));
    const job = await createJob({
      scope: "post-urls",
      label: "t",
      options: DEFAULT_OPTIONS,
      bandNo: "424242",
      posts: [1, 2, 3].map((i) => ({ url: `https://band.us/band/424242/post/${i}`, key: `band:424242:post:${i}` })),
    });
    const e = new Engine({ browser: b, ...clock() });
    expect(await e.run(job.id)).toBe("done");
    const tasks = await cdb().tasks.where("jobId").equals(job.id).sortBy("order");
    expect(tasks.map((t) => t.status)).toEqual(["succeeded", "partial", "succeeded"]);
    expect(tasks[1].errorText).toContain("12개 중 8개");
    expect(await cdb().captures.count()).toBe(3);
    // 이미지: 존재하는 것은 저장, 이미지가 아닌 응답은 실패(T14)
    expect((await cdb().assets.where("status").equals("stored").count()) > 0).toBe(true);
  });

  it("T08 일시적 오류는 제한된 재시도 후 성공, 계속 실패하면 실패로 남기고 계속 진행", async () => {
    const b = new FakeBrowser();
    let n = 0;
    b.pages.set("https://band.us/band/424242/post/1", () => (++n < 2 ? new Error("일시 장애") : secretPostHtml(1, { shown: 8 })));
    b.pages.set("https://band.us/band/424242/post/2", () => "<html><body>삭제된 글</body></html>");
    b.pages.set("https://band.us/band/424242/post/3", () => secretPostHtml(3, { shown: 8 }));
    const job = await createJob({
      scope: "post-urls",
      label: "t",
      options: DEFAULT_OPTIONS,
      bandNo: "424242",
      posts: [1, 2, 3].map((i) => ({ url: `https://band.us/band/424242/post/${i}`, key: `band:424242:post:${i}` })),
    });
    const e = new Engine({ browser: b, ...clock() });
    const r = await e.run(job.id);
    const tasks = await cdb().tasks.where("jobId").equals(job.id).sortBy("order");
    expect(r).toBe("done");
    expect(tasks.map((x) => x.status)).toEqual(["succeeded", "failed", "succeeded"]);
    expect(tasks[1].attempts).toBe(4); // 원 시도 + 3회
    expect(tasks[1].errorCode).toBe("selectorMissing");
  }, 20000);

  it("T04 처리 중 창이 닫혀도(점유 만료) 이어받으면 중복 없이 같은 결과", async () => {
    const b = new FakeBrowser();
    for (let i = 1; i <= 2; i++) b.pages.set(`https://band.us/band/424242/post/${i}`, () => secretPostHtml(i, { shown: 8 }));
    const job = await createJob({ scope: "post-urls", label: "t", options: DEFAULT_OPTIONS, bandNo: "424242", posts: [1, 2].map((i) => ({ url: `https://band.us/band/424242/post/${i}`, key: `band:424242:post:${i}` })) });
    // 첫 과제를 '처리 중'인 채로 남긴 상황(탭이 강제로 닫힘)
    const first = (await cdb().tasks.where("jobId").equals(job.id).sortBy("order"))[0];
    await cdb().tasks.update(first.id, { status: "inFlight", leaseUntil: 1 });
    await cdb().jobs.update(job.id, { status: "running" });
    const e = new Engine({ browser: b, ...clock() });
    expect(await e.run(job.id)).toBe("done");
    expect(await cdb().captures.where("jobId").equals(job.id).count()).toBe(2);
    // 한 번 더 이어받아도 늘지 않는다
    await cdb().tasks.where("jobId").equals(job.id).modify({ status: "pending" });
    await cdb().jobs.update(job.id, { status: "paused" });
    await e.run(job.id);
    expect(await cdb().captures.where("jobId").equals(job.id).count()).toBe(2);
  });

  it("T06 같은 작업을 두 창에서 실행하면 한쪽은 busy", async () => {
    const job = await createJob({ scope: "post-urls", label: "t", options: DEFAULT_OPTIONS, bandNo: "1", posts: [] });
    let held = false;
    const lock = async <T,>(_n: string, f: () => Promise<T>) => {
      if (held) return "busy" as const;
      held = true;
      try {
        return await f();
      } finally {
        held = false;
      }
    };
    const b = new FakeBrowser();
    const slow = new Engine({ browser: b, sleep: () => new Promise((r) => setTimeout(r, 30)), lock });
    const p1 = slow.run(job.id);
    const p2 = new Engine({ browser: b, sleep: noSleep, lock }).run(job.id);
    expect(await p2).toBe("busy");
    await p1;
  });

  it("T07 계정이 바뀐 것 같으면 멈추고 섞지 않는다", async () => {
    const b = new FakeBrowser();
    for (let i = 1; i <= 2; i++) b.pages.set(`https://band.us/band/424242/post/${i}`, () => secretPostHtml(i, { shown: 8 }));
    const job = await createJob({ scope: "post-urls", label: "t", options: DEFAULT_OPTIONS, bandNo: "424242", posts: [1, 2].map((i) => ({ url: `https://band.us/band/424242/post/${i}`, key: `band:424242:post:${i}` })) });
    const e = new Engine({ browser: b, ...clock() });
    const origExtract = b.extractPost.bind(b);
    let k = 0;
    b.extractPost = async (t) => {
      const r = await origExtract(t);
      return { ...r, ex: { ...r.ex, accountMarker: ++k === 1 ? "me.png" : "other.png" } };
    };
    expect(await e.run(job.id)).toBe("needsUser");
    expect((await cdb().jobs.get(job.id))!.pauseReason).toContain("다른 계정");
    expect(await cdb().captures.count()).toBe(1);
  });

  it("T02 목록: 발견 즉시 저장, 중복 없이, 끝 표시가 없으면 '끝 확인 불가'", async () => {
    const b = new FakeBrowser();
    b.list = [["https://band.us/band/424242/post/1", "https://band.us/band/424242/post/2"], ["https://band.us/band/424242/post/2", "https://band.us/band/424242/post/3"]];
    for (let i = 1; i <= 3; i++) b.pages.set(`https://band.us/band/424242/post/${i}`, () => secretPostHtml(i, { shown: 8 }));
    const job = await createJob({ scope: "list", label: "t", options: DEFAULT_OPTIONS, bandNo: "424242", lists: ["https://band.us/band/424242/post"] });
    const e = new Engine({ browser: b, ...clock() });
    expect(await e.run(job.id)).toBe("done");
    const tasks = await cdb().tasks.where("jobId").equals(job.id).toArray();
    const list = tasks.find((t) => t.kind === "list")!;
    expect(list.result).toMatchObject({ coverage: "unknown", found: 3 });
    expect(tasks.filter((t) => t.kind === "post").map((t) => t.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  });

  it("기간 밖 글은 저장하지 않고 '건너뜀', 이미 저장한 글은 다음 작업에서 건너뜀", async () => {
    const b = new FakeBrowser();
    b.pages.set("https://band.us/band/424242/post/1", () => secretPostHtml(1, { shown: 8, time: "2025년 1월 1일 오전 1:00" }));
    b.pages.set("https://band.us/band/424242/post/2", () => secretPostHtml(2, { shown: 8 }));
    const posts = [1, 2].map((i) => ({ url: `https://band.us/band/424242/post/${i}`, key: `band:424242:post:${i}` }));
    const job = await createJob({ scope: "post-urls", label: "t", options: { ...DEFAULT_OPTIONS, periodFrom: "2026-01-01" }, bandNo: "424242", posts });
    await new Engine({ browser: b, ...clock() }).run(job.id);
    const ts = await cdb().tasks.where("jobId").equals(job.id).sortBy("order");
    expect(ts.map((t) => t.status)).toEqual(["skipped", "succeeded"]);
    const job2 = await createJob({ scope: "post-urls", label: "t2", options: DEFAULT_OPTIONS, bandNo: "424242", posts });
    const ts2 = await cdb().tasks.where("jobId").equals(job2.id).sortBy("order");
    expect(ts2.map((t) => t.status)).toEqual(["pending", "skipped"]);
  });
});

describe("D09 확장 업데이트 후 이어받기", () => {
  it("이전 버전으로 시작한 작업을 새 버전이 이어받아도 모은 글은 그대로, 버전 변경은 진단에 남는다", async () => {
    const b = new FakeBrowser();
    for (let i = 1; i <= 2; i++) b.pages.set(`https://band.us/band/424242/post/${i}`, () => secretPostHtml(i, { shown: 8 }));
    const job = await createJob({ scope: "post-urls", label: "t", options: DEFAULT_OPTIONS, bandNo: "424242", posts: [1, 2].map((i) => ({ url: `https://band.us/band/424242/post/${i}`, key: `band:424242:post:${i}` })) });
    const [first] = await cdb().tasks.where("jobId").equals(job.id).sortBy("order");
    // 이전 버전이 첫 글을 저장하고, 두 번째 글 처리 중에 업데이트로 종료된 상황
    await new Engine({ browser: b, ...clock() }).run(job.id);
    const before = await cdb().captures.where("jobId").equals(job.id).toArray();
    await cdb().jobs.update(job.id, { lastRunVersion: "0.0.1", status: "running" });
    await cdb().tasks.update(first.id, { status: "inFlight", leaseUntil: 1 });
    expect(await new Engine({ browser: b, ...clock() }).run(job.id)).toBe("done");
    const after = await cdb().captures.where("jobId").equals(job.id).toArray();
    expect(after).toHaveLength(before.length);
    expect((await cdb().jobs.get(job.id))!.lastRunVersion).not.toBe("0.0.1");
    const text = await buildDiagnosticText((await cdb().jobs.get(job.id))!, await cdb().tasks.toArray(), { includeStructure: false });
    expect(text).toContain('"code": "versionChanged"');
    expect(text).toContain('"code": "leaseRecovered"');
  });
});

describe("내보내기(.afterlog)", () => {
  it("웹 앱이 읽을 수 있는 파일, 글마다 문서, 보고서 포함, 인증정보 없음(T26)", async () => {
    const b = new FakeBrowser();
    for (let i = 1; i <= 2; i++) b.pages.set(`https://band.us/band/424242/post/${i}`, () => secretPostHtml(i, { shown: 8 }));
    const job = await createJob({ scope: "post-urls", label: "t", options: DEFAULT_OPTIONS, bandNo: "424242", posts: [1, 2].map((i) => ({ url: `https://band.us/band/424242/post/${i}`, key: `band:424242:post:${i}` })) });
    await new Engine({ browser: b, ...clock() }).run(job.id);
    const { parts, documents, report } = await exportJob(job.id);
    expect(parts).toHaveLength(1);
    expect(documents).toBe(2);
    expect(report.posts).toMatchObject({ discovered: 2, captured: 2, failed: 0 });
    expect(report.outcome).toBe("complete");
    const r = await readArchive(parts.map((p) => p.blob));
    expect(r.data.documents).toHaveLength(2);
    expect(r.data.documents[0].entries).toBeDefined();
    const all = new TextDecoder().decode(new Uint8Array(await parts[0].blob.arrayBuffer()));
    for (const bad of ["cookie", "Authorization", "access_token", "password"]) expect(all.toLowerCase()).not.toContain(bad.toLowerCase());
    expect(r.captureReport).toMatchObject({ scope: "post-urls" });
  });
});

describe("개발용 진단(개인정보 제외)", () => {
  it("D01·D05 비밀 문자열을 곳곳에 넣은 화면을 수집해도 진단 파일에는 하나도 없다", async () => {
    const b = new FakeBrowser();
    b.pages.set("https://band.us/band/424242/post/777", () => secretPostHtml(777, { shown: 12 }));
    b.pages.set("https://band.us/band/424242/post/778", () => `<html><body><div class="x" title="${SECRETS[0]}">${SECRETS[1]} <a href="${SECRETS[2]}">x</a></div></body></html>`);
    const job = await createJob({
      scope: "post-urls",
      label: SECRETS[0],
      options: DEFAULT_OPTIONS,
      bandNo: "424242",
      posts: [777, 778].map((i) => ({ url: `https://band.us/band/424242/post/${i}`, key: `band:424242:post:${i}` })),
    });
    await new Engine({ browser: b, ...clock() }).run(job.id);
    const tasks = await cdb().tasks.where("jobId").equals(job.id).toArray();
    const text = await buildDiagnosticText((await cdb().jobs.get(job.id))!, tasks, { includeStructure: true });
    for (const s of SECRETS) expect(text).not.toContain(s);
    expect(text).not.toMatch(/[가-힣]/);
    const f = JSON.parse(text);
    expect(f.events.length).toBeGreaterThan(5);
    expect(f.events.some((e: { code?: string }) => e.code === "countMismatch")).toBe(true);
    expect(f.events.some((e: { code?: string }) => e.code === "selectorMissing")).toBe(true);
    expect(f.structure).not.toBeNull();
  }, 20000);

  it("D03 정의되지 않은 키·자유 문자열·과대 배열은 저장을 막는다", () => {
    expect(() => validateEvent({ seq: 1, task: 1, stage: "pageLoad", state: "ok", note: "x" })).toThrow();
    expect(() => validateEvent({ seq: 1, task: 1, stage: "pageLoad", state: "ok", code: "비밀" })).toThrow();
    const base = {
      diagnosticSchemaVersion: 1,
      extensionVersion: "0.1.0",
      adapterVersion: "band-web-1",
      parserVersion: "band-html/2",
      probeSuiteVersion: "band-post-1",
      environment: { browser: "chrome", browserMajor: 120, uiLang: "ko", screen: "gt1440" },
      job: { scope: "list", tasks: "1", succeeded: "1", partial: "0", failed: "0", skipped: "0", userVerified: "0" },
      events: [],
      structure: null,
    };
    expect(() => serializeDiagnostic(base as never)).not.toThrow();
    expect(() => serializeDiagnostic({ ...base, extensionVersion: "https://x" } as never)).toThrow();
    expect(() => serializeDiagnostic({ ...base, events: Array.from({ length: 501 }, (_, i) => ({ seq: i, task: 0, stage: "scope", state: "ok" })) } as never)).toThrow();
    expect(() => serializeDiagnostic({ ...base, extra: 1 } as never)).toThrow();
  });

  it("D02 예외 메시지 원문은 진단에 들어가지 않는다(고정 코드만)", async () => {
    const b = new FakeBrowser();
    b.pages.set("https://band.us/band/424242/post/1", () => new Error(`서버 오류 ${SECRETS[4]} at stack ${SECRETS[2]}`));
    const job = await createJob({ scope: "post-urls", label: "t", options: DEFAULT_OPTIONS, bandNo: "424242", posts: [{ url: "https://band.us/band/424242/post/1", key: "band:424242:post:1" }] });
    await new Engine({ browser: b, ...clock() }).run(job.id);
    const text = await buildDiagnosticText((await cdb().jobs.get(job.id))!, await cdb().tasks.toArray(), { includeStructure: false });
    for (const s of SECRETS) expect(text).not.toContain(s);
  });

  it("D05·D08 구조 표본: 글자·클래스·주소 없음, 반복 행 축약, 깊이·노드 상한", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => `<li class="c${i} secretClass" data-id="424242${i}"><span>${SECRETS[0]}</span><img src="${SECRETS[2]}" alt="${SECRETS[0]}"></li>`).join("");
    let deep = "<b>x</b>";
    for (let i = 0; i < 20; i++) deep = `<div class="d${i}">${deep}</div>`;
    const dom = new JSDOM(`<main><article class="cPostCard" title="${SECRETS[0]}"><ul role="list">${rows}</ul>${deep}<input value="${SECRETS[1]}"></article></main>`, { url: "https://band.us/" });
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = g.document;
    g.document = dom.window.document;
    const tree = sampleStructureInPage({ scope: "postCard", probes: POST_PROBES, tags: [...STRUCT_TAGS], roles: [...STRUCT_ROLES], maxDepth: STRUCT_LIMITS.maxDepth, maxNodes: STRUCT_LIMITS.maxNodes });
    g.document = prev;
    const text = JSON.stringify(tree);
    for (const s of [...SECRETS, "secretClass", "c1", "data-id"]) expect(text).not.toContain(s);
    expect(text).toContain('"repeat":"21to100"');
    expect(text).toContain('"truncated":true');
    const rec = new DiagRecorder("j", true);
    await rec.structure(tree);
    expect(await cdb().diag.count()).toBe(1);
  });

  it("D11 진단 정리는 백업 자료를 건드리지 않는다", async () => {
    await cdb().captures.add({ id: "c", jobId: "j", taskId: "t", key: "k", url: "u", bandNo: "1", postNo: "1", bandName: null, html: "<div/>", imageUrls: [], capturedAt: "x", commentsShown: null, commentsFound: 0, collectorVersion: "t" });
    await cdb().diag.add({ jobId: "j", at: 1, event: { type: "event", e: { seq: 1, task: 0, stage: "scope", state: "ok" } }, bytes: 10 });
    await pruneDiagnostics(Date.now());
    expect(await cdb().diag.count()).toBe(0);
    expect(await cdb().captures.count()).toBe(1);
  });
});
