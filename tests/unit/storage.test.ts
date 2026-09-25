// @vitest-environment node
// 브라우저처럼 Blob을 IndexedDB에 저장하려면 Node의 Blob이 필요하다. DOMParser만 jsdom에서 빌려온다.
import { JSDOM } from "jsdom";
globalThis.DOMParser = new JSDOM().window.DOMParser;
import "fake-indexeddb/auto";
import { readFileSync, readdirSync } from "node:fs";
import { strToU8, zipSync, unzipSync, strFromU8 } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import * as C from "../../src/editor/commands";
import { exportProjectFile, importProjectFile, importProjectFiles, mergeProjectFiles, planMerge, applyMerge, undoMerge, readProjectFile } from "../../src/exporters/afterlog";
import { analyzeFiles, commitImport } from "../../src/importers/importFiles";
import { db } from "../../src/storage/db";
import { ConflictError, createProject, getDocuments, getModuleState, listAssets, listModuleStates, listSources, purgeProject, putModuleState, saveDocument } from "../../src/storage/repo";
import { validateDocument } from "../../src/domain/validate";
import { FIXTURE_DIR } from "./helpers";

function fixtureFiles(): File[] {
  const files = [new File([readFileSync(FIXTURE_DIR + "post-synthetic.html")], "post-synthetic.html", { type: "text/html" })];
  for (const n of readdirSync(FIXTURE_DIR + "page_files")) files.push(new File([readFileSync(FIXTURE_DIR + "page_files/" + n)], n, { type: "image/png" }));
  return files;
}

async function wipe() {
  const d = db();
  await Promise.all([d.projects.clear(), d.documents.clear(), d.sources.clear(), d.assets.clear(), d.modules.clear()]);
}

beforeEach(wipe);

async function importFixture() {
  const p = await createProject("테스트");
  const pending = await analyzeFiles(fixtureFiles(), p.id);
  const docs = await commitImport(p.id, pending, pending.parse.documents.map((_, i) => i));
  return { p, pending, docs };
}

describe("가져오기 → 저장소", () => {
  it("HTML+이미지 파일로 가져오면 원문과 자산을 보관한다", async () => {
    const { p, pending, docs } = await importFixture();
    expect(pending.missingImages).toEqual(["post_photo_1.jpg"]);
    expect(docs).toHaveLength(2);
    const assets = await listAssets(p.id);
    // avatar_garam/narae/narae_other/quote + post_photo_2 (band_cover는 참조되지 않음)
    expect(assets.map((a) => a.name).sort()).toEqual(["avatar_garam.png", "avatar_narae.png", "avatar_narae_other.png", "avatar_quote.png", "post_photo_2.png"]);
    const sources = await listSources(p.id);
    expect(sources).toHaveLength(1);
    expect(new Uint8Array(await sources[0].blob.arrayBuffer())).toEqual(new Uint8Array(readFileSync(FIXTURE_DIR + "post-synthetic.html")));
    const post = docs.find((d) => d.inputFormat === "band-post")!;
    expect(post.issues.some((i) => i.kind === "missing-image")).toBe(true);
  });

  it("ZIP으로 넣어도 같은 결과", async () => {
    const files: Record<string, Uint8Array> = { "저장/post-synthetic.html": new Uint8Array(readFileSync(FIXTURE_DIR + "post-synthetic.html")) };
    for (const n of readdirSync(FIXTURE_DIR + "page_files")) files[`저장/page_files/${n}`] = new Uint8Array(readFileSync(FIXTURE_DIR + "page_files/" + n));
    const zip = new File([zipSync(files) as BlobPart], "band.zip");
    const pending = await analyzeFiles([zip], null);
    expect(pending.parse.documents).toHaveLength(2);
    expect(pending.missingImages).toEqual(["post_photo_1.jpg"]);
  });

  it("F21 같은 원문을 다시 가져오면 알리고, 기존 자료는 남긴다", async () => {
    const { p } = await importFixture();
    const again = await analyzeFiles(fixtureFiles(), p.id);
    expect(again.duplicateOf).not.toBeNull();
    await commitImport(p.id, again, [0]);
    expect(await getDocuments(p.id)).toHaveLength(3);
  });

  it("F16 오래된 탭의 저장은 거부된다", async () => {
    const { docs } = await importFixture();
    const d = docs[0];
    const r2 = await saveDocument(C.setTitle(d, "탭 A"), 1);
    expect(r2).toBe(2);
    await expect(saveDocument(C.setTitle(d, "탭 B(오래됨)"), 1)).rejects.toBeInstanceOf(ConflictError);
    expect((await db().documents.get(d.id))!.title).toBe("탭 A");
  });
});

