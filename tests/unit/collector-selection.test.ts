// @vitest-environment node
// 선택 수집 명세 v1.0 인수 사례(F01~F15 중 합성 자료로 확인할 수 있는 것).
// 실제 밴드의 멤버 댓글 목록을 눌러 원글이 열리는 동작은 가짜 브라우저로 흉내 낸다(실제 화면 미검증).
import "fake-indexeddb/auto";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_DIR } from "./helpers";

globalThis.DOMParser = new JSDOM().window.DOMParser;

import { cdb, _resetCollectorDbForTests, type Selection } from "../../collector/src/db";
import { createJob, DEFAULT_OPTIONS, Engine } from "../../collector/src/engine";
import type { CollectorBrowser } from "../../collector/src/browser";
import { extractPostInPage } from "../../collector/src/page/extractPost";
import type { MemberCommentItem } from "../../collector/src/page/memberComments";
import { exportJob } from "../../collector/src/exporter";
import { readArchive } from "../../src/archive/reader";
import { buildDiagnosticText } from "../../collector/src/diagnostics/recorder";
import { commentInCapture } from "../../collector/src/selection";

const BAND = "1";
const MEMBER = "NR1SECRETKEY";
const postUrl = (n: number) => `https://band.us/band/${BAND}/post/${n}`;
const firstLine = (n: number) => `${n}번 글 첫 줄.`;
const postHtml = (n: number) =>
  readFileSync(FIXTURE_DIR + "post-synthetic.html", "utf8")
    .replace(/\.\/page_files\//g, "https://img.test/")
    .replace('href="https://band.us/band/1/post/1"', `href="${postUrl(n)}"`)
    .replace("첫 줄 대사.", firstLine(n));

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

/** 나래(멤버 NR1…)의 댓글 목록. 항목마다 실제로 달린 원글 번호(누르면 열리는 글) */
type Item = MemberCommentItem & { post: number };
const item = (seq: number, post: number, text: string, dateText: string): Item => ({
  seq,
  post,
  text,
  excerpt: firstLine(post),
  dateText,
  html: `<a data-viewname="DBandMemberCommentListItemView" class="cCommentOnly"><p class="comment">${text}</p><p class="body">${firstLine(post)}</p><p class="date">${dateText}</p></a>`,
});

class FakeBand implements CollectorBrowser {
  events: string[] = [];
  clicks: number[] = [];
  opened: number[] = [];
  current = "";
  constructor(
    public items: Item[],
    public authoredPosts: number[] = [],
    public memberName = "나래",
  ) {}
  async extractPost(t: { url?: string }) {
    const n = Number(t.url!.match(/post\/(\d+)/)![1]);
    this.opened.push(n);
    this.events.push(`extract:${n}`);
    const ex = await withDom(postHtml(n), t.url!, () => extractPostInPage({ timeoutMs: 2000, stableMs: 0, probes: [] }));
    return { ex, loadMs: 10 };
  }
  async openList(url: string) {
    this.current = url;
    this.events.push(`open:${url.split("/").pop()}`);
  }
  async discoverRound() {
    this.events.push("round");
    return { links: this.authoredPosts.map(postUrl), scrollHeight: 100, loading: false, atBottom: true, endMarker: false, loginRequired: false };
  }
  async readMemberComments(o: { from: number }) {
    this.events.push("readComments");
    return {
      listFound: true,
      memberName: this.memberName,
      total: this.items.length,
      items: this.items.filter((i) => i.seq >= o.from).map(({ post: _p, ...rest }) => rest),
      loading: false,
      atBottom: true,
      loginRequired: false,
    };
  }
  async openCommentPost(o: { seq: number; expectText: string }) {
    this.clicks.push(o.seq);
    this.events.push(`click:${o.seq}`);
    const it = this.items[o.seq];
    if (!it || it.text !== o.expectText) return { ok: false, reason: "moved" as const, closed: true };
    return { ok: true, postNo: String(it.post), closed: true };
  }
  async sampleStructure() {
    return null;
  }
  fetched: string[] = [];
  async fetchAsset(url: string) {
    this.fetched.push(url);
    return { ok: false, code: "assetNetwork" as const };
  }
  async dispose() {}
}

function clock(start = 100_000) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), lock: <T,>(_n: string, f: () => Promise<T>) => f(), random: () => 0 };
}

const sel = (p: Partial<Selection>): Selection => ({
  members: [{ origin: "https://band.us", bandNo: BAND, memberKey: MEMBER, name: null }],
  authored: false,
  commentsOnly: false,
  commentedPosts: false,
  periodFrom: null,
  periodTo: null,
  ...p,
});

