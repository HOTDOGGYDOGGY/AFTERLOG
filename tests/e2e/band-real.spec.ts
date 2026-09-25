// 실제 샘플(비공개, tests/private/)로 화면 검수. 파일이 없으면 건너뛴다.
import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync } from "fflate";

const PRIV = resolve(process.cwd(), "tests/private");
const has = existsSync(resolve(PRIV, "band-real.html"));
const OUT = resolve(process.cwd(), "test-results/real");

test.skip(!has, "비공개 실제 샘플 없음");

test("실제 저장 페이지 ZIP: 가져오기·화면·내보내기 검수", async ({ page, browser }) => {
  mkdirSync(OUT, { recursive: true });
  const files: Record<string, Uint8Array> = { "saved/page.html": new Uint8Array(readFileSync(resolve(PRIV, "band-real.html"))) };
  for (const n of readdirSync(resolve(PRIV, "band-real_files"))) files[`saved/page_files/${n}`] = new Uint8Array(readFileSync(resolve(PRIV, "band-real_files", n)));
  files["saved/HTML복사.txt"] = new Uint8Array(readFileSync(resolve(PRIV, "band-real-fragment.txt")));
  const zipPath = resolve(OUT, "real.zip");
  writeFileSync(zipPath, zipSync(files));

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 선택" }).click();
  await (await chooser).setFiles(zipPath);
  await expect(page.getByText("게시글 1 · 댓글 8 · 답글 9 · 인물 9")).toBeVisible();
  await expect(page.getByText(/이미지 파일 9\/9개 확보/)).toBeVisible();
  await expect(page.getByText(/가장 정확한 저장 페이지/)).toBeVisible();
  await page.screenshot({ path: `${OUT}/01-review-1280.png`, fullPage: true });
  await page.getByRole("button", { name: /선택한 1개 가져오기/ }).click();

  const preview = page.locator(".preview-page");
  await expect(preview.locator(".al-comments .al-comment")).toHaveCount(17);
  await expect(preview.locator(".al-replies .al-comment")).toHaveCount(9);
  const loaded = await preview.locator("img.al-avatar").evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).naturalWidth > 0).length);
  expect(loaded).toBe(18);
  await expect(preview.locator(".al-post-head")).toContainText("21 읽음");
  await expect(preview.locator(".al-counts")).toHaveText("댓글 17");
  await page.screenshot({ path: `${OUT}/02-editor-1280.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${OUT}/03-editor-1440.png` });
  const hOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(hOverflow).toBeLessThanOrEqual(0);

  await page.getByRole("tab", { name: "표시" }).click();
  await page.getByRole("button", { name: "다크" }).click();
  await page.screenshot({ path: `${OUT}/04-editor-dark-output.png` });

  await page.getByRole("tab", { name: "인물별" }).click();
  await page.screenshot({ path: `${OUT}/05-people-1440.png` });
  await page.getByRole("tab", { name: "문서" }).click();

  // 내보내기
  await page.getByRole("button", { name: "내보내기" }).click();
  const dlHtml = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "내보내기" }).click();
  const htmlPath = resolve(OUT, "export.html");
  await (await dlHtml).saveAs(htmlPath);
  await page.getByRole("radio", { name: "PNG 이미지" }).click();
  await page.getByRole("dialog").locator('input[type="range"]').fill("1500");
  const dlPng = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "내보내기" }).click();
  await (await dlPng).saveAs(resolve(OUT, "pages.zip"));
  await expect(page.getByRole("dialog")).toContainText("장을 받았습니다");

  const offline = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 } });
  const hp = await offline.newPage();
  await hp.goto("file://" + htmlPath);
  await expect(hp.locator(".al-comment")).toHaveCount(17);
  const ok = await hp.locator("img").evaluateAll((els) => els.every((e) => (e as HTMLImageElement).naturalWidth > 0));
  expect(ok).toBe(true);
  expect(await hp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await hp.screenshot({ path: `${OUT}/06-export-dark-390.png`, fullPage: true });
  await offline.close();
});
