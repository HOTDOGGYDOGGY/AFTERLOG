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
  await expect(p.locator(".job-head .badge")).toHaveText(text, { timeout });
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
  await expect(p.locator("tr.st-partial")).toContainText("14개 중 8개");
  await expect(p.locator("tr.st-failed")).toContainText("게시글을 찾지 못했습니다");

  // 로컬 확인
  await p.locator("tr", { hasText: "22번 글" }).getByRole("button", { name: "로컬 확인" }).click();
  await expect(p.locator(".capture-preview li").first()).toContainText("22번 글의 첫 줄 대사.");
  await p.getByLabel("원래 화면과 내용이 맞음").check();

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
  await p.getByLabel("이 확장으로 이미 저장한 글은 건너뛰기").uncheck();
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
