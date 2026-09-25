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
  await expect(page.getByText("밴드 기록을 가져오세요.")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 열기" }).click();
  await (await chooser).setFiles(fixtureFiles());
  await expect(page.getByText("가져오기 검토")).toBeVisible();
  await expect(page.getByText("게시글 1 · 댓글 4 · 답글 3 · 인물 4 · 미분류 1")).toBeVisible();
  await page.getByRole("button", { name: /선택한 1개 가져오기/ }).click();
  // 글이 하나면 원형 보기의 상세 레이어가 바로 열린다
  await expect(page.locator(".band-layer .al-post")).toBeVisible();
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
  await expect(page.locator(".topbar .save-status")).toHaveText("자동 저장됨", { timeout: 10_000 });
}

test("밴드 글+댓글: 가져오기부터 복구·내보내기까지", async ({ page, browser }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await recordDownloadNames(page);
  await page.goto("/");
  // N01·U31: 신규 환경은 다크, 자료가 없어도 공통 플랫폼 줄과 가져오기가 보인다
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("tab", { name: /카카오톡/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "가져오기" })).toBeVisible();
  await importFixture(page);

  // N02: 원형 보기에서 꾸미기 패널과 편집 손잡이가 닫혀 있다
  const layer = page.locator(".band-layer");
  await expect(page.locator(".design-panel")).toHaveCount(0);
  await expect(layer.locator(".al-tools")).toHaveCount(0);
  await expect(layer).toContainText("* 고개를 돌린다");
  await expect(layer).toContainText("<script>alert(1)</script>");
  await expect(layer.locator(".al-image img")).toHaveCount(1);
  await expect(layer.locator(".al-archive-status")).toContainText("댓글 8개 확보");
  await page.screenshot({ path: `${OUT}/01-imported-1440.png` });

  // 내용 편집으로 전환해서 본문 직접 수정 (한글)
  await page.getByRole("button", { name: "내용 편집" }).click();
  const preview = page.locator(".preview-page");
  await expect(preview.locator(".al-image-missing")).toContainText("post_photo_1.jpg");
  const zero = preview.locator(".al-comment .al-editable", { hasText: /^0$/ });
  await zero.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 수정했습니다");
  await page.locator(".preview-scroll").click({ position: { x: 5, y: 5 } });
  await expect(preview).toContainText("0 수정했습니다");

  // 인물 이름 변경(목록에서 고르고 선택한 인물만 편집)
  await page.getByRole("tab", { name: "인물", exact: true }).click();
  await page.getByRole("option", { name: /가람/ }).click();
  await page.getByLabel("표시 이름").fill("가람(수정)");
  await expect(preview.locator(".al-post-head .al-name")).toHaveText("가람(수정)");

  // 항목 메뉴로 이동: 두 번째 최상위 댓글을 위로
  const threads = preview.locator(".al-comments > .al-thread > .al-comment");
  const secondName = await threads.nth(1).locator(".al-name").first().textContent();
  await threads.nth(1).click();
  await threads.nth(1).getByRole("button", { name: "항목 메뉴" }).click();
  await page.getByRole("menuitem", { name: "위로 이동" }).click();
  await expect(threads.nth(0).locator(".al-name").first()).toHaveText(secondName!);
  await waitSaved(page);

  // 꾸미기: 기록 테마 다크 + 둥근 사각 인장 → 실행취소·다시실행
  await page.getByRole("button", { name: "꾸미기" }).click();
  const design = page.locator(".design-panel");
  await design.getByRole("button", { name: "색·배경" }).click();
  await design.getByRole("radio", { name: "라이트" }).click();
  await expect(layer.locator(".al-band")).toHaveClass(/al-theme-light/);
  await design.getByRole("button", { name: "인장" }).click();
  await design.getByRole("radio", { name: "둥근 사각" }).click();
  await expect(layer.locator(".al-post-head .al-avatar")).toHaveClass(/is-rounded/);
  await layer.locator(".al-post-body").click();
  await page.keyboard.press("Control+z");
  await expect(layer.locator(".al-post-head .al-avatar")).toHaveClass(/is-circle/);
  await page.keyboard.press("Control+y");
  await expect(layer.locator(".al-post-head .al-avatar")).toHaveClass(/is-rounded/);
  // N05 원형으로 돌아가도 내 스킨은 보관, 다시 켜면 그대로
  await design.getByRole("radio", { name: "밴드 원형" }).click();
  await expect(layer.locator(".al-post-head .al-avatar")).toHaveClass(/is-circle/);
  await expect(layer.locator(".al-band")).toHaveClass(/al-theme-light/);
  await design.getByRole("radio", { name: "내 스킨" }).click();
  await expect(layer.locator(".al-post-head .al-avatar")).toHaveClass(/is-rounded/);
  await waitSaved(page);

  // F13 새로고침 후 복원(원형 보기로 다시 열림)
  await page.reload();
  await expect(layer.locator(".al-post-head .al-name")).toHaveText("가람(수정)");
  await expect(layer).toContainText("0 수정했습니다");
  await expect(layer.locator(".al-band")).toHaveClass(/al-theme-light/);
  await expect(layer.locator(".al-post-head .al-avatar")).toHaveClass(/is-rounded/);
  await expect(layer.locator(".al-comments > .al-thread > .al-comment").nth(0).locator(".al-name").first()).toHaveText(secondName!);

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
  await page.getByRole("dialog", { name: "감상용 파일 내보내기" }).getByRole("button", { name: "내보내기" }).click();
  const htmlDl = await dlHtml;
  expect(await lastDownloadName(page)).toMatch(/^가람_첫_줄_대사.*\.html$/);
  const htmlPath = resolve(OUT, "export.html");
  await htmlDl.saveAs(htmlPath);

  // 분할 PNG (최대 높이를 낮춰 여러 장 강제)
  await page.getByRole("radio", { name: "PNG" }).click();
  await page.getByRole("dialog", { name: "감상용 파일 내보내기" }).locator('input[type="range"]').fill("1000");
  const dlPng = page.waitForEvent("download");
  await page.getByRole("dialog", { name: "감상용 파일 내보내기" }).getByRole("button", { name: "내보내기" }).click();
  const pngDl = await dlPng;
  const pngPath = resolve(OUT, "pages.zip");
  await pngDl.saveAs(pngPath);
  await expect(page.getByRole("dialog", { name: "감상용 파일 내보내기" })).toContainText("장을 받았습니다");
  await page.getByRole("dialog", { name: "감상용 파일 내보내기" }).getByRole("button", { name: "닫기" }).click();

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

  // ---- F17 HTML: 네트워크 차단 상태에서 열기. U11: 인장 모양·테마가 출력에도 같다
  const offline = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 } });
  const requests: string[] = [];
  offline.on("request", (r) => {
    if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) requests.push(r.url());
  });
  const hp = await offline.newPage();
  await hp.goto("file://" + htmlPath);
  await expect(hp.locator(".al-post-head .al-name")).toHaveText("가람(수정)");
  await expect(hp.locator(".al-band")).toHaveClass(/al-theme-light/);
  await expect(hp.locator(".al-post-head .al-avatar")).toHaveClass(/is-rounded/);
  await expect(hp.locator("body")).toContainText("0 수정했습니다");
  await expect(hp.locator("body")).toContainText("<script>alert(1)</script>");
  await expect(hp.locator("button, .al-tools, .al-action-strip")).toHaveCount(0);
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
  await expect(fp.getByText("밴드 기록을 가져오세요.")).toBeVisible();
  await fp.getByRole("button", { name: /프로젝트 없음/ }).click();
  const chooser = fp.waitForEvent("filechooser");
  await fp.getByRole("button", { name: /파일 열기 \(\.afterlog\)/ }).click();
  await (await chooser).setFiles(projectFile);
  const flayer = fp.locator(".band-layer");
  await expect(flayer.locator(".al-post-head .al-name")).toHaveText("가람(수정)");
  await expect(flayer).toContainText("0 수정했습니다");
  await expect(flayer.locator(".al-band")).toHaveClass(/al-theme-light/);
  await expect(flayer.locator(".al-post-head .al-avatar img")).toHaveJSProperty("complete", true);
  expect(await flayer.locator(".al-post-head .al-avatar img").evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await fp.screenshot({ path: `${OUT}/02-restored-1280.png` });
  await fresh.close();
});