describe(".afterlog 프로젝트 파일", () => {
  it("F14 저장 후 새 환경에서 복구하면 원문·편집·자산·관계·설정이 일치한다", async () => {
    const { p, docs } = await importFixture();
    const post = docs.find((d) => d.inputFormat === "band-post")!;
    const someone = post.identityOrder[1];
    let edited = C.updateIdentity(post, someone, { displayName: "바꾼 이름", color: "#123456", hidden: true });
    edited = C.updateView(edited, (v) => void (v.theme = "dark"));
    await saveDocument(edited, 1);

    const { files: [{ blob }] } = await exportProjectFile(p.id);
    const beforeAssets = (await listAssets(p.id)).map((a) => a.sha256).sort();
    const beforeSource = await (await listSources(p.id))[0].blob.arrayBuffer();
    await wipe(); // 새 브라우저 환경 흉내

    const restored = await importProjectFile(blob);
    const rdocs = await getDocuments(restored.id);
    expect(rdocs).toHaveLength(2);
    const rpost = rdocs.find((d) => d.inputFormat === "band-post")!;
    expect(validateDocument(rpost)).toEqual([]);
    expect(rpost.view.theme).toBe("dark");
    const ri = Object.values(rpost.identities).find((i) => i.displayName === "바꾼 이름")!;
    expect(ri).toMatchObject({ color: "#123456", hidden: true });
    expect(rpost.id).not.toBe(post.id); // 새 사본: ID 재발급
    expect(Object.keys(rpost.entries)).toHaveLength(Object.keys(post.entries).length);
    const rAssets = await listAssets(restored.id);
    expect(rAssets.map((a) => a.sha256).sort()).toEqual(beforeAssets);
    // 자산 참조가 새 ID로 바뀌어 있다
    const ids = new Set(rAssets.map((a) => a.id));
    for (const idn of Object.values(rpost.identities)) if (idn.avatarAssetId) expect(ids.has(idn.avatarAssetId)).toBe(true);
    const rs = await listSources(restored.id);
    expect(new Uint8Array(await rs[0].blob.arrayBuffer())).toEqual(new Uint8Array(beforeSource));
    expect(rpost.sourceId).toBe(rs[0].id);
  });

  it("F22 손상·미래 버전·다른 파일은 명확히 실패하고 기존 자료를 건드리지 않는다", async () => {
    const { p } = await importFixture();
    const { files: [{ blob }] } = await exportProjectFile(p.id);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const before = await db().projects.count();

    const future = { ...files, "manifest.json": strToU8(JSON.stringify({ ...JSON.parse(strFromU8(files["manifest.json"])), formatVersion: 99 })) };
    await expect(readProjectFile(new Blob([zipSync(future) as BlobPart]))).rejects.toThrow(/더 새로운 AFTERLOG/);

    const assetPath = Object.keys(files).find((k) => k.startsWith("assets/"))!;
    const tampered = { ...files, [assetPath]: new Uint8Array([1, 2, 3]) };
    await expect(importProjectFile(new Blob([zipSync(tampered) as BlobPart]))).rejects.toThrow(/손상/);

    const missing = { ...files };
    delete missing["project.json"];
    await expect(importProjectFile(new Blob([zipSync(missing) as BlobPart]))).rejects.toThrow(/project\.json/);

    await expect(importProjectFile(new Blob([new Uint8Array([80, 75, 3, 4, 9, 9])]))).rejects.toThrow(/손상|형식/);

    const pj = JSON.parse(strFromU8(files["project.json"]));
    const d0 = pj.documents[0];
    const someEntry = Object.keys(d0.entries)[1];
    d0.children[someEntry] = [...(d0.children[someEntry] ?? []), d0.children.root[0]]; // 순환
    const broken = { ...files, "project.json": strToU8(JSON.stringify(pj)) };
    await expect(importProjectFile(new Blob([zipSync(broken) as BlobPart]))).rejects.toThrow(/관계 정보가 손상/);

    expect(await db().projects.count()).toBe(before);
  });
});

