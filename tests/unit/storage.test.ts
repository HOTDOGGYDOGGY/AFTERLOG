// @vitest-environment node
// 브라우저처럼 Blob을 IndexedDB에 저장하려면 Node의 Blob이 필요하다. DOMParser만 jsdom에서 빌려온다.
import { JSDOM } from "jsdom";
globalThis.DOMParser = new JSDOM().window.DOMParser;
import "fake-indexeddb/auto";
import { readFileSync, readdirSync } from "node:fs";
import { strToU8, zipSync, unzipSync, strFromU8 } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import * as C from "../../src/editor/commands";
import { exportProjectFile, importProjectFile, readProjectFile } from "../../src/exporters/afterlog";
import { analyzeFiles, commitImport } from "../../src/importers/importFiles";
import { db } from "../../src/storage/db";
import { ConflictError, createProject, getDocuments, listAssets, listSources, saveDocument } from "../../src/storage/repo";
import { validateDocument } from "../../src/domain/validate";
import { FIXTURE_DIR } from "./helpers";

function fixtureFiles(): File[] {
  const files = [new File([readFileSync(FIXTURE_DIR + "post-synthetic.html")], "post-synthetic.html", { type: "text/html" })];
  for (const n of readdirSync(FIXTURE_DIR + "page_files")) files.push(new File([readFileSync(FIXTURE_DIR + "page_files/" + n)], n, { type: "image/png" }));
  return files;
}

async function wipe() {
  const d = db();
  await Promise.all([d.projects.clear(), d.documents.clear(), d.sources.clear(), d.assets.clear()]);
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

    const { blob } = await exportProjectFile(p.id);
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
    const { blob } = await exportProjectFile(p.id);
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
