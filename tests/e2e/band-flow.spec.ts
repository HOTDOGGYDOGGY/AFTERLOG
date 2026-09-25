// A2 완료 기준 흐름: 가져오기 → 수정 → 자동 저장 → 새로고침 → 프로젝트 파일 → 새 환경 복구 → 오프라인 HTML → 분할 PNG
import { expect, test, type Page } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";

const FIX = resolve(process.cwd(), "tests/fixtures/band");
const OUT = resolve(process.cwd(), "test-results/artifacts");
mkdirSync(OUT, { recursive: true });
const fixtureFiles = () => [resolve(FIX, "post-synthetic.html"), ...readdirSync(resolve(FIX, "page_files")).map((n) => resolve(FIX, "page_files", n))];

async function importFixture(page: Page) {
  await page.goto("/");
  await expect(page.getByText("밴드 기록 가져오기")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 선택" }).click();
  await (await chooser).setFiles(fixtureFiles());
  await expect(page.getByText("가져오기 검토")).toBeVisible();
  await expect(page.getByText("게시글 1 · 댓글 4 · 답글 3 · 인물 4 · 미분류 1")).toBeVisible();
  await page.getByRole("button", { name: /선택한 1개 가져오기/ }).click();
  await expect(page.locator(".al-post")).toBeVisible();
}

/** 이 환경의 헤드리스 Chromium은 한글 파일명을 'download'로 바꾸므로 a[download] 값을 직접 기록한다 */
async function recordDownloadNames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __dl: string[] };
    w.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download) w.__dl.push(this.download);
      return orig.call(this);
    };
  });
}
const lastDownloadName = (page: Page) => page.evaluate(() => (window as unknown as { __dl: string[] }).__dl.at(-1));

async function waitSaved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText("저장됨", { timeout: 10_000 });
}

test("밴드 글+댓글: 가져오기부터 복구·내보내기까지", async ({ page, browser }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await recordDownloadNames(page);
  await importFixture(page);

  // 원문 보존 확인: 숫자 대사·별표 지문·script 문자열
  const preview = page.locator(".preview-page");
  await expect(preview).toContainText("* 고개를 돌린다");
  await expect(preview).toContainText("<script>alert(1)</script>");
  await expect(preview.locator(".al-image-missing")).toContainText("post_photo_1.jpg");
  await expect(preview.locator(".al-image img")).toHaveCount(1);
  await page.screenshot({ path: `${OUT}/01-imported-1440.png` });

  // 본문 직접 수정 (한글)
  const zero = preview.locator(".al-comment .al-editable", { hasText: /^0$/ });
  await zero.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 수정했습니다");
  await page.locator(".preview-scroll").click({ position: { x: 5, y: 5 } });
  await expect(preview).toContainText("0 수정했습니다");

  // 인물 이름 변경
  await page.getByRole("tab", { name: "인물", exact: true }).click();
  const nameInput = page.getByLabel("표시 이름").first();
  await nameInput.fill("가람(수정)");
  await expect(preview.locator(".al-post-head .al-name")).toHaveText("가람(수정)");

  // 출력 테마 다크
  await page.getByRole("tab", { name: "표시" }).click();
  await page.getByRole("button", { name: "다크" }).click();
  await expect(preview.locator(".al-band")).toHaveClass(/al-theme-dark/);
  await waitSaved(page);

  // 실행취소/다시실행 (입력칸 밖)
  await page.locator(".preview-scroll").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(preview.locator(".al-band")).toHaveClass(/al-theme-light/);
  await page.keyboard.press("Control+y");
  await expect(preview.locator(".al-band")).toHaveClass(/al-theme-dark/);

  // 항목 메뉴로 이동: 두 번째 최상위 댓글을 위로
  const threads = preview.locator(".al-comments > .al-thread > .al-comment");
  const secondName = await threads.nth(1).locator(".al-name").first().textContent();
  await threads.nth(1).click();
  await threads.nth(1).getByRole("button", { name: "항목 메뉴" }).click();
  await page.getByRole("menuitem", { name: "위로 이동" }).click();
  await expect(threads.nth(0).locator(".al-name").first()).toHaveText(secondName!);
  await waitSaved(page);

  // F13 새로고침 후 복원
  await page.reload();
  await expect(preview.locator(".al-post-head .al-name")).toHaveText("가람(수정)");
  await expect(preview).toContainText("0 수정했습니다");
  await expect(preview.locator(".al-band")).toHaveClass(/al-theme-dark/);
  await expect(threads.nth(0).locator(".al-name").first()).toHaveText(secondName!);

  // 프로젝트 파일 저장
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "프로젝트 저장" }).click();
  await page.getByRole("menuitem", { name: /전체 저장/ }).click();
  const projDl = await dl;
  expect(await lastDownloadName(page)).toBe("[합성]_테스트_밴드.afterlog");
  const projectFile = resolve(OUT, "project.afterlog");
  await projDl.saveAs(projectFile);

  // 감상용 HTML
  await page.getByRole("button", { name: "내보내기" }).click();
  const dlHtml = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "내보내기" }).click();
  const htmlDl = await dlHtml;
  expect(await lastDownloadName(page)).toMatch(/^가람_첫_줄_대사.*\.html$/);
  const htmlPath = resolve(OUT, "export.html");
  await htmlDl.saveAs(htmlPath);

  // 분할 PNG (최대 높이를 낮춰 여러 장 강제)
  await page.getByRole("radio", { name: "PNG 이미지" }).click();
  await page.getByRole("dialog").locator('input[type="range"]').fill("1000");
  const dlPng = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "내보내기" }).click();
  const pngDl = await dlPng;
  const pngPath = resolve(OUT, "pages.zip");
  await pngDl.saveAs(pngPath);
  await expect(page.getByRole("dialog")).toContainText("장을 받았습니다");
  await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();

  expect(consoleErrors).toEqual([]);

  // ---- F19 분할 PNG 확인: 여러 장, 모두 유효한 PNG
  expect(await lastDownloadName(page)).toMatch(/_png\.zip$/);
  const pngs = unzipSync(new Uint8Array(readFileSync(pngPath)));
  const names = Object.keys(pngs).sort();
  expect(names.length).toBeGreaterThan(1);
  for (const n of names) {
    const b = pngs[n];
    expect(Array.from(b.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    writeFileSync(resolve(OUT, `png-${n}`), b);
  }

  // ---- F17 HTML: 네트워크 차단 상태에서 열기
  const offline = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 } });
  const requests: string[] = [];
  offline.on("request", (r) => {
    if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) requests.push(r.url());
  });
  const hp = await offline.newPage();
  await hp.goto("file://" + htmlPath);
  await expect(hp.locator(".al-post-head .al-name")).toHaveText("가람(수정)");
  await expect(hp.locator("body")).toContainText("0 수정했습니다");
  await expect(hp.locator("body")).toContainText("<script>alert(1)</script>");
  const imgsOk = await hp.locator("img").evaluateAll((els) => els.every((e) => (e as HTMLImageElement).naturalWidth > 0));
  expect(imgsOk).toBe(true);
  const overflow = await hp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await hp.screenshot({ path: `${OUT}/03-export-390.png`, fullPage: true });
  expect(requests).toEqual([]);
  await offline.close();

  // ---- F14 새 환경에서 프로젝트 파일 복구
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const fp = await fresh.newPage();
  await fp.goto("/");
  await expect(fp.getByText("밴드 기록 가져오기")).toBeVisible();
  await fp.getByRole("button", { name: "프로젝트" }).click();
  const chooser = fp.waitForEvent("filechooser");
  await fp.getByRole("button", { name: /프로젝트 파일\(\.afterlog\) 불러오기/ }).click();
  await (await chooser).setFiles(projectFile);
  const fpreview = fp.locator(".preview-page");
  await expect(fpreview.locator(".al-post-head .al-name")).toHaveText("가람(수정)");
  await expect(fpreview).toContainText("0 수정했습니다");
  await expect(fpreview.locator(".al-band")).toHaveClass(/al-theme-dark/);
  await expect(fpreview.locator(".al-post-head img.al-avatar")).toHaveJSProperty("complete", true);
  expect(await fpreview.locator(".al-post-head img.al-avatar").evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await fp.screenshot({ path: `${OUT}/02-restored-1280.png` });
  await fresh.close();
});