describe("U35 기존 도구 상태의 프로젝트 왕복", () => {
  it("카톡·카페·짓시 상태와 알 수 없는 모듈을 .afterlog에 담아 새 사본으로 복구", async () => {
    const { p } = await importFixture();
    const kakao = { text: "[하진] [오후 9:31] 안녕", people: { people: { 하진: { id: "하진", displayName: "하진", avatarDataUrl: "data:image/png;base64,AAAA", color: "#123456" } }, meId: "하진" }, kakaoSettings: { bgColor: "#000000" }, items: [{ type: "msg", text: "고친 말풍선" }] };
    await putModuleState({ projectId: p.id, moduleId: "kakao", stateVersion: 1, payload: kakao });
    await putModuleState({ projectId: p.id, moduleId: "zitsi", stateVersion: 1, payload: { items: [{ id: "a", name: "원문", mime: "text/plain", text: "짓시 원문" }] } });
    await putModuleState({ projectId: p.id, moduleId: "future-tool", stateVersion: 9, payload: { keep: true } });
    const { files } = await exportProjectFile(p.id);
    const r = await importProjectFiles(files.map((f) => f.blob));
    expect(r.project.id).not.toBe(p.id);
    const restored = await listModuleStates(r.project.id);
    expect(restored.map((m) => m.moduleId).sort()).toEqual(["future-tool", "kakao", "zitsi"]);
    expect((await getModuleState(r.project.id, "kakao"))!.payload).toEqual(kakao);
    expect((await getModuleState(r.project.id, "future-tool"))!.stateVersion).toBe(9);
    // 원래 프로젝트는 그대로
    expect((await getModuleState(p.id, "kakao"))!.payload).toEqual(kakao);
  });
  it("모듈 상태가 없는 예전 파일도 그대로 열린다", async () => {
    const { p } = await importFixture();
    const { files } = await exportProjectFile(p.id);
    const r = await importProjectFiles(files.map((f) => f.blob));
    expect(await listModuleStates(r.project.id)).toEqual([]);
  });
  it("프로젝트 영구 삭제 때 모듈 상태도 지운다", async () => {
    const p = await createProject("x");
    await putModuleState({ projectId: p.id, moduleId: "cafe", stateVersion: 1, payload: {} });
    await purgeProject(p.id);
    expect(await listModuleStates(p.id)).toEqual([]);
  });
});

