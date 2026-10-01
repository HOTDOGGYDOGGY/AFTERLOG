// 로컬 실행판(npm run build:local → dist-local/index.html)을 서버 없이 파일(file://)로 열어도 동작하는지.
// dist-local이 없으면 건너뛴다(먼저 npm run build:local).
import { expect, test } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const INDEX = resolve(process.cwd(), "dist-local/index.html");
const FIX = resolve(process.cwd(), "tests/fixtures/band");
const fixtureFiles = () => [resolve(FIX, "post-synthetic.html"), ...readdirSync(resolve(FIX, "page_files")).map((n) => resolve(FIX, "page_files", n))];
const KAKAO = "테스트 님과 카카오톡 대화\n[하진] [오후 9:31] 아직 안 잤어?\n[서윤] [오후 9:32] 응. 지금 내려갈게.";

test.skip(!existsSync(INDEX), "dist-local 없음(npm run build:local)");

test("파일로 연 로컬 실행판: 밴드 가져오기·기존 도구·자동 저장 복구", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const url = pathToFileURL(INDEX).href;
  await page.goto(url);
  await expect(page.locator(".topbar")).toBeVisible();

  // 밴드 HTML 가져오기 → 원형 보기
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 열기" }).click();
  await (await chooser).setFiles(fixtureFiles());
  await page.getByRole("button", { name: /선택한 1개 가져오기/ }).click();
  await expect(page.locator(".band-layer .al-post-head")).toBeVisible();

  // 기존 카톡 도구(iframe)와 연결·자동 저장
  await page.getByRole("tab", { name: /카카오톡/ }).click();
  const kf = page.frameLocator('iframe[title^="카카오톡"]');
  await kf.locator("#input").fill(KAKAO);
  await expect(kf.locator("#chat .bubble")).toHaveCount(2);
  await expect(page.locator(".topbar .save-status")).toHaveText("자동 저장됨", { timeout: 15_000 });

  // 새로 열어도 그대로
  await page.goto(`${url}#/kakao`);
  await page.reload();
  await expect(page.frameLocator('iframe[title^="카카오톡"]').locator("#input")).toHaveValue(KAKAO, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("파일로 연 로컬 실행판: 첫 화면 '파일 열기'에 수집 확장 .afterlog를 넣어도 프로젝트로 열린다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(INDEX).href);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  const fc = await chooser;
  expect(await fc.element().getAttribute("accept")).toContain(".afterlog");
  await fc.setFiles(resolve(process.cwd(), "tests/fixtures/afterlog/collector-sample.afterlog"));
  await expect(page.locator(".band-card")).toHaveCount(21, { timeout: 15_000 });
  await expect(page.locator(".project-switch")).toContainText("테스트 밴드");
  expect(errors).toEqual([]);
});

test("프로필만 있는 .afterlog: 프로필이 화면 가운데에 보이고, 다른 파일을 지금 프로젝트에 합칠 수 있다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(INDEX).href);
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  await (await chooser).setFiles(resolve(process.cwd(), "tests/fixtures/afterlog/profile-only.afterlog"));
  await expect(page.getByRole("heading", { name: /보관한 인물 프로필 1명/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.frameLocator(".profile-main-frame").locator("h1")).toHaveText("가상인물");

  // 같은 프로젝트에 수집 파일 합치기(선택지 → 합치기)
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  await (await chooser).setFiles(resolve(process.cwd(), "tests/fixtures/afterlog/collector-sample.afterlog"));
  // 합치기 전에 분석 결과(새 글 수 등)를 보여 주고 한 번에 합친다
  await expect(page.getByRole("dialog", { name: ".afterlog 합치기" })).toContainText("새 글 21개");
  await page.getByRole("button", { name: "합치기", exact: true }).click();
  await expect(page.locator(".band-card")).toHaveCount(21, { timeout: 15_000 });
  await expect(page.locator(".profile-snapshots")).toContainText("가상인물");

  // 한 번 더 합쳐도 늘지 않는다(프로젝트 메뉴 → 지금 프로젝트에 합치기)
  await page.locator(".project-switch").click();
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "지금 프로젝트에 합치기" }).click();
  await (await chooser).setFiles(resolve(process.cwd(), "tests/fixtures/afterlog/collector-sample.afterlog"));
  await expect(page.getByRole("dialog", { name: ".afterlog 합치기" })).toContainText("완전 중복 21개 건너뜀");
  await page.getByRole("button", { name: "합치기", exact: true }).click();
  await expect(page.locator(".band-card")).toHaveCount(21);
  // 이번 합치기 되돌리기(아무것도 안 바뀐 합치기라 그대로)
  await page.getByRole("button", { name: "이번 합치기 되돌리기" }).click();
  await expect(page.getByText("이번 합치기를 되돌렸습니다.")).toBeVisible();
  await expect(page.locator(".band-card")).toHaveCount(21);
  expect(errors).toEqual([]);
});

