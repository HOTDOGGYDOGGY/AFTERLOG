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
