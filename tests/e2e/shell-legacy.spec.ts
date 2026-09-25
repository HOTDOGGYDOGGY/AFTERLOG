// 통합 셸과 기존 도구 연결(명세 v1.2 U01~U09, U23, U32, U33, U35, N01) 브라우저 검사
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "test-results/shell");
mkdirSync(OUT, { recursive: true });
const FIX = resolve(process.cwd(), "tests/fixtures/band");
const fixtureFiles = () => [resolve(FIX, "post-synthetic.html"), ...readdirSync(resolve(FIX, "page_files")).map((n) => resolve(FIX, "page_files", n))];

const KAKAO = "테스트 님과 카카오톡 대화\n[하진] [오후 9:31] 아직 안 잤어?\n[서윤] [오후 9:32] 응. 지금 내려갈게.\n[하진] [오후 9:33] 항구 앞에서 만나자.";
const CAFE = "작성자 정보\n\t가람\n작성일시2026.01.18. 12:35\n안녕하세요.\n댓글 정보\n^댓글 1\t\n등록순\n프로필\n나래\n2026.01.18. 12:44답글\n반가워 (손을 흔든다)";
const DM = "서윤\n안녕\n오후 9:31\n응 안녕\n오후 9:32";
const TL = "하진\n@hajin\n·\n3시간\n오늘 항구 너무 예쁘다\n1\n2\n3\n서윤\n@seoyun\n·\n2시간\n나도 가고 싶다\n4\n5\n6";

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
const saved = (page: Page) => expect(page.locator(".topbar .save-status")).toHaveText("자동 저장됨", { timeout: 15_000 });
const frame = (page: Page, title: RegExp | string) => page.frameLocator(`iframe[title^="${title}"]`);

test("U07·U04·U08·U35 기존 도구: 입력→미리보기→저장→전환 유지→내보내기→프로젝트 복구", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await recordDownloadNames(page);
  await page.goto("/#/kakao");

  // 카톡: 자료가 없으면 임시 이름 프로젝트를 바로 만든다(이름 입력 모달 없음)
  const kf = frame(page, "카카오톡");
  await kf.locator("#input").fill(KAKAO);
  await expect(kf.locator("#chat .bubble")).toHaveCount(3);
  await saved(page);
  await expect(page.locator(".project-switch")).toContainText("새 프로젝트");
  // 인물 표시 이름 바꾸기(기존 설정)
  await kf.locator("#peoplePanel input[type=text]").first().fill("하진(바뀜)");
  await expect(kf.locator("#chat")).toContainText("하진(바뀜)");
  await saved(page);
  await page.screenshot({ path: `${OUT}/kakao-1440.png` });

  // 카페
  await page.getByRole("tab", { name: /카페/ }).click();
  const cf = frame(page, "네이버 카페");
  await cf.locator("#inputArea").fill(CAFE);
  await expect(cf.locator("#previewContent")).toContainText("반가워");
  await saved(page);
  // 상단 실행취소가 카페 도구의 실행취소로 전달된다
  await cf.locator('.skin-btn[data-skin="chat"]').click({ force: true }).catch(() => undefined);
  await page.screenshot({ path: `${OUT}/cafe-1440.png` });

  // 트위터 DM(DM 전용)과 트위터(타임라인·타래)는 상태가 따로
  await page.getByRole("tab", { name: /^DM/ }).click();
  const df = frame(page, "트위터 DM");
  await df.locator("#inputArea").fill(DM);
  await expect(df.locator("#typeValue")).toHaveText("DM");
  await expect(df.locator('.type-btn[data-type="timeline"]')).toBeHidden();
  await saved(page);
  await page.getByRole("tab", { name: /트위터/ }).click();
  const tf = frame(page, "트위터 타임라인");
  await expect(tf.locator("#inputArea")).toHaveValue("");
  await tf.locator("#inputArea").fill(TL);
  await expect(tf.locator('.type-btn[data-type="dm"]')).toBeHidden();
  await expect(tf.locator("#typeValue")).not.toHaveText("DM");
  await saved(page);
  await page.screenshot({ path: `${OUT}/twitter-1440.png` });

  // U04 전환 후에도 입력·인물 유지
  await page.getByRole("tab", { name: /카카오톡/ }).click();
  await expect(kf.locator("#input")).toHaveValue(KAKAO);
  await expect(kf.locator("#chat")).toContainText("하진(바뀜)");

  // U08 내보내기는 현재 모듈만(카톡 파일)
  await page.getByRole("button", { name: "내보내기" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 파일" }).click();
  await dl;
  expect(await page.evaluate(() => (window as unknown as { __dl: string[] }).__dl.at(-1))).toBe("kakaotalk.html");
  await page.getByRole("button", { name: "내보내기" }).click();
  const dlPng = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("menuitem", { name: "PNG 이미지" }).click();
  await dlPng;
  expect(await page.evaluate(() => (window as unknown as { __dl: string[] }).__dl.at(-1))).toMatch(/^kakaotalk(_\d+)?\.png$/);
  await page.getByRole("tab", { name: /카페/ }).click();
  await page.getByRole("button", { name: "내보내기" }).click();
  const dl2 = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 파일" }).click();
  await dl2;
  expect(await page.evaluate(() => (window as unknown as { __dl: string[] }).__dl.at(-1))).toBe("navercafe.html");

  // 새로고침 복구
  await page.reload();
  await expect(frame(page, "네이버 카페").locator("#previewContent")).toContainText("반가워");
  await page.getByRole("tab", { name: /카카오톡/ }).click();
  await expect(kf.locator("#chat")).toContainText("하진(바뀜)");

  // U35 프로젝트 파일 → 새 환경에서 복구
  const dlp = page.waitForEvent("download");
  await page.getByRole("button", { name: "프로젝트 저장" }).click();
  await page.getByRole("menuitem", { name: /전체 저장/ }).click();
  const projectFile = resolve(OUT, "legacy.afterlog");
  await (await dlp).saveAs(projectFile);
  expect(errors).toEqual([]);

  const fresh = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const fp = await fresh.newPage();
  await fp.goto("/#/kakao");
  await fp.getByRole("button", { name: /프로젝트 없음/ }).click();
  const chooser = fp.waitForEvent("filechooser");
  await fp.getByRole("button", { name: /파일 열기 \(\.afterlog\)/ }).click();
  await (await chooser).setFiles(projectFile);
  await expect(frame(fp, "카카오톡").locator("#chat")).toContainText("하진(바뀜)");
  await expect(frame(fp, "카카오톡").locator("#chat .bubble")).toHaveCount(3);
  await fp.getByRole("tab", { name: /^DM/ }).click();
  await expect(frame(fp, "트위터 DM").locator("#inputArea")).toHaveValue(DM);
  await fp.getByRole("tab", { name: /트위터/ }).click();
  await expect(frame(fp, "트위터 타임라인").locator("#inputArea")).toHaveValue(TL);
  await fresh.close();
});

test("U06·U05 짓시는 원문 보관만, 복원 완료로 표시하지 않음", async ({ page }) => {
  await page.goto("/#/zitsi");
  await expect(page.getByText("예전 RPBA에도 짓시 도구가 없어 복원하지 않았습니다")).toBeVisible();
  await page.getByLabel("텍스트 붙여넣어 보관").fill("짓시 원문 한 줄\n두 번째 줄");
  await page.getByRole("button", { name: "보관하기" }).click();
  await expect(page.locator(".archive-lines li")).toHaveCount(2);
  await expect(page.locator(".topbar .save-status")).toHaveText("자동 저장됨");
  await page.reload();
  await expect(page.locator(".archive-lines")).toContainText("두 번째 줄");
  await expect(page.getByRole("tab", { name: /DM/ })).toHaveAttribute("title", /트위터 DM 텍스트만 지원/);
});

test("U09 단축키는 활성 모듈만: 카톡에서 Ctrl+Z가 밴드 문서를 바꾸지 않는다", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 열기" }).click();
  await (await chooser).setFiles(fixtureFiles());
  await page.getByRole("button", { name: /선택한 1개 가져오기/ }).click();
  await page.getByRole("button", { name: "꾸미기" }).click();
  await page.locator(".design-panel").getByRole("button", { name: "인장" }).click();
  await page.locator(".design-panel").getByRole("radio", { name: "사각", exact: true }).click();
  await expect(page.locator(".band-layer .al-post-head .al-avatar")).toHaveClass(/is-square/);
  await page.getByRole("tab", { name: /카카오톡/ }).click();
  await page.locator(".topbar").click({ position: { x: 600, y: 20 } });
  await page.keyboard.press("Control+z");
  await page.getByRole("tab", { name: "밴드" }).click();
  await expect(page.locator(".band-layer .al-post-head .al-avatar")).toHaveClass(/is-square/);
});