test("사진첩·날짜 이동: 같은 파일은 한 칸(쓰인 곳 수), 크게 보기에서 원래 글로, 달력에서 그 날 글로", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(INDEX).href);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  await (await chooser).setFiles(resolve(process.cwd(), "tests/fixtures/afterlog/collector-sample.afterlog"));
  await expect(page.locator(".band-card")).toHaveCount(21, { timeout: 15_000 });
  // 목록 상태 표식은 색만이 아니라 글자로
  await expect(page.locator(".band-card .al-state").first()).toContainText("미확보");
  // 날짜 이동
  await page.getByRole("button", { name: "날짜", exact: true }).click();
  const day = page.locator(".date-day.has-posts").first();
  await expect(day).toBeVisible();
  await day.click();
  await expect(page.locator(".band-card.is-flash")).toHaveCount(1);
  // 사진첩
  await page.locator(".band-side-link").click();
  await expect(page).toHaveURL(/#\/band\/album$/);
  const item = page.locator(".album-item");
  await expect(item).toHaveCount(1);
  await expect(item.locator("small")).toHaveText(/\d+곳/);
  await item.click();
  const lb = page.locator(".al-lightbox");
  await expect(lb).toBeVisible();
  await expect(lb).toContainText("같은 파일이");
  // 크게 보기는 화면 전체(레이어 폭에 갇히지 않음)
  const box = await lb.boundingBox();
  expect(box!.width).toBeGreaterThan(1300);
  await lb.getByRole("button", { name: /→$/ }).first().click();
  await expect(page).toHaveURL(/#\/band\/post\//);
  await expect(page.locator(".band-layer .al-post-head")).toBeVisible();
  // 뒤로 가면 사진첩
  await page.goBack();
  await expect(page.locator(".album-view")).toBeVisible();
  expect(errors).toEqual([]);
});

test("인물별 꾸미기·되돌리기: 말풍선 위치·색은 그 인물에만, 묶음 기본값·인물 꾸밈 지우기·모든 글 적용은 '취소'로 되돌린다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => void d.accept());
  await page.goto(pathToFileURL(INDEX).href);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  await (await chooser).setFiles(resolve(process.cwd(), "tests/fixtures/afterlog/collector-sample.afterlog"));
  await expect(page.locator(".band-card")).toHaveCount(21, { timeout: 15_000 });
  await page.locator(".band-card-open").first().click();
  await page.getByRole("button", { name: "꾸미기" }).click();
  const panel = page.locator(".design-panel");
  const layer = page.locator(".band-layer");
  await panel.getByRole("button", { name: "인물별" }).click();
  await panel.getByRole("button", { name: "말풍선으로 바꾸기" }).click();
  await expect(layer.locator(".al-skin-bubble").first()).toBeVisible();
  // 첫 인물: 오른쪽 + 말풍선 바탕색
  const row = panel.locator(".design-person-row").first();
  const who = (await row.locator(".design-person-name").textContent())!.trim();
  await row.click();
  await expect(row).toContainText("고르는 중");
  await panel.locator(".design-person-edit").getByRole("radio", { name: "오른쪽" }).click();
  const right = layer.locator(".al-comment.is-right");
  await expect(right.first()).toBeVisible();
  await expect(right.first().locator(".al-name")).toHaveText(who);
  const nRight = await right.count();
  const nAll = await layer.locator(".al-comment").count();
  expect(nRight).toBeLessThan(nAll);
  await panel.locator(".design-person-edit .ui-swatch").nth(1).click();
  await page.locator(".ui-color-pop .ui-swatch").nth(4).click();
  await panel.locator(".panel-head strong").click();
  expect(await right.first().locator(".al-comment-body").getAttribute("style")).toContain("--al-bubble");
  // 인물 꾸밈 모두 지우기 → 취소
  await panel.locator(".design-reset summary").click();
  await panel.getByRole("button", { name: "인물별 꾸밈 모두 지우기" }).click();
  await expect(right).toHaveCount(0);
  await expect(panel.locator(".design-msg")).toContainText("되돌렸습니다");
  await panel.locator(".design-msg").getByRole("button", { name: "취소" }).click();
  await expect(right).toHaveCount(nRight);
  // 묶음만 기본값: 본문·댓글(말풍선 → 밴드형) → 취소
  await panel.getByRole("button", { name: "본문·댓글" }).click();
  await panel.getByRole("button", { name: "이 묶음만 기본값으로" }).click();
  await expect(layer.locator(".al-skin-bubble")).toHaveCount(0);
  await panel.locator(".design-msg").getByRole("button", { name: "취소" }).click();
  await expect(layer.locator(".al-skin-bubble").first()).toBeVisible();
  // 모든 글에 적용 → 취소: 다른 글은 원래(밴드형)로
  await panel.getByRole("button", { name: "모든 글에 적용" }).click();
  await expect(panel.locator(".design-msg")).toContainText("적용했습니다");
  await panel.locator(".design-msg").getByRole("button", { name: "취소" }).click();
  await expect(panel.locator(".design-msg")).toContainText("적용 전으로 되돌렸습니다");
  await page.locator(".band-layer-close").first().click();
  await page.locator(".band-card-open").nth(1).click();
  await expect(page.locator(".band-layer .al-post-head")).toBeVisible();
  await expect(page.locator(".band-layer .al-skin-bubble")).toHaveCount(0);
  expect(errors).toEqual([]);
});