async function run(selection: Selection, b: FakeBand, extra: Partial<typeof DEFAULT_OPTIONS> = {}) {
  const job = await createJob({ scope: "selection", label: "t", options: { ...DEFAULT_OPTIONS, includeImages: false, ...extra, selection }, bandNo: BAND });
  expect(await new Engine({ browser: b, ...clock() }).run(job.id)).toBe("done");
  const tasks = await cdb().tasks.where("jobId").equals(job.id).sortBy("order");
  const obs = await cdb().comments.where("jobId").equals(job.id).sortBy("seq");
  return { job, tasks, posts: tasks.filter((t) => t.kind === "post"), obs };
}

// 나래가 3번 글에 댓글 3개, 8번 글에 1개(원글 발췌가 다름), 12번 글에 1개(발췌는 3번과 같지만 다른 글)
const ITEMS = () => [
  item(0, 3, "0", "2026년 3월 1일 오후 11:52"),
  item(1, 3, "안녕 @다온 반가워", "2026년 3월 2일 오전 12:20"),
  item(2, 3, "저는 다른 나래입니다.", "2026년 3월 2일 오전 1:00"),
  item(3, 8, "0", "2026년 3월 1일 오후 11:52"),
];

beforeEach(() => {
  _resetCollectorDbForTests(`sel-${Math.random()}`);
});