test("F16 같은 문서를 다른 탭에서 열면 이전 탭은 읽기 전용", async ({ page, context }) => {
  await importFixture(page);
  await waitSaved(page);
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator(".al-post")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("읽기 전용");
  await expect(page.getByRole("button", { name: "실행취소 (Ctrl+Z)" })).toBeDisabled();
  // 인계
  await page.getByRole("button", { name: /이 탭에서 편집하기/ }).click();
  await expect(other.getByRole("alert")).toContainText("읽기 전용");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("가져오기 실패 시 이유를 보여준다", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 선택" }).click();
  await (await chooser).setFiles({ name: "note.html", mimeType: "text/html", buffer: Buffer.from("<html><body>hello</body></html>") });
  await expect(page.getByText("찾지 못했습니다")).toBeVisible();
});

test("붙여넣은 텍스트 복사본: 부모 미확정 → 제안 적용·실행취소", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("여기에 붙여넣고").fill(readFileSync(resolve(FIX, "post-synthetic-plain.txt"), "utf8"));
  await page.getByRole("button", { name: "분석", exact: true }).click();
  await expect(page.getByText("가져오기 검토")).toBeVisible();
  await expect(page.locator(".import-review .tag").first()).toHaveText("텍스트 복사");
  await page.getByText(/원문 줄 분류 보기/).click();
  await expect(page.locator(".ln-unclassified")).toHaveCount(1);
  await page.getByRole("button", { name: /선택한 1개 가져오기/ }).click();
  const preview = page.locator(".preview-page");
  await expect(preview.locator(".is-parent-unknown")).toHaveCount(3);
  await page.getByRole("button", { name: "제안 모두 적용" }).click();
  // "@나래 본명" → 나래의 댓글, "@가람" → 가람의 댓글이 답글이라 그 부모(나래의 댓글)
  await expect(preview.locator(".al-replies .al-comment")).toHaveCount(2);
  await page.locator(".preview-scroll").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(preview.locator(".al-replies .al-comment")).toHaveCount(0);
});

test("인물별 보기에서 항목으로 이동", async ({ page }) => {
  await importFixture(page);
  await page.getByRole("tab", { name: "인물별" }).click();
  await expect(page.locator(".archive-profile h2")).toBeVisible();
  await expect(page.getByText("이 인물의 전체 글·댓글이 아닙니다", { exact: false })).toBeVisible();
  await page.locator(".archive-list button", { hasText: "나래" }).first().click();
  await page.locator(".archive-items button", { hasText: /^0/ }).first().click();
  await expect(page.locator(".al-entry.is-selected")).toContainText("0");
  await expect(page.locator(".inspector")).toContainText("작성자");
});