describe(".afterlog 지금 프로젝트에 합치기", () => {
  it("같은 글은 건너뛰고 원문·이미지를 새로 더하지 않는다", async () => {
    const { p } = await importFixture();
    const { files: [{ blob }] } = await exportProjectFile(p.id);
    const before = { docs: (await getDocuments(p.id)).length, assets: (await listAssets(p.id)).length, sources: (await listSources(p.id)).length };
    const r = await mergeProjectFiles(blob, p.id);
    expect(r).toMatchObject({ added: 0, updated: 0, skipped: 2, sourcesAdded: 0 });
    expect((await getDocuments(p.id)).length).toBe(before.docs);
    expect((await listAssets(p.id)).length).toBe(before.assets);
    expect((await listSources(p.id)).length).toBe(before.sources);
  });

  it("다른 프로젝트에 합치면 새 글로 더하고 이미지 참조를 맞춘다", async () => {
    const { p } = await importFixture();
    const { files: [{ blob }] } = await exportProjectFile(p.id);
    const q = await createProject("대상");
    const r = await mergeProjectFiles(blob, q.id);
    expect(r.added).toBe(2);
    const docs = await getDocuments(q.id);
    expect(docs).toHaveLength(2);
    const ids = new Set((await listAssets(q.id)).map((a) => a.id));
    for (const d of docs) for (const idn of Object.values(d.identities)) if (idn.avatarAssetId) expect(ids.has(idn.avatarAssetId)).toBe(true);
    // 두 번 합쳐도 늘지 않는다
    const again = await mergeProjectFiles(blob, q.id);
    expect(again.added).toBe(0);
    expect(await getDocuments(q.id)).toHaveLength(2);
    expect((await db().projects.get(q.id))!.documentIds).toHaveLength(2);
  });

  it("댓글이 더 많은 새 자료는 고치지 않은 글만 갱신하고, 고친 글은 그대로 둔다", async () => {
    const { p } = await importFixture();
    const { files: [{ blob: full }] } = await exportProjectFile(p.id);
    // 댓글 하나를 지운 적은 판을 만든다
    const q = await createProject("적은 판");
    await mergeProjectFiles(full, q.id);
    const qPost = (await getDocuments(q.id)).find((d) => d.inputFormat === "band-post")!;
    const cut = { ...C.deleteEntry(qPost, Object.values(qPost.entries).filter((e) => e.kind !== "post").at(-1)!.id, "with-children"), revision: 1 };
    await db().documents.put(cut);
    const n0 = Object.keys(cut.entries).length;
    const up = await mergeProjectFiles(full, q.id);
    expect(up.updated).toBe(1);
    expect(up.commentsAdded).toBe(1);
    const after = (await getDocuments(q.id)).find((d) => d.inputFormat === "band-post")!;
    expect(Object.keys(after.entries).length).toBeGreaterThan(n0);
    expect(after.id).toBe(qPost.id);

    // 사용자가 고친 글(revision 2 이상)은 덮지 않는다
    const cut2 = { ...C.deleteEntry(after, Object.values(after.entries).filter((e) => e.kind !== "post").at(-1)!.id, "with-children"), revision: 3 };
    await db().documents.put(cut2);
    const kept = await mergeProjectFiles(full, q.id);
    expect(kept).toMatchObject({ updated: 0, keptEdited: 1 });
    expect(Object.keys((await db().documents.get(cut2.id))!.entries)).toHaveLength(Object.keys(cut2.entries).length);
  });

  it("수집 확장 파일(프로필 포함)을 두 번 합쳐도 중복이 생기지 않는다", async () => {
    const file = new Blob([readFileSync("tests/fixtures/afterlog/collector-sample.afterlog")]);
    const q = await createProject("수집");
    const first = await mergeProjectFiles(file, q.id);
    expect(first.added).toBeGreaterThan(0);
    const nDocs = (await getDocuments(q.id)).length;
    const nSources = (await listSources(q.id)).length;
    const second = await mergeProjectFiles(file, q.id);
    expect(second).toMatchObject({ added: 0, sourcesAdded: 0, profilesAdded: 0 });
    expect(await getDocuments(q.id)).toHaveLength(nDocs);
    expect(await listSources(q.id)).toHaveLength(nSources);
  });
});

