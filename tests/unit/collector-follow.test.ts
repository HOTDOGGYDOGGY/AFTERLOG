// @vitest-environment node
// '직접 열며 수집'(인물 전체 수집 명세 7절): 사용자가 연 화면을 한 인물 아래에 누적. 범위 밖·중복·미지원 화면 처리
import "fake-indexeddb/auto";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_DIR } from "./helpers";

globalThis.DOMParser = new JSDOM().window.DOMParser;

import { cdb, _resetCollectorDbForTests } from "../../collector/src/db";
import { createJob, DEFAULT_OPTIONS } from "../../collector/src/engine";
import { applyFollowScreen, inScope } from "../../collector/src/follow";
import type { ProfileScreenRead } from "../../collector/src/page/profileScreen";

const load = (n: string) => readFileSync(FIXTURE_DIR + "profile/" + n, "utf8");
const screen = (html: string | null, pageUrl: string, over: Partial<ProfileScreenRead> = {}): ProfileScreenRead => ({ pageUrl, html, imageUrls: [], photoSrcs: null, postOpen: false, loginRequired: false, rawLayers: [], ...over });
const LIST = "https://www.band.us/band/100200300/member";
const PROFILE = "https://www.band.us/band/100200300/member/AbCdEf%3D%3D%3D/profile";

beforeEach(() => _resetCollectorDbForTests(`follow-${Math.random()}`));

async function job() {
  const j = await createJob({ scope: "profile", label: "직접 열며 수집", options: { ...DEFAULT_OPTIONS, follow: { tabId: 7, active: true, target: null, log: [] } }, bandNo: "100200300", profiles: [{ url: LIST, tabId: 7 }] });
  const t = (await cdb().tasks.where("jobId").equals(j.id).first())!;
  await cdb().tasks.update(t.id, { status: "skipped" });
  return { jobId: j.id, taskId: t.id };
}

describe("직접 열며 수집", () => {
  it("팝업으로 시작 → 같은 화면은 중복 스킵(G01) → 같은 이름의 프로필 화면에서 식별자·스토리를 보탬", async () => {
    const { jobId, taskId } = await job();
    const a = await applyFollowScreen(jobId, taskId, screen(load("member-popup.html"), LIST), "2026-09-26T01:00:00.000Z");
    expect(a.kind).toBe("saved");
    expect((await cdb().jobs.get(jobId))!.options.follow!.target).toMatchObject({ name: "가상인물", memberKey: null });
    const again = await applyFollowScreen(jobId, taskId, screen(load("member-popup.html"), LIST), "2026-09-26T01:00:05.000Z");
    expect(again.kind).toBe("same");
    const page = await applyFollowScreen(jobId, taskId, screen(load("profile-page.html"), PROFILE), "2026-09-26T01:01:00.000Z");
    expect(page.kind).toBe("saved");
    expect(page.text).toContain("스토리 +2");
    const cap = (await cdb().profiles.where("taskId").equals(taskId).first())!;
    expect(cap.record).toMatchObject({ identity: "confirmed", memberKey: "AbCdEf===", name: "가상인물" });
    expect(cap.record!.stories.items).toHaveLength(2);
    // 팝업이 표시한 1개와 프로필 화면의 2개 관측이 함께 남는다
    expect(cap.record!.stories.observations?.map((o) => o.surface)).toEqual(["profilePopup", "profilePage"]);
    expect((await cdb().jobs.get(jobId))!.options.follow!.target?.memberKey).toBe("AbCdEf===");
    // 스토리 하나는 상세를 열지 않아 보완 필요 → 종합 결과가 완료로 나오지 않게 '일부'
    expect((await cdb().tasks.get(taskId))!.status).toBe("partial");
  });

  it("G02 다른 인물·다른 밴드·식별 안 되는 팝업은 저장하지 않는다", async () => {
    const { jobId, taskId } = await job();
    await applyFollowScreen(jobId, taskId, screen(load("profile-page.html"), PROFILE), "2026-09-26T01:00:00.000Z");
    const other = await applyFollowScreen(jobId, taskId, screen(load("member-page-popup.html"), "https://www.band.us/band/100200300/member/ZzYyXx%3D%3D%3D%3D%3D%3D/post"), "2026-09-26T01:01:00.000Z");
    expect(other.kind).toBe("outOfScope");
    expect(other.text).toContain("다른 인물");
    // 식별자 없는 팝업은 이름이 같아도 확정하지 않음
    const pop = await applyFollowScreen(jobId, taskId, screen(load("member-popup.html"), LIST), "2026-09-26T01:02:00.000Z");
    expect(pop.kind).toBe("outOfScope");
    expect((await cdb().profiles.where("taskId").equals(taskId).first())!.record!.name).toBe("가상인물");
    expect(inScope({ bandNo: "1", memberKey: "K", name: "가" }, { bandNo: "2", memberKey: "K", name: "가" } as never).ok).toBe(false);
  });

  it("G03 프로필 화면이 아니면 저장하지 않고 이유를 알린다. 게시글은 '이 글 저장' 안내", async () => {
    const { jobId, taskId } = await job();
    expect((await applyFollowScreen(jobId, taskId, screen(null, LIST), "t")).kind).toBe("notProfile");
    expect((await applyFollowScreen(jobId, taskId, screen(null, LIST, { postOpen: true }), "t")).kind).toBe("post");
    expect((await applyFollowScreen(jobId, taskId, screen(null, LIST, { loginRequired: true }), "t")).kind).toBe("login");
    expect(await cdb().profiles.count()).toBe(0);
  });

  it("해석 못 한 레이어(예: 프로필 사진 보기)는 원문 보관: 인물 화면과 함께면 확인됨, 레이어만이면 '확인 안 됨', 인물이 없으면 저장 안 함", async () => {
    const { jobId, taskId } = await job();
    const viewer = { label: "DPhotoViewerLayerView", html: '<div class="lyWrap"><img src="https://x.pstatic.net/a.jpg"><p>사진</p></div>', imageUrls: ["https://x.pstatic.net/a.jpg"] };
    expect((await applyFollowScreen(jobId, taskId, screen(null, LIST, { rawLayers: [viewer] }), "t0")).kind).toBe("notProfile");
    const withPopup = await applyFollowScreen(jobId, taskId, screen(load("member-popup.html"), LIST, { rawLayers: [viewer] }), "t1");
    expect(withPopup.text).toContain("원문 보관 +1");
    expect(withPopup.images).toContain("https://x.pstatic.net/a.jpg");
    const again = await applyFollowScreen(jobId, taskId, screen(null, LIST, { rawLayers: [viewer] }), "t2");
    expect(again.kind).toBe("same");
    const other = { ...viewer, html: viewer.html.replace("사진", "다른 사진") };
    const alone = await applyFollowScreen(jobId, taskId, screen(null, LIST, { rawLayers: [other] }), "t3");
    expect(alone.text).toContain("대상 확인 안 됨");
    const cap = (await cdb().profiles.where("taskId").equals(taskId).first())!;
    expect(cap.raws?.map((r) => r.scope)).toEqual(["confirmed", "unverified"]);
    expect(cap.record!.rawArchives).toHaveLength(2);
    // 스토리·사진 수에는 넣지 않는다
    expect(cap.record!.stories.items).toHaveLength(0);
  });
});