test("F16 같은 문서를 다른 탭에서 열면 이전 탭은 읽기 전용", async ({ page, context }) => {
  await importFixture(page);
  await waitSaved(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator(".band-layer .al-post")).toBeVisible();
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
  await page.getByRole("button", { name: "파일 열기" }).click();
  await (await chooser).setFiles({ name: "note.html", mimeType: "text/html", buffer: Buffer.from("<html><body>hello</body></html>") });
  await expect(page.getByText("찾지 못했습니다")).toBeVisible();
});

test("붙여넣은 텍스트 복사본: 부모 미확정 → 제안 적용·실행취소", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "텍스트 붙여넣기" }).click();
  await page.getByLabel("게시글 영역 HTML 또는 화면에서 복사한 글").fill(readFileSync(resolve(FIX, "post-synthetic-plain.txt"), "utf8"));
  await page.getByRole("button", { name: "분석", exact: true }).click();
  await expect(page.getByText("가져오기 검토")).toBeVisible();
  await expect(page.locator(".import-review .tag").first()).toHaveText("텍스트 복사");
  await page.getByText(/원문 줄 분류 보기/).click();
  await expect(page.locator(".ln-unclassified")).toHaveCount(1);
  await page.getByRole("button", { name: /선택한 1개 가져오기/ }).click();
  await page.getByRole("button", { name: "내용 편집" }).click();
  const preview = page.locator(".preview-page");
  await expect(preview.locator(".is-parent-unknown")).toHaveCount(3);
  await page.getByRole("button", { name: "제안 모두 적용" }).click();
  // "@나래 본명" → 나래의 댓글, "@가람" → 가람의 댓글이 답글이라 그 부모(나래의 댓글)
  await expect(preview.locator(".al-replies .al-comment")).toHaveCount(2);
  await page.locator(".preview-scroll").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(preview.locator(".al-replies .al-comment")).toHaveCount(0);
});

