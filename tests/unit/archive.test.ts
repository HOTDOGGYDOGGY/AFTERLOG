// @vitest-environment node
import { JSDOM } from "jsdom";
globalThis.DOMParser = new JSDOM().window.DOMParser;
import { describe, expect, it } from "vitest";
import { planParts, writeArchive, type ArchiveAsset } from "../../src/archive/writer";
import { readArchive } from "../../src/archive/reader";
import { sha256Hex } from "../../src/storage/hash";
import { syntheticDoc } from "./helpers";
import type { Project } from "../../src/domain/types";

async function asset(id: string, size: number, fill: number): Promise<ArchiveAsset> {
  const data = new Uint8Array(size).fill(fill);
  return { id, name: `${id}.png`, mime: "image/png", size, sha256: await sha256Hex(data), data };
}

async function build(maxPartBytes: number) {
  const a = [await asset("a1", 600, 1), await asset("a2", 600, 2), await asset("a3", 600, 3)];
  const doc = syntheticDoc(new Map([["avatar_garam.png", "a1"], ["avatar_narae.png", "a2"], ["post_photo_2.png", "a3"]]));
  const project: Project = { id: "p1", title: "t", schemaVersion: 1, createdAt: "x", updatedAt: "x", documentIds: [doc.id] };
  const parts: Blob[] = [];
  for await (const p of writeArchive(
    { project, documents: [{ ...doc, projectId: "p1" }], assets: a, sources: [], appVersion: "t", producer: "test", exportedAt: "x", capture: { report: { collectorVersion: "t", posts: {} } } },
    { maxPartBytes },
  ))
    parts.push(new Blob([p.bytes as BlobPart]));
  return parts;
}

describe(".afterlog 분할", () => {
  it("파트 배정: 한도를 넘으면 다음 파트, 큰 자산은 혼자", () => {
    expect(planParts([10, 10, 150, 10], 100)).toEqual([1, 1, 2, 3]);
    expect(planParts([50, 50, 50], 100)).toEqual([1, 1, 2]);
    expect(planParts([], 100)).toEqual([]);
  });

  it("한도 안이면 파일 하나(형식 1)", async () => {
    const parts = await build(10_000);
    expect(parts).toHaveLength(1);
    const r = await readArchive(parts);
    expect(r.manifest.formatVersion).toBe(1);
    expect(r.missingAssetIds.size).toBe(0);
    expect(r.captureReport).toMatchObject({ collectorVersion: "t" });
  });

  it("나뉜 파트를 모두 넣으면 전부 복원", async () => {
    const parts = await build(1000);
    expect(parts.length).toBe(3);
    const r = await readArchive([parts[2], parts[0], parts[1]]);
    expect(r.partCount).toBe(3);
    expect(r.missingParts).toEqual([]);
    expect(Object.keys(r.files).filter((k) => k.startsWith("assets/"))).toHaveLength(3);
  });

  it("T17 파트가 빠지면 텍스트는 읽고 빠진 자산만 알려 준다", async () => {
    const parts = await build(1000);
    const r = await readArchive([parts[0], parts[2]]);
    expect(r.missingParts).toEqual([2]);
    expect([...r.missingAssetIds]).toEqual(["a2"]);
    expect(r.data.documents).toHaveLength(1);
  });

  it("T17 다른 스냅샷의 파트를 섞으면 거부", async () => {
    const x = await build(1000);
    const y = await build(1000);
    await expect(readArchive([x[0], y[1]])).rejects.toThrow(/서로 다른 내보내기/);
    await expect(readArchive([x[0], x[0]])).rejects.toThrow(/두 번/);
  });
});