describe("선택 수집 A·B·C", () => {
  it("F02 한 원글에 댓글 여러 개: 댓글은 모두 보존(B), 원글은 한 번만 연다(C)", async () => {
    const b = new FakeBand(ITEMS());
    const { posts, obs } = await run(sel({ commentsOnly: true, commentedPosts: true }), b);
    expect(obs).toHaveLength(4);
    expect(posts.map((p) => p.key).sort()).toEqual([`band:${BAND}:post:3`, `band:${BAND}:post:8`]);
    expect(b.opened.filter((n) => n === 3)).toHaveLength(1);
    // 같은 발췌는 한 번만 누르고 나머지는 원글의 댓글과 대조
    expect(b.clicks).toEqual([0, 3]);
    expect(obs.every((o) => o.link === "linked")).toBe(true);
    expect(obs.every((o) => o.content === "verified")).toBe(true);
    expect(posts.every((p) => p.reasons?.includes("commented"))).toBe(true);
  });

  it("같은 발췌라도 원글에 그 댓글이 없으면 추정을 버리고 그 댓글만 눌러 확인한다", async () => {
    const items = [...ITEMS(), { ...item(4, 12, "12번 글에만 있는 댓글", "2026년 3월 5일 오후 1:00"), excerpt: firstLine(3) }];
    const b = new FakeBand(items);
    const { posts, obs } = await run(sel({ commentedPosts: true }), b);
    expect(b.clicks).toContain(4);
    expect(obs.find((o) => o.seq === 4)).toMatchObject({ link: "linked", postKey: `band:${BAND}:post:12` });
    expect(posts.map((p) => p.key)).toContain(`band:${BAND}:post:12`);
  });

  it("F03 1월 글에 9월 댓글: C는 댓글 날짜로 포함, A는 글 작성일로 제외", async () => {
    // 글 작성일은 모두 2026-03-01. 기간 3/2~3/31: 3/2 댓글이 있는 3번 글은 C로 포함, 3/1 댓글뿐인 8번 글은 제외
    const b = new FakeBand(ITEMS(), [3, 20]);
    const { posts, obs } = await run(sel({ authored: true, commentedPosts: true, periodFrom: "2026-03-02", periodTo: "2026-03-31" }), b);
    expect(obs.filter((o) => o.inRange === false).map((o) => o.seq)).toEqual([0, 3]);
    const p3 = posts.find((p) => p.key.endsWith(":3"))!;
    expect(["succeeded", "partial"]).toContain(p3.status);
    expect(p3.reasons?.sort()).toEqual(["authored", "commented"]);
    // A로만 찾은 20번 글은 글 작성일(3/1)이 기간 밖
    const p20 = posts.find((p) => p.key.endsWith(":20"))!;
    expect(p20.status).toBe("skipped");
    expect(p20.result?.outOfRange).toBe(true);
    expect(posts.some((p) => p.key.endsWith(":8"))).toBe(false);
  });

  it("F04 여러 조건에 걸린 글: 데이터 하나, 선정 사유 여러 개", async () => {
    const b = new FakeBand(ITEMS(), [3]);
    const { job, posts } = await run(sel({ authored: true, commentedPosts: true }), b);
    expect(posts.filter((p) => p.key.endsWith(":3"))).toHaveLength(1);
    expect(b.opened.filter((n) => n === 3)).toHaveLength(1);
    const caps = await cdb().captures.where("jobId").equals(job.id).toArray();
    expect(caps.filter((c) => c.key.endsWith(":3"))).toHaveLength(1);
    expect(caps.find((c) => c.key.endsWith(":3"))!.reasons?.sort()).toEqual(["authored", "commented"]);
  });

  it("F05·F14 댓글만(B): 원글을 열지 않고, 파일에 다른 사람의 대화 전문이 없다. 선정 정보는 파일 왕복 후에도 남는다", async () => {
    const b = new FakeBand(ITEMS());
    const { job, posts } = await run(sel({ commentsOnly: true }), b);
    expect(posts).toHaveLength(0);
    expect(b.opened).toEqual([]);
    expect(b.clicks).toEqual([]);
    const { parts, report } = await exportJob(job.id);
    const r = await readArchive(parts.map((p) => p.blob));
    const docs = r.data.documents;
    expect(docs).toHaveLength(1);
    expect(docs[0].inputFormat).toBe("band-member-comments");
    expect(Object.keys(docs[0].entries)).toHaveLength(4);
    const everything = new TextDecoder().decode(new Uint8Array(await parts[0].blob.arrayBuffer()));
    // 원글의 다른 사람 댓글(가람의 댓글)·원글 본문 뒷부분은 들어가지 않는다. 목록의 원글 발췌는 남는다
    expect(everything).not.toContain("본명 좋아요");
    expect(everything).not.toContain("고개를 돌린다");
    expect(report.selection).toMatchObject({ modes: { commentsOnly: true }, comments: { observed: 4, listTextOnly: 4 } });
    expect((r.captureReport as typeof report).selection?.comments.observed).toBe(4);
  });

  it("F10 목록을 다 훑기 전에 찾은 글부터 저장한다", async () => {
    const b = new FakeBand([], []);
    let round = 0;
    b.discoverRound = async () => {
      round++;
      b.events.push(`round:${round}`);
      const n = Math.min(round, 6);
      return { links: Array.from({ length: n }, (_, i) => postUrl(100 + i)), scrollHeight: 100 * round, loading: false, atBottom: true, endMarker: false, loginRequired: false };
    };
    const { posts } = await run(sel({ authored: true }), b);
    expect(posts).toHaveLength(6);
    const firstExtract = b.events.findIndex((e) => e.startsWith("extract:"));
    const lastRound = b.events.lastIndexOf(`round:${round}`);
    expect(firstExtract).toBeGreaterThan(-1);
    expect(firstExtract).toBeLessThan(lastRound);
  });

  it("F12·F13 이미지가 느려도 다음 글을 저장하고, 같은 이미지 주소는 한 번만 받는다", async () => {
    const b = new FakeBand([], [201, 202, 203]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const perUrl = new Map<string, number>();
    b.fetchAsset = async (url: string) => {
      perUrl.set(url, (perUrl.get(url) ?? 0) + 1);
      b.events.push("asset");
      await gate;
      return { ok: false, code: "assetNetwork" as const };
    };
    const extract = b.extractPost.bind(b);
    b.extractPost = async (t) => {
      const r = await extract(t);
      if (t.url!.endsWith("/203")) setTimeout(release, 0);
      return r;
    };
    await run(sel({ authored: true }), b, { includeImages: true });
    // 첫 글의 이미지를 받는 중(대기)에도 나머지 글을 열었다
    const firstAsset = b.events.indexOf("asset");
    expect(b.events.slice(firstAsset).filter((e) => e.startsWith("extract:")).length).toBeGreaterThanOrEqual(2);
    expect([...perUrl.values()].every((n) => n === 1)).toBe(true);
  });

  it("F01 같은 이름의 다른 사람 댓글과 섞지 않는다: 글자·시각이 모두 맞아야 같은 댓글", async () => {
    const cap = { html: postHtml(3) };
    // 나래가 둘(0 / 저는 다른 나래입니다.) — 이름만 같고 글자가 다르면 대조 실패
    expect(commentInCapture({ text: "0", local: "2026-03-01T23:52", memberName: "나래" }, cap)).toBe(true);
    expect(commentInCapture({ text: "0", local: "2026-03-02T01:00", memberName: "나래" }, cap)).toBe(false);
    expect(commentInCapture({ text: "안녕 @다온 반가워", local: null, memberName: "가람" }, cap)).toBe(false);
  });

  it("F15 진단 파일에 인물 이름·멤버 식별자·댓글·발췌가 없다", async () => {
    const b = new FakeBand(ITEMS(), [3]);
    const { job, tasks } = await run(sel({ authored: true, commentsOnly: true, commentedPosts: true }), b);
    const text = await buildDiagnosticText((await cdb().jobs.get(job.id))!, tasks, { includeStructure: true });
    for (const bad of [MEMBER, "나래", "반가워", "첫 줄", "band.us"]) expect(text).not.toContain(bad);
    expect(text).toContain('"scope": "selection"');
  });
});