test("N04 글 → 인물 → 댓글 원문 → 뒤로가기로 목록·선택 복원", async ({ page }) => {
  await importFixture(page);
  const layer = page.locator(".band-layer");
  await layer.locator(".al-comment .al-name", { hasText: "나래" }).first().click();
  await expect(page.locator(".band-profile-head h2")).toHaveText("나래");
  await expect(page.getByText("이 인물의 전체 활동이 아닙니다", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: /작성 댓글/ }).click();
  await page.locator(".band-profile-items button", { hasText: /^0/ }).first().click();
  // 해당 댓글로 이동해 강조
  await expect(layer.locator(".al-entry.is-highlight")).toContainText("0");
  expect(page.url()).toMatch(/#\/band\/post\/[^/]+\/[^/]+$/);
  // 새로고침해도 같은 글·댓글
  await page.reload();
  await expect(layer.locator(".al-entry.is-highlight")).toContainText("0");
  // 뒤로가기 → 인물 프로필(작성 댓글 탭 유지)
  await page.goBack();
  await expect(page.getByRole("tab", { name: /작성 댓글/ })).toHaveAttribute("aria-selected", "true");
  // Esc로 닫으면 앞 화면으로
  await page.keyboard.press("Escape");
  await expect(layer.locator(".al-post")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".band-feed")).toBeVisible();
  await expect(page.locator(".band-stage")).toHaveCount(0);
});

test("N07 원형 보기의 표정 내역·인장 클릭은 보관 기록만 보여 준다", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("http://localhost") && !u.startsWith("data:") && !u.startsWith("blob:")) requests.push(u);
  });
  await importFixture(page);
  await page.getByRole("button", { name: "표정 내역" }).click();
  await expect(page.getByRole("dialog", { name: /표정 내역/ })).toContainText("실제 밴드에 표정을 남기지 않습니다");
  await page.getByRole("dialog", { name: /표정 내역/ }).getByRole("button", { name: "닫기" }).click();
  expect(requests).toEqual([]);
});