describe("합치기: 항목 단위 보완·되돌리기·프로필(M03·M05·M07·M08)", () => {
  it("M05 기존에만 있는 댓글은 남기고 새 파일의 새 댓글만 보탠다", async () => {
    const { p } = await importFixture();
    const { files: [{ blob: full }] } = await exportProjectFile(p.id);
    const q = await createProject("대상");
    await mergeProjectFiles(full, q.id);
    // 대상에는 기존 글에 없던 댓글 하나(이전 수집에서만 보인 것)를 더해 두고, 들어오는 파일에서는 댓글 하나를 뺀다
    const qPost = (await getDocuments(q.id)).find((d) => d.inputFormat === "band-post")!;
    const onlyOld = C.duplicateEntry(qPost, Object.values(qPost.entries).filter((e) => e.kind !== "post")[0].id);
    const extra = Object.values(onlyOld.entries).find((e) => !qPost.entries[e.id])!;
    const withExtra = C.editTextBlock(onlyOld, extra.id, 0, "이전 수집에서만 보인 댓글");
    const stored = structuredClone(withExtra);
    stored.entries[extra.id].originalBlocks = stored.entries[extra.id].blocks;
    await db().documents.put({ ...stored, revision: 1 });
    const r = await mergeProjectFiles(full, q.id);
    expect(r.added).toBe(0);
    const after = (await getDocuments(q.id)).find((d) => d.inputFormat === "band-post")!;
    expect(Object.values(after.entries).some((e) => JSON.stringify(e.blocks).includes("이전 수집에서만 보인 댓글"))).toBe(true);
  });

  it("M08 계획 뒤 프로젝트가 바뀌면 적용하지 않고, 되돌리기는 추가한 글·이미지를 지운다", async () => {
    const { p } = await importFixture();
    const { files: [{ blob }] } = await exportProjectFile(p.id);
    const q = await createProject("대상");
    const plan = await planMerge(blob, q.id);
    await db().projects.update(q.id, { updatedAt: "2099-01-01T00:00:00.000Z" });
    await expect(applyMerge(plan)).rejects.toThrow(/바뀌었습니다/);
    expect(await getDocuments(q.id)).toHaveLength(0);
    const plan2 = await planMerge(blob, q.id);
    const undo = await applyMerge(plan2);
    expect(await getDocuments(q.id)).toHaveLength(2);
    expect((await listAssets(q.id)).length).toBeGreaterThan(0);
    await undoMerge(undo);
    expect(await getDocuments(q.id)).toHaveLength(0);
    expect(await listAssets(q.id)).toHaveLength(0);
    expect((await db().projects.get(q.id))!.documentIds).toHaveLength(0);
  });

  async function profileFile(record: object, title = "p") {
    const pr = await createProject(title);
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    await db().sources.add({ id: crypto.randomUUID(), projectId: pr.id, fileName: "프로필_x.json", mime: "application/json", importedAt: (record as { observedAt: string }).observedAt, parserVersion: "afterlog.band-profile/1", sha256: await (await import("../../src/storage/hash")).sha256Hex(bytes), kind: "band-profile-data" as never, sourceUrl: "https://www.band.us/band/1/member/K%3D/profile", blob: new Blob([bytes]) });
    const { files: [{ blob }] } = await exportProjectFile(pr.id);
    return blob;
  }
  const rec = (over: object) => ({
    schema: "afterlog.band-profile/1", platform: "band", surface: "profilePage", bandNo: "1", memberKey: "K=", identity: "confirmed", sourceUrl: null, profileUrl: "https://www.band.us/band/1/member/K%3D/profile",
    observedAt: "2026-09-01T00:00:00.000Z", name: "가상인물", description: "소개", info: null, joinInfo: null, avatar: null, cover: null, reactionsShown: 1, commentsShown: 0, storyCountShown: null,
    photoHistory: { state: "unrecognized", items: [] }, stories: { state: "collected", items: [{ key: "a#1", order: 0, timeText: "2026년 1월 1일", local: null, text: "하나", textSource: "detail", images: [], links: [], reactionsShown: 0, commentsShown: 0, comments: [], commentsState: "none" }] }, notes: [], ...over,
  });

  it("M03 같은 인물의 새 파일: 프로필을 새로 만들지 않고 새 스토리만 보탠다. 같은 파일은 완전 중복", async () => {
    const a = await profileFile(rec({}), "a");
    const b = await profileFile(rec({ observedAt: "2026-09-20T00:00:00.000Z", reactionsShown: 3, stories: { state: "collected", items: [...(rec({}) as { stories: { items: object[] } }).stories.items, { key: "b#1", order: 1, timeText: "2026년 2월 1일", local: null, text: "둘", textSource: "detail", images: [], links: [], reactionsShown: 0, commentsShown: 0, comments: [], commentsState: "none" }] } }), "b");
    const q = await createProject("대상");
    expect((await mergeProjectFiles(a, q.id)).profilesAdded).toBe(1);
    const r = await mergeProjectFiles(b, q.id);
    expect(r).toMatchObject({ profilesAdded: 0, profilesUpdated: 1 });
    const data = (await listSources(q.id)).filter((x) => String(x.kind) === "band-profile-data");
    expect(data).toHaveLength(1);
    const merged = JSON.parse(await data[0].blob.text());
    expect(merged.stories.items).toHaveLength(2);
    expect(merged.reactionsShown).toBe(3);
    expect(merged.history[0].reactionsShown).toBe(1);
    expect((await mergeProjectFiles(b, q.id)).profilesSkipped).toBe(1);
  });

  it("M07 식별자 없는 팝업 프로필은 이름이 같아도 합치지 않는다", async () => {
    const a = await profileFile(rec({ surface: "profilePopup", memberKey: null, identity: "unconfirmed", profileUrl: null }), "a");
    const b = await profileFile(rec({ surface: "profilePopup", memberKey: null, identity: "unconfirmed", profileUrl: null, description: "다른 소개" }), "b");
    const q = await createProject("대상");
    await mergeProjectFiles(a, q.id);
    expect((await mergeProjectFiles(b, q.id)).profilesAdded).toBe(1);
    expect((await listSources(q.id)).filter((x) => String(x.kind) === "band-profile-data")).toHaveLength(2);
  });
});

