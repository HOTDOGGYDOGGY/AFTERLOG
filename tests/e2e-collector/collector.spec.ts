// 수집 확장 실제 설치 검사(가짜 밴드 서버). 실제 밴드 화면 검증이 아니다(D12).
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const EXT = resolve(process.cwd(), "dist-collector-test");
const OUT = resolve(process.cwd(), "test-results/collector");
mkdirSync(OUT, { recursive: true });
const BAND = "http://localhost:4588/band/424242";

let ctx: BrowserContext;
let extId: string;

test.beforeAll(async () => {
  ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), "al-ext-")), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker");
  extId = new URL(sw.url()).host;
});
test.afterAll(async () => ctx?.close());

async function manager(query = ""): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/manager.html${query}`);
  return p;
}

async function waitStatus(p: Page, text: RegExp, timeout = 150_000) {
  try {
    await expect(p.locator(".job-head .badge")).toHaveText(text, { timeout });
  } catch (e) {
    await p.screenshot({ path: `${OUT}/fail-${Date.now()}.png`, fullPage: true }).catch(() => undefined);
    throw e;
  }
}

const stat = (p: Page, label: string) => p.locator(".stat", { hasText: label }).locator("b");

test("목록에서 글 찾기 → 순차 수집 → 일부·실패 보고 → .afterlog 저장 → 웹 앱에서 열기", async () => {
  const p = await manager();
  await p.getByRole("radio", { name: "목록에서 글 찾기" }).click();
  await p.getByPlaceholder("https://band.us/band/12345").fill(BAND);
  await p.getByRole("button", { name: "수집 시작" }).click();
  await waitStatus(p, /끝남/);
  await p.screenshot({ path: `${OUT}/01-list-finished.png`, fullPage: true });
  await expect(p.locator(".stat.wide b")).toHaveText("22");
  await expect(p.locator(".stat.wide")).toContainText("끝 확인 불가");
  await expect(stat(p, "확보").first()).toHaveText("20");
  await expect(stat(p, "일부 확보")).toHaveText("1");
  await expect(stat(p, "실패").first()).toHaveText("1");
  // 로그인 화면을 이미지로 준 주소(T14) + 서버에 없는 이미지(404)
  await expect(stat(p, "이미지 실패")).toHaveText("2");
  // 7번 글은 '이전 댓글 보기'를 눌러 14개를 모두 확보, 9번 글은 펼칠 버튼이 없어 일부 확보
  await expect(p.locator("tr.st-partial")).toContainText("12개 중 8개");
  await expect(p.locator("tr.st-partial")).toContainText("버튼을 찾지 못함(원인 미확인");
  // 원인을 확인하지 못한 부족분을 삭제로 단정하지 않는다
  await expect(p.locator("tr.st-partial")).not.toContainText("삭제");
  // 합계: 표시 수는 고치지 않고 따로(max로 맞추지 않음)
  await expect(p.locator(".totals")).toContainText("밴드 표시");
  await expect(p.locator(".totals")).toContainText("저장한 글 21개");
  await expect(p.locator("tr", { hasText: "· 7번 글의" })).toContainText("14 / 14");
  await expect(p.locator("tr.st-failed")).toContainText("게시글을 찾지 못했습니다");

  // 로컬 확인
  await p.locator("tr", { hasText: "22번 글" }).getByRole("button", { name: "로컬 확인" }).click();
  await expect(p.locator(".capture-preview li").first()).toContainText("22번 글의 첫 줄 대사.");
  await p.getByLabel("원래 화면과 내용이 맞음").check();
  // 글 제목: 한 번 누르면 전체 내용, 두 번 누르면 밴드에서 원래 글 열기(펼침 상태는 그대로)
  const title = p.locator("tr", { hasText: "· 20번 글의" }).locator(".post-title");
  await title.click();
  // 펼침은 한 번에 한 글
  await expect(p.locator(".preview-row")).toHaveCount(1);
  await expect(p.locator(".preview-row")).toContainText("20번 글의 첫 줄 대사.");
  const popup = ctx.waitForEvent("page");
  await title.dblclick();
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toContain("/band/424242/post/20");
  await opened.close();
  await p.waitForTimeout(400);
  await expect(p.locator(".preview-row")).toContainText("20번 글의 첫 줄 대사.");

  // 진단: 미리보기와 저장 파일이 같고, 본문·이름·주소가 없다(D01·D04)
  await p.getByText("문제 진단 (개발자에게 보낼 파일 만들기)").click();
  await p.getByRole("button", { name: "진단 내용 보기" }).click();
  const shown = await p.getByTestId("diag-json").textContent();
  const dl = p.waitForEvent("download");
  await p.getByRole("button", { name: /진단 파일 저장/ }).click();
  const diagPath = resolve(OUT, "diag.json");
  await (await dl).saveAs(diagPath);
  const saved = readFileSync(diagPath, "utf8");
  expect(saved).toBe(shown);
  expect(saved).not.toMatch(/[가-힣]/);
  expect(saved).not.toMatch(/localhost|127\.0\.0\.1|424242|https?:/);
  const diag = JSON.parse(saved);
  expect(diag.job.userVerified).toBe("1");
  expect(diag.events.some((e: { code?: string }) => e.code === "countMismatch")).toBe(true);
  expect(diag.events.some((e: { code?: string }) => e.code === "assetNotImage")).toBe(true);

  // .afterlog 저장
  const dl2 = p.waitForEvent("download");
  await p.getByRole("button", { name: ".afterlog로 저장" }).click();
  const filePath = resolve(OUT, "collected.afterlog");
  await (await dl2).saveAs(filePath);
  await expect(p.locator(".notice.ok")).toContainText("글 21개");

  // 확장에서 보관 파일 가져오기: 바로 수집하지 않고 내용과 '부족한 자료 이어 수집'(댓글 모자란 글 + 실패한 글)을 보여 준다
  const jobsBefore = await p.locator(".mgr-jobs li").count();
  await p.locator('input[aria-label="보관 파일 가져오기"]').setInputFiles(filePath);
  await expect(p.locator(".archive-view")).toContainText("글 21개");
  await expect(p.getByRole("button", { name: /부족한 자료 이어 수집/ })).toContainText("글 2");
  await expect(p.locator(".mgr-jobs li")).toHaveCount(jobsBefore);
  const docP = ctx.waitForEvent("page");
  await p.locator(".archive-docs .ui-link").first().click();
  const docView = await docP;
  await expect(docView.locator("body")).toContainText("의 첫 줄 대사.");
  await docView.close();
  await p.locator(".archive-view").getByRole("button", { name: "닫기" }).click();

  // 웹 앱에서 열기: 여러 글이면 밴드 홈 피드부터
  const web = await ctx.newPage();
  await web.goto("http://localhost:5179/");
  await web.getByRole("button", { name: /프로젝트 없음/ }).click();
  const chooser = web.waitForEvent("filechooser");
  await web.getByRole("button", { name: /파일 열기 \(\.afterlog\)/ }).click();
  await (await chooser).setFiles(filePath);
  await expect(web.locator(".band-card")).toHaveCount(21);
  await web.screenshot({ path: `${OUT}/02-web-imported.png` });
  await web.locator(".band-card-open").first().click();
  await expect(web.locator(".band-layer")).toContainText("의 첫 줄 대사.");
  await web.keyboard.press("Escape");
  // 내용 편집 → 문서 목록 검색 → 다른 글의 댓글로 이동
  await web.getByRole("button", { name: "내용 편집" }).click();
  await expect(web.getByRole("tab", { name: "문서", exact: true }).first()).toHaveAttribute("aria-selected", "true");
  await expect(web.locator(".doc-rows li")).toHaveCount(21);
  await web.getByLabel("문서 검색").fill("3번 글의");
  await web.locator(".hit-list button").first().click();
  await expect(web.locator(".al-entry.is-selected")).toContainText("3번 글의 첫 줄 대사.");
  await web.getByRole("tab", { name: "가져오기·검토" }).click();
  await expect(web.locator(".report")).toContainText("일부 미확보");
  await expect(web.locator(".report")).toContainText("글 22개 중 21개 확보");
  await web.getByRole("tab", { name: "표정·반응 목록" }).click();
  await expect(web.getByText("확인된 표정·하트 기록이 없습니다.")).toBeVisible();
  await web.screenshot({ path: `${OUT}/04-web-reactions.png` });
  await web.getByRole("button", { name: "편집 끝내기" }).click();
  await web.keyboard.press("Escape");
  await web.locator(".band-chat-empty").click();
  await expect(web.getByText("보관된 밴드 채팅이 없습니다.")).toBeVisible();
  await web.close();
  await p.close();
});

test("T04 수집 중 관리 창을 닫아도 이어받으면 중복 없이 끝난다", async () => {
  const p = await manager();
  await p.getByRole("button", { name: "새 수집" }).click();
  await p.getByPlaceholder("https://band.us/band/12345/post/678").fill([1, 2, 3, 4, 5, 6].map((n) => `${BAND}/post/${n}`).join("\n"));
  await p.getByLabel("이미 저장한 글은 다시 열지 않고 저장본 재사용").uncheck();
  await p.getByRole("button", { name: "수집 시작" }).click();
  await expect.poll(async () => Number(await stat(p, "확보").first().textContent()), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await p.close(); // 창 강제 종료
  const q = await manager();
  await q.locator(".mgr-jobs li button").first().click();
  await expect(q.locator(".job-head .badge")).toHaveText(/중단됨/);
  await expect(q.getByText("창이 닫혀 수집이 중단됐습니다")).toBeVisible();
  // 점유 시간이 지나야 되돌아가므로, 검사에서는 점유를 바로 끝낸다(실사용은 3분 뒤)
  await q.evaluate(async () => {
    const req = indexedDB.open("afterlog-collector");
    await new Promise((r) => (req.onsuccess = r));
    const db = req.result;
    const tx = db.transaction("tasks", "readwrite");
    const st = tx.objectStore("tasks");
    const all: { status: string; leaseUntil: number }[] = await new Promise((r) => {
      const g = st.getAll();
      g.onsuccess = () => r(g.result);
    });
    for (const t of all) if (t.status === "inFlight") st.put({ ...t, leaseUntil: 1 });
    await new Promise((r) => (tx.oncomplete = r));
  });
  await q.getByRole("button", { name: "이어받기" }).click();
  await waitStatus(q, /끝남/);
  await expect(stat(q, "확보").first()).toHaveText("6");
  const n = await q.evaluate(async () => {
    const req = indexedDB.open("afterlog-collector");
    await new Promise((r) => (req.onsuccess = r));
    const tx = req.result.transaction(["captures", "jobs"]);
    const all: { jobId: string }[] = await new Promise((r) => {
      const g = tx.objectStore("captures").getAll();
      g.onsuccess = () => r(g.result);
    });
    const jobs: { id: string; createdAt: string }[] = await new Promise((r) => {
      const g = tx.objectStore("jobs").getAll();
      g.onsuccess = () => r(g.result);
    });
    const latest = jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id;
    return { mine: all.filter((c) => c.jobId === latest).length, total: all.length, jobs: jobs.length };
  });
  // 이 작업 안에서는 글마다 수집본 하나(이어받아도 늘지 않음)
  expect(n.mine).toBe(6);
  await q.close();
});

test("팝업: 지금 열린 글 저장(탭을 이동시키지 않음)", async () => {
  const band = await ctx.newPage();
  await band.goto(`${BAND}/post/3`);
  await expect(band.locator(".cPostCard")).toBeVisible();
  const helper = await manager();
  const tabId = await helper.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost:4588/*" }))[0].id);
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
  const mgrPromise = ctx.waitForEvent("page");
  await popup.getByRole("button", { name: "이 글 저장" }).click();
  const mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await waitStatus(mgr, /끝남/, 60_000);
  await expect(stat(mgr, "확보").first()).toHaveText("1");
  expect(band.url()).toBe(`${BAND}/post/3`);
  await mgr.screenshot({ path: `${OUT}/03-popup-single.png`, fullPage: true });
  await helper.close();
  await band.close();
});

test("밴드 화면 저장 막대: 글 화면·목록 화면에서 바로 저장", async () => {
  const band = await ctx.newPage();
  await band.goto(`${BAND}/post/3`);
  await expect(band.locator(".cPostCard")).toBeVisible();
  const bar = band.locator("#afterlog-collector-bar");
  await expect(bar.getByRole("button", { name: "이 글 저장" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "골라서 저장…" })).toBeVisible();
  await band.screenshot({ path: `${OUT}/04-page-bar.png` });

  // 이 글 저장: 지금 탭을 그대로 읽는다
  let mgrPromise = ctx.waitForEvent("page");
  await bar.getByRole("button", { name: "이 글 저장" }).click();
  let mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await waitStatus(mgr, /끝남/, 60_000);
  await expect(stat(mgr, "확보").first()).toHaveText("1");
  expect(band.url()).toBe(`${BAND}/post/3`);
  await mgr.close();

  // 목록 화면: '이 글 저장'은 없고 전체 저장만
  await band.goto(BAND);
  await expect(bar.getByRole("button", { name: "이 글 저장" })).toBeHidden();
  mgrPromise = ctx.waitForEvent("page");
  await bar.getByRole("button", { name: "이 밴드 글 전체 저장" }).click();
  mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await expect(mgr.locator(".job-head")).toContainText("밴드 글 목록");
  await expect(mgr.locator(".job-head .badge")).toHaveText(/수집 중|끝남/, { timeout: 30_000 });
  await mgr.close();

  // 숨기기 → 작은 버튼으로 다시 열기
  await bar.getByRole("button", { name: "저장 막대 숨기기" }).click();
  await expect(bar.getByRole("button", { name: "이 밴드 글 전체 저장" })).toBeHidden();
  await bar.getByRole("button", { name: "AFTERLOG 저장" }).click();
  await expect(bar.getByRole("button", { name: "이 밴드 글 전체 저장" })).toBeVisible();
  await band.close();
});

test("인물 선택(C): 인물 댓글 목록에서 '연결된 원글까지' → 항목을 눌러 원글 확인, 같은 원글은 한 번만", async () => {
  const hits0 = await (await fetch("http://localhost:4588/stats")).json();
  const band = await ctx.newPage();
  await band.goto(`${BAND}/member/MKNARAE/comment`);
  const bar = band.locator("#afterlog-collector-bar");
  await expect(bar.getByRole("button", { name: "이 댓글 목록 저장" })).toBeVisible();
  await band.screenshot({ path: `${OUT}/05-member-comments-bar.png` });
  const mgrPromise = ctx.waitForEvent("page");
  await bar.getByRole("button", { name: "연결된 원글까지" }).click();
  const mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await waitStatus(mgr, /끝남/, 120_000);
  // 댓글 5개 관측, 5개 모두 원글 확인(3번 글 셋 · 8번 · 13번)
  const commentStat = mgr.locator(".stat.wide", { hasText: "댓글 관측" });
  await expect(commentStat.locator("b")).toHaveText("5");
  await expect(commentStat).toContainText("원글 확인 5");
  await expect(mgr.locator("tbody tr")).toHaveCount(3);
  // 앞 검사에서 이미 저장한 글은 다시 열지 않고 저장본을 재사용해 파일에 포함한다
  await expect(stat(mgr, "확보").first()).toHaveText("3");
  await expect(mgr.locator(".job-head h2")).toContainText("나래");
  await mgr.screenshot({ path: `${OUT}/06-selection-finished.png`, fullPage: true });
  // 3번 글은 글 탭에서 한 번만 열었다(같은 원글의 다른 댓글은 저장본과 대조). 이미 저장한 글이면 0번
  const hits1 = await (await fetch("http://localhost:4588/stats")).json();
  expect((hits1["3"] ?? 0) - (hits0["3"] ?? 0)).toBeLessThanOrEqual(1);
  // 목록의 선택 체크박스는 누르지 않았다(쓰기·선택 동작 없음)
  for (const p of ctx.pages().filter((x) => x.url().includes("/member/MKNARAE/comment"))) {
    expect(await p.evaluate(() => document.querySelectorAll("input:checked").length)).toBe(0);
  }
  await mgr.close();
  await band.close();
});

test("인물 선택(A): 인물 화면 '이 인물의 글' → 작성글 목록에서 찾은 글만 연다", async () => {
  const band = await ctx.newPage();
  await band.goto(`${BAND}/member/MKDAON`);
  const bar = band.locator("#afterlog-collector-bar");
  await expect(bar.getByRole("button", { name: "댓글 단 글까지" })).toBeVisible();
  const mgrPromise = ctx.waitForEvent("page");
  await bar.getByRole("button", { name: "이 인물의 글" }).click();
  const mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await waitStatus(mgr, /끝남/, 120_000);
  await expect(mgr.locator(".stat.wide", { hasText: "인물이 쓴 글" }).locator("b")).toHaveText("4");
  await expect(mgr.locator(".job-head h2")).toHaveText("다온의 쓴 글");
  await expect(mgr.locator("tbody tr")).toHaveCount(4);
  await mgr.close();
  await band.close();
});

test("골라서 저장…: 인물 화면에서 열면 인물 선택 화면이 채워진다", async () => {
  const band = await ctx.newPage();
  await band.goto(`${BAND}/member/MKDAON/post`);
  const mgrPromise = ctx.waitForEvent("page");
  await band.locator("#afterlog-collector-bar").getByRole("button", { name: "골라서 저장…" }).click();
  const mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await expect(mgr.getByRole("radio", { name: "인물·검색 선택" })).toHaveAttribute("aria-checked", "true");
  await expect(mgr.getByPlaceholder("https://band.us/band/12345/member/…")).toHaveValue(`${BAND}/member/MKDAON`);
  await expect(mgr.getByText("인식한 인물 1명")).toBeVisible();
  await mgr.getByLabel(/이 인물이 쓴 댓글만/).check();
  await expect(mgr.locator(".notice", { hasText: "선택한 인물의 쓴 글·쓴 댓글·댓글 단 글" })).toBeVisible();
  await mgr.screenshot({ path: `${OUT}/07-selection-form.png`, fullPage: true });
  await mgr.close();
  await band.close();
});

test("검색 결과(D): 밴드에서 연 검색 결과 '이 검색 결과 저장' → 본문에서 검색어를 다시 확인", async () => {
  const band = await ctx.newPage();
  await band.goto(`${BAND}/search?keyword=${encodeURIComponent("7번")}`);
  const bar = band.locator("#afterlog-collector-bar");
  await expect(bar.getByRole("button", { name: "검색 조건 수정…" })).toBeVisible();
  const mgrPromise = ctx.waitForEvent("page");
  await bar.getByRole("button", { name: "이 검색 결과 저장" }).click();
  const mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await waitStatus(mgr, /끝남/, 120_000);
  await expect(mgr.locator(".job-head h2")).toContainText("검색 결과 중 '7번'");
  // '7번'이 들어간 글: 17·7
  await expect(mgr.locator(".stat.wide", { hasText: "검색 결과에서 찾은 글" }).locator("b")).toHaveText("2");
  await expect(mgr.locator("tbody tr")).toHaveCount(2);
  await expect(mgr.locator("tbody tr").first()).toContainText("일치: 본문 7번");
  await mgr.screenshot({ path: `${OUT}/08-search-finished.png`, fullPage: true });
  await mgr.close();
  await band.close();
});

test("검색 결과 주소 여러 개: 주소마다 검색어를 읽어 채우고(행별로 고침), 두 검색 결과의 글을 합쳐 모은다", async () => {
  const mgr = await manager();
  await mgr.getByRole("radio", { name: "인물·검색 선택" }).click();
  await mgr.getByPlaceholder("밴드 검색 결과 화면의 주소").fill(`${BAND}/search?keyword=${encodeURIComponent("7번")}\n${BAND}/search?keyword=${encodeURIComponent("3번")}`);
  await expect(mgr.locator(".search-detected li")).toHaveCount(2);
  await expect(mgr.getByLabel("주소 1의 검색어")).toHaveValue("7번");
  await expect(mgr.getByLabel("주소 2의 검색어")).toHaveValue("3번");
  // 주소 2의 검색어만 고친다: 주소 1은 그대로, 주소를 다시 넣어도 고친 행은 덮지 않는다
  await mgr.getByLabel("주소 2의 검색어").fill("13번");
  await mgr.getByPlaceholder("밴드 검색 결과 화면의 주소").fill(`${BAND}/search?keyword=${encodeURIComponent("7번")}\n${BAND}/search?keyword=${encodeURIComponent("3번")}\n`);
  await expect(mgr.getByLabel("주소 1의 검색어")).toHaveValue("7번");
  await expect(mgr.getByLabel("주소 2의 검색어")).toHaveValue("13번");
  await expect(mgr.locator(".search-detected li").nth(1)).toContainText("직접 고침");
  await mgr.screenshot({ path: `${OUT}/09-multi-search-form.png`, fullPage: true });
  await mgr.getByRole("button", { name: "수집 시작" }).click();
  await waitStatus(mgr, /끝남/, 120_000);
  await expect(mgr.locator(".job-head h2")).toContainText("검색 결과 2곳");
  // 주소 1('7번'): 17·7 · 주소 2(검색 '3번', 다시 확인 '13번'): 13은 맞고 3은 빠짐. '7번'과 '13번'을 둘 다 포함하라고 묶지 않는다
  await expect(mgr.locator("tbody tr")).toHaveCount(4);
  await expect(mgr.locator("tr", { hasText: "· 3번 글의" })).toContainText("검색어가 본문");
  await expect(mgr.locator("tr", { hasText: "· 7번 글의" })).not.toContainText("검색어가 본문");
  await expect(mgr.locator("tr", { hasText: "13번 글의" })).not.toContainText("검색어가 본문");
  await expect(mgr.locator(".stat.wide", { hasText: "검색 결과에서 찾은 글" })).toHaveCount(2);
  // HTML로 저장: 목차와 글 HTML
  const dl = mgr.waitForEvent("download");
  await mgr.getByRole("button", { name: "HTML로 저장" }).click();
  const d = await dl;
  const zipPath = resolve(OUT, "multi-search-html.zip");
  await d.saveAs(zipPath);
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
  expect(Object.keys(files)).toContain("index.html");
  expect(Object.keys(files)).toHaveLength(4);
  expect(strFromU8(files["index.html"])).toContain("17번 글의 첫 줄 대사.");
  await mgr.close();
});

test("인물 프로필 저장: 스토리 상세를 열어 전문·댓글(이전 댓글 펼치기)까지 구조로 저장, 쓰기 버튼은 누르지 않음", async () => {
  const band = await ctx.newPage();
  await band.goto(`${BAND}/member/MKDAON/profile`);
  const bar = band.locator("#afterlog-collector-bar");
  const mgrPromise = ctx.waitForEvent("page");
  await bar.getByRole("button", { name: "이 프로필 저장" }).click();
  const mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await waitStatus(mgr, /끝남/, 180_000);
  const tile = mgr.locator(".stat.wide", { hasText: "프로필" });
  await expect(tile.locator("b")).toHaveText("스토리 4");
  await expect(tile).toContainText("다온");
  await mgr.screenshot({ path: `${OUT}/10-profile-finished.png`, fullPage: true });
  // 구조화 보관본: 상세 전문, 스토리별 표정·댓글 수, 펼친 댓글 18개, 스크립트 없음
  let viewP = ctx.waitForEvent("page");
  await tile.getByRole("button", { name: "보관본 보기" }).click();
  let view = await viewP;
  await view.waitForLoadState();
  await expect(view.locator("h1")).toHaveText("다온");
  await expect(view.locator(".story")).toHaveCount(4);
  await expect(view.locator("#story-1")).toContainText("다음 이야기는 3월에.");
  await expect(view.locator("#story-2 .comments > li")).toHaveCount(18);
  await expect(view.locator("#story-2 .counts")).toContainText("이 스토리의 표정 4 · 댓글 18");
  await expect(view.locator("#profile")).toContainText("프로필 표정");
  await expect(view.locator("#photos")).toContainText("프로필 사진 이력 구조 미확인(현재 사진만 저장)");
  // 인물 화면 '사진' 탭: 스크롤로 더 불러온 것까지 6장, 사진을 누르지 않음
  await expect(view.locator("#member-photos .g-img")).toHaveCount(6);
  expect(await view.locator(".face").getAttribute("src")).toMatch(/^data:image\//);
  expect(await view.evaluate(() => document.querySelectorAll("script").length)).toBe(0);
  await view.screenshot({ path: `${OUT}/11-profile-structured.png`, fullPage: true });
  await view.close();
  // 보관 당시 화면(스냅숏)
  viewP = ctx.waitForEvent("page");
  await tile.getByRole("button", { name: "보관 당시 화면" }).click();
  view = await viewP;
  await view.waitForLoadState();
  await expect(view.locator(".userName")).toHaveText("다온");
  await expect(view.locator(".storyItem")).toHaveCount(4);
  expect(await view.locator(".backImage").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("data:image/");
  await view.close();
  // 하트·표정·답글쓰기·차단 메뉴·댓글 입력은 누르지 않았다
  for (const p of ctx.pages().filter((x) => x.url().includes("/member/MKDAON/profile"))) expect(await p.evaluate(() => (window as unknown as { __traps: number }).__traps)).toBe(0);
  // .afterlog → 웹 앱: 프로필이 가운데에 구조로 보인다
  const dl = mgr.waitForEvent("download");
  await mgr.getByRole("button", { name: /\.afterlog로 저장/ }).click();
  const file = resolve(OUT, "profile.afterlog");
  await (await dl).saveAs(file);
  const web = await ctx.newPage();
  await web.goto("http://localhost:5179/");
  await web.locator(".project-switch").click();
  const chooser = web.waitForEvent("filechooser");
  await web.getByRole("button", { name: /파일 열기 \(\.afterlog\)/ }).click();
  await (await chooser).setFiles(file);
  const pv = web.locator(".profile-view");
  await expect(pv.locator("h2.pv-name")).toHaveText("다온");
  await pv.getByRole("tab", { name: /스토리/ }).click();
  await expect(pv.locator(".pv-story")).toHaveCount(4);
  await expect(pv.locator(".pv-story").nth(1).locator(".pv-comment")).toHaveCount(18);
  await web.screenshot({ path: `${OUT}/12-profile-in-app.png`, fullPage: true });
  await web.close();
  await mgr.close();
  await band.close();
});

test("주소가 그대로인 프로필 팝업: 기본 정보를 읽고 '스토리 보기'로 인물 주소를 알아내 프로필 전체(스토리·댓글)까지, 사용자 화면은 되돌림", async () => {
  const band = await ctx.newPage();
  await band.goto(`${BAND}/member`);
  const bar = band.locator("#afterlog-collector-bar");
  await expect(bar.getByRole("button", { name: "이 프로필 저장" })).toHaveCount(0);
  await band.getByRole("button", { name: "다온" }).click();
  // 주소는 그대로인데 막대가 팝업을 알아본다
  await expect(bar.getByRole("button", { name: "이 프로필 저장" })).toBeVisible({ timeout: 5000 });
  expect(band.url()).toBe(`${BAND}/member`);
  let mgrPromise = ctx.waitForEvent("page");
  await bar.getByRole("button", { name: "이 프로필 저장" }).click();
  let mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await waitStatus(mgr, /끝남/, 180_000);
  let tile = mgr.locator(".stat.wide", { hasText: "프로필" });
  await expect(tile.locator("b")).toHaveText("스토리 4");
  await expect(tile).toContainText("다온");
  const viewP = ctx.waitForEvent("page");
  await tile.getByRole("button", { name: "보관본 보기" }).click();
  const view = await viewP;
  await view.waitForLoadState();
  await expect(view.locator("h1")).toHaveText("다온");
  await expect(view.locator("body")).not.toContainText("원본 인물 연결 미확인");
  await expect(view.locator("body")).toContainText("'스토리 보기'로 인물 주소를 확인");
  await expect(view.locator("#story-2 .comments > li")).toHaveCount(18);
  await expect(view.locator("#profile")).toContainText("프로필 표정7");
  await expect(view.locator("a", { hasText: "밴드에서 열기" }).first()).toHaveAttribute("href", /\/member\/MKDAON\/profile$/);
  await view.close();
  // 사용자 탭은 멤버 목록으로 돌아와 있고, 하트·채팅·다음 프로필은 누르지 않았다
  await expect(band).toHaveURL(`${BAND}/member`);
  expect(await band.evaluate(() => (window as unknown as { __traps(): number }).__traps())).toBe(0);
  await mgr.close();

  // 스토리가 0개인 인물: '스토리 보기'가 없으면 '작성글 보기'로 주소만 바꿔 알아낸다
  await band.getByRole("button", { name: "나래" }).click();
  await expect(bar.getByRole("button", { name: "이 프로필 저장" })).toBeVisible({ timeout: 5000 });
  mgrPromise = ctx.waitForEvent("page");
  await bar.getByRole("button", { name: "이 프로필 저장" }).click();
  mgr = await mgrPromise;
  await mgr.waitForLoadState();
  await waitStatus(mgr, /끝남/, 180_000);
  tile = mgr.locator(".stat.wide", { hasText: "프로필" });
  await expect(tile).toContainText("나래");
  // 밴드가 '아직 작성된 스토리가 없어요'라고 보여 주면 0개 확인(팝업 수도 0이라 어긋남 없음)
  await expect(tile.locator("b")).toHaveText("스토리 0");
  await expect(tile).not.toContainText("원인 미확인");
  await expect(band).toHaveURL(`${BAND}/member`);
  expect(await band.evaluate(() => (window as unknown as { __traps(): number }).__traps())).toBe(0);
  await mgr.close();
  await band.close();
});

test("직접 열며 수집: 사용자가 연 팝업·프로필·스토리를 한 인물에 누적, 다른 인물은 범위 밖, 쓰기 버튼 누르지 않음", async () => {
  const band = await ctx.newPage();
  await band.goto(`${BAND}/member`);
  const bar = band.locator("#afterlog-collector-bar");
  const mgrPromise = ctx.waitForEvent("page");
  await bar.getByRole("button", { name: "직접 열며 수집" }).click();
  const mgr = await mgrPromise;
  await mgr.waitForLoadState();
  const panel = mgr.locator(".follow-panel");
  await expect(panel).toContainText("직접 열며 수집 중", { timeout: 15_000 });
  await expect(bar.getByRole("button", { name: /직접 열며 수집 중/ })).toBeVisible({ timeout: 10_000 });

  // 1) 팝업을 연다 → 기본 정보 저장
  await band.getByRole("button", { name: "다온" }).click();
  await expect(panel.locator(".follow-log")).toContainText("저장: 다온", { timeout: 15_000 });
  // 2) 사용자가 '스토리 보기'를 눌러 프로필 화면으로 → 스토리가 늦게 떠도 따라 읽음
  await band.locator("a._storyAnchor").click();
  await band.waitForURL(/\/member\/MKDAON\/profile$/);
  await expect(panel.locator(".follow-log")).toContainText("스토리 +2", { timeout: 20_000 });
  // 3) 스토리 하나를 열면 전문과 보이는 댓글을 보탬
  await band.locator("a.storyDetailLink").nth(1).click();
  await expect(panel.locator(".follow-log")).toContainText("댓글 +10", { timeout: 20_000 });
  expect(await band.evaluate(() => (window as unknown as { __traps: number }).__traps)).toBe(0);
  // 4) 다른 인물(나래)의 팝업은 저장하지 않는다
  await band.goto(`${BAND}/member`);
  await expect(bar.getByRole("button", { name: /직접 열며 수집 중/ })).toBeVisible({ timeout: 10_000 });
  await band.getByRole("button", { name: "나래" }).click();
  await expect(panel.locator(".follow-log")).toContainText("범위 밖", { timeout: 15_000 });
  await expect(bar).toContainText("범위 밖");
  // 결과: 한 인물(다온), 스토리 2(상세 1), 댓글 10
  const tile = mgr.locator(".stat.wide", { hasText: "프로필" });
  await expect(tile).toContainText("다온");
  await expect(tile.locator("b")).toHaveText("스토리 2");
  await mgr.screenshot({ path: `${OUT}/13-follow-mode.png`, fullPage: true });
  // 5) 막대에서 멈추기
  await bar.getByRole("button", { name: /멈추기/ }).click();
  await expect(panel).toContainText("직접 열며 수집 멈춤", { timeout: 10_000 });
  // 저장: 글 0개여도 프로필만으로 .afterlog
  const dl = mgr.waitForEvent("download");
  await mgr.getByRole("button", { name: /\.afterlog로 저장/ }).click();
  await (await dl).saveAs(resolve(OUT, "follow.afterlog"));
  await mgr.close();
  await band.close();
});