test("U32·U33·U23 폭·반응형: 출력 폭 유지, 네 번째 열 없음, 가로 넘침 없음", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 열기" }).click();
  await (await chooser).setFiles(fixtureFiles());
  await page.getByRole("button", { name: /선택한 1개 가져오기/ }).click();
  const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  for (const [w, h] of [
    [1440, 900],
    [1280, 720],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    // 원형 보기 상세 폭 = 문서 폭(600)
    expect(Math.round((await page.locator(".band-layer").boundingBox())!.width)).toBe(600);
    expect(Math.round((await page.locator(".band-layer .al-band").boundingBox())!.width)).toBe(600);
    expect(await overflowX()).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${OUT}/band-${w}.png` });
  }
  // 편집 모드: 짧은 글에서도 출력 폭 그대로(배율 100%)
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "내용 편집" }).click();
  expect(Math.round((await page.locator(".preview-page").boundingBox())!.width)).toBe(600);
  await expect(page.locator(".fit-note")).toHaveCount(0);
  // 선택이 없으면 오른쪽 검사 패널도 없다(빈 네 번째 열 없음)
  await expect(page.locator(".inspector")).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/edit-1280.png` });
  // 좁으면 맞춤 배율을 표시하고 출력 폭 설정은 그대로
  await page.setViewportSize({ width: 560, height: 700 });
  await expect(page.locator(".fit-note")).toContainText("출력 폭 600px는 그대로");
  await page.getByRole("button", { name: "편집 끝내기" }).click();

  // 모바일
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await overflowX()).toBeLessThanOrEqual(0);
  await expect(page.getByRole("button", { name: "내보내기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "플랫폼 선택" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/band-390.png` });
  await page.keyboard.press("Escape");
  await expect(page.locator(".band-feed")).toBeVisible();
  expect(await overflowX()).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${OUT}/home-390.png` });

  // 200% 확대 근사(뷰포트 절반): 상단 주요 동작이 화면 안에 남는다
  await page.setViewportSize({ width: 720, height: 450 });
  for (const name of ["내보내기", "프로젝트 저장", "설정"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box && box.x + box.width <= 720).toBe(true);
  }
  await page.screenshot({ path: `${OUT}/zoom200-approx.png` });
});

test("N01 저장해 둔 라이트 선택은 유지", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("afterlog.appTheme", "light"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("menuitemradio", { name: /다크/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