describe("저장 페이지의 인물 프로필 가져오기(H01·H02)", () => {
  const PDIR = FIXTURE_DIR + "profile/";
  it("프로필 페이지 + 멤버 팝업 두 HTML을 한 번에: 각각 프로필로, 이미지 파일은 이름으로 연결하고 없으면 미확보", async () => {
    const files = [
      new File([readFileSync(PDIR + "profile-page.html")], "프로필 _ 가상밴드.html", { type: "text/html" }),
      new File([readFileSync(PDIR + "member-popup.html")], "멤버 _ 가상밴드.html", { type: "text/html" }),
      new File([readFileSync(FIXTURE_DIR + "page_files/avatar_garam.png")], "avatar_a.jpg", { type: "image/png" }),
    ];
    const p = await createProject("프로필");
    const pending = await analyzeFiles(files, p.id);
    expect(pending.profiles.map((x) => [x.record.surface, x.record.name])).toEqual([
      ["profilePage", "가상인물"],
      ["profilePopup", "가상인물"],
    ]);
    expect(pending.parse.documents).toHaveLength(0);
    expect(pending.parse.notes.join()).not.toContain("찾지 못했습니다");
    await commitImport(p.id, pending, [], [0, 1]);
    const data = (await listSources(p.id)).filter((x) => String(x.kind) === "band-profile-data");
    // 팝업은 식별자가 없어 같은 이름이어도 따로(P05·M07)
    expect(data).toHaveLength(2);
    const page = JSON.parse(await data.map((x) => x).find((x) => x.sourceUrl?.includes("/profile"))!.blob.text());
    expect(page.avatar.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(page.cover.sha256 ?? null).toBeNull();
    // 저장 페이지 스크립트·확장 막대·입력칸은 자료에 섞이지 않는다
    const all = JSON.stringify(page);
    expect(all).not.toContain("__should_not_run");
    expect(all).not.toContain("확장 도구막대");
    expect(all).not.toContain("로그인한 나");
    // 같은 페이지를 다시 가져오면 같은 인물로 보고 늘지 않는다
    const again = await analyzeFiles([files[0]], p.id);
    await commitImport(p.id, again, [], [0]);
    expect((await listSources(p.id)).filter((x) => String(x.kind) === "band-profile-data")).toHaveLength(2);
  });
});
