// .afterlog 쓰기. 첨부가 많으면 여러 개의 완전한 컨테이너(파트)로 나눈다.
// ZIP 바이트를 임의로 자르지 않고, 파트마다 manifest·project.json을 넣고 자산만 나눠 담는다.
import { strToU8, zip } from "fflate";
import { SCHEMA_VERSION } from "../domain/types";
import { sha256Hex } from "../storage/hash";
import {
  AFTERLOG_FORMAT,
  AFTERLOG_FORMAT_VERSION,
  DEFAULT_PART_BYTES,
  type Manifest,
  type ManifestFile,
  type ManifestSource,
  type ProjectJson,
} from "./format";

type Bytes = Uint8Array | Blob;

export interface ArchiveAsset {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  data: Bytes;
}

export interface ArchiveSource {
  id: string;
  fileName: string;
  mime: string;
  importedAt: string;
  parserVersion: string;
  sha256: string;
  kind?: string;
  sourceUrl?: string;
  data: Bytes;
}

export interface ArchiveInput extends ProjectJson {
  assets: ArchiveAsset[];
  sources: ArchiveSource[];
  sourcesOmitted?: boolean;
  capture?: { report?: unknown; jobs?: unknown };
  appVersion: string;
  producer: string;
  exportedAt: string;
}

export interface ArchivePart {
  bytes: Uint8Array;
  partIndex: number;
  partCount: number;
}

const toBytes = async (d: Bytes) => (d instanceof Uint8Array ? d : new Uint8Array(await d.arrayBuffer()));

function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((res, rej) => zip(files, { level: 0 }, (e, d) => (e ? rej(e) : res(d))));
}

/** 자산을 파트에 나눠 담을 계획(순수 함수). 한도보다 큰 자산은 혼자 한 파트를 쓴다. */
export function planParts(sizes: number[], maxPartBytes: number): number[] {
  const out: number[] = [];
  let part = 1;
  let used = 0;
  sizes.forEach((s, i) => {
    if (used > 0 && used + s > maxPartBytes) {
      part++;
      used = 0;
    }
    out[i] = part;
    used += s;
    if (s > maxPartBytes && i < sizes.length - 1) {
      part++;
      used = 0;
    }
  });
  return out;
}

function missingImageCount(input: ProjectJson) {
  return input.documents.reduce(
    (n, d) => n + Object.values(d.entries).reduce((m, e) => m + e.blocks.filter((b) => b.type === "image" && !b.assetId).length, 0),
    0,
  );
}

/**
 * 파트를 하나씩 만들어 돌려준다(한 번에 모든 파트를 메모리에 두지 않도록 생성기로).
 * 한도 안이면 파트 하나(분할 정보 없음, 이전 버전 앱과도 호환되는 형식 1).
 */
export async function* writeArchive(input: ArchiveInput, opts: { maxPartBytes?: number } = {}): AsyncGenerator<ArchivePart> {
  const maxPart = opts.maxPartBytes ?? DEFAULT_PART_BYTES;
  const assignment = planParts(
    input.assets.map((a) => a.size),
    maxPart,
  );
  const partCount = Math.max(1, ...assignment, 1);
  const split = partCount > 1;

  const assets: ManifestFile[] = input.assets.map((a, i) => ({
    id: a.id,
    path: `assets/${a.id}`,
    size: a.size,
    sha256: a.sha256,
    mime: a.mime,
    name: a.name,
    ...(split ? { part: assignment[i] } : {}),
  }));
  const sources: ManifestSource[] = input.sources.map((s) => ({
    id: s.id,
    path: `sources/${s.id}`,
    size: s.data instanceof Blob ? s.data.size : s.data.byteLength,
    sha256: s.sha256,
    mime: s.mime,
    name: s.fileName,
    importedAt: s.importedAt,
    parserVersion: s.parserVersion,
    kind: s.kind,
    sourceUrl: s.sourceUrl,
    ...(split ? { part: 1 } : {}),
  }));
  const indexHash = await sha256Hex(strToU8(JSON.stringify({ assets, sources })));
  const setId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const projectJson = strToU8(JSON.stringify({ project: input.project, documents: input.documents } satisfies ProjectJson));
  const captureFiles: Record<string, Uint8Array> = {};
  const capture: Manifest["capture"] = {};
  if (input.capture?.report !== undefined) {
    captureFiles["capture/report.json"] = strToU8(JSON.stringify(input.capture.report, null, 2));
    capture.report = "capture/report.json";
  }
  if (input.capture?.jobs !== undefined) {
    captureFiles["capture/jobs.json"] = strToU8(JSON.stringify(input.capture.jobs, null, 2));
    capture.jobs = "capture/jobs.json";
  }

  for (let p = 1; p <= partCount; p++) {
    const manifest: Manifest = {
      format: AFTERLOG_FORMAT,
      formatVersion: split ? AFTERLOG_FORMAT_VERSION : 1,
      schemaVersion: SCHEMA_VERSION,
      appVersion: input.appVersion,
      producer: input.producer,
      exportedAt: input.exportedAt,
      projectId: input.project.id,
      assets,
      sources,
      sourcesOmitted: input.sourcesOmitted,
      missingImages: missingImageCount(input),
      ...(split ? { archiveSet: { id: setId, snapshotId, partCount, partIndex: p, indexHash } } : {}),
      ...(Object.keys(capture).length ? { capture } : {}),
    };
    const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)), "project.json": projectJson, ...captureFiles };
    for (let i = 0; i < input.assets.length; i++) if (!split || assignment[i] === p) files[assets[i].path] = await toBytes(input.assets[i].data);
    if (p === 1) for (let i = 0; i < input.sources.length; i++) files[sources[i].path] = await toBytes(input.sources[i].data);
    yield { bytes: await zipAsync(files), partIndex: p, partCount };
  }
}
