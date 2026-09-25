// .afterlog 읽기(검사만, DB에 쓰지 않음). 분할 파트를 합치고 빠진 파트를 알려 준다.
import { strFromU8, unzip } from "fflate";
import { validateDocument } from "../domain/validate";
import { sha256Hex } from "../storage/hash";
import {
  AFTERLOG_FORMAT,
  AFTERLOG_FORMAT_VERSION,
  ARCHIVE_PATH_RE,
  PROJECT_FILE_LIMITS,
  ProjectFileError,
  type Manifest,
  type ProjectJson,
} from "./format";

function unzipChecked(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  let entries = 0;
  let total = 0;
  let problem = "";
  return new Promise((resolve, reject) => {
    unzip(
      data,
      {
        filter(f) {
          entries++;
          total += f.originalSize;
          if (entries > PROJECT_FILE_LIMITS.maxEntries) problem = "프로젝트 파일 안 항목 수가 너무 많습니다.";
          if (total > PROJECT_FILE_LIMITS.maxTotalBytes) problem = "압축을 풀면 1GB를 넘는 프로젝트 파일은 열 수 없습니다. 수집기에서 더 작은 크기로 나눠 저장해 주세요.";
          if (/\.json$/.test(f.name) && f.originalSize > PROJECT_FILE_LIMITS.maxJsonBytes) problem = "프로젝트 데이터가 비정상적으로 큽니다.";
          if (problem) return false;
          return ARCHIVE_PATH_RE.test(f.name);
        },
      },
      (err, out) => {
        if (problem) reject(new ProjectFileError(problem));
        else if (err) reject(new ProjectFileError(`프로젝트 파일이 손상되었거나 .afterlog 형식이 아닙니다. (${err.message})`));
        else resolve(out);
      },
    );
  });
}

function parseJson<T>(bytes: Uint8Array | undefined, name: string): T {
  if (!bytes) throw new ProjectFileError(`${name}이(가) 없습니다. .afterlog 파일이 맞는지 확인해 주세요.`);
  try {
    return JSON.parse(strFromU8(bytes)) as T;
  } catch {
    throw new ProjectFileError(`${name}을(를) 읽을 수 없습니다(손상).`);
  }
}

export interface ArchiveReadResult {
  manifest: Manifest;
  data: ProjectJson;
  /** 파일(자산·원문) 경로 → 바이트. 빠진 파트의 파일은 없다 */
  files: Record<string, Uint8Array>;
  /** 빠진 파트 때문에 없는 자산 ID */
  missingAssetIds: Set<string>;
  missingParts: number[];
  partCount: number;
  captureReport?: unknown;
  captureJobs?: unknown;
}

function checkVersion(m: Manifest) {
  if (m.format !== AFTERLOG_FORMAT) throw new ProjectFileError(".afterlog 프로젝트 파일이 아닙니다.");
  if (typeof m.formatVersion !== "number" || m.formatVersion > AFTERLOG_FORMAT_VERSION) {
    throw new ProjectFileError(
      `이 파일은 더 새로운 AFTERLOG(파일 형식 ${m.formatVersion})에서 만들어졌습니다. 이 버전은 형식 ${AFTERLOG_FORMAT_VERSION}까지 읽을 수 있습니다. 앱을 업데이트해 주세요.`,
    );
  }
}

/**
 * 파일 하나(일반) 또는 같은 묶음의 파트 여러 개를 읽는다.
 * 다른 스냅샷의 파트를 섞으면 거부한다(T17). 파트가 빠져도 텍스트는 읽고, 그 파트의 자산은 '누락'으로 돌려준다.
 */
export async function readArchive(inputs: Blob[]): Promise<ArchiveReadResult> {
  if (!inputs.length) throw new ProjectFileError("파일이 없습니다.");
  const parts: { manifest: Manifest; files: Record<string, Uint8Array> }[] = [];
  for (const f of inputs) {
    const files = await unzipChecked(new Uint8Array(await f.arrayBuffer()));
    const manifest = parseJson<Manifest>(files["manifest.json"], "manifest.json");
    checkVersion(manifest);
    parts.push({ manifest, files });
  }
  const sets = new Set(parts.map((p) => p.manifest.archiveSet?.snapshotId ?? "single"));
  if (sets.size > 1 || (parts.length > 1 && sets.has("single")))
    throw new ProjectFileError("서로 다른 내보내기(스냅샷)의 파일은 한 번에 불러올 수 없습니다. 같은 묶음의 파트만 함께 넣어 주세요.");
  const first = parts[0].manifest;
  const set = first.archiveSet;
  const seen = new Set<number>();
  for (const p of parts) {
    const s = p.manifest.archiveSet;
    if (s) {
      if (s.indexHash !== set!.indexHash) throw new ProjectFileError("파트의 색인이 서로 다릅니다(손상 또는 다른 묶음).");
      if (seen.has(s.partIndex)) throw new ProjectFileError(`같은 파트(${s.partIndex}번)가 두 번 들어왔습니다.`);
      seen.add(s.partIndex);
    }
  }
  const partCount = set?.partCount ?? 1;
  const missingParts = set ? Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !seen.has(n)) : [];

  const projectBytes = parts.find((p) => p.files["project.json"])?.files["project.json"];
  const data = parseJson<ProjectJson>(projectBytes, "project.json");
  if (!data.project?.id || !Array.isArray(data.documents)) throw new ProjectFileError("project.json 구조가 올바르지 않습니다.");

  const files: Record<string, Uint8Array> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p.files)) if (k.startsWith("assets/") || k.startsWith("sources/")) files[k] = v;

  const missingAssetIds = new Set<string>();
  for (const m of [...(first.assets ?? []), ...(first.sources ?? [])]) {
    const bytes = files[m.path];
    if (!bytes) {
      if (set && m.part && missingParts.includes(m.part)) {
        if (m.path.startsWith("assets/")) missingAssetIds.add(m.id);
        continue;
      }
      throw new ProjectFileError(`파일이 빠져 있습니다: ${m.path}`);
    }
    const h = await sha256Hex(bytes);
    if (h !== m.sha256) throw new ProjectFileError(`파일 내용이 기록과 다릅니다(손상): ${m.path}`);
  }
  const assetIds = new Set((first.assets ?? []).map((a) => a.id));
  for (const doc of data.documents) {
    const errs = validateDocument(doc);
    if (errs.length) throw new ProjectFileError(`문서 "${doc.title}"의 관계 정보가 손상되었습니다: ${errs.slice(0, 3).join(", ")}`);
    for (const idn of Object.values(doc.identities)) {
      if (idn.avatarAssetId && !assetIds.has(idn.avatarAssetId)) throw new ProjectFileError(`프로필 이미지 자산이 없습니다: ${idn.avatarAssetId}`);
    }
    for (const e of Object.values(doc.entries)) {
      for (const b of [...e.blocks, ...(e.excerpt ?? [])]) {
        if (b.type === "image" && b.assetId && !assetIds.has(b.assetId)) throw new ProjectFileError(`이미지 자산이 없습니다: ${b.assetId}`);
      }
    }
  }
  const pick = (path?: string) => {
    if (!path) return undefined;
    const b = parts.find((p) => p.files[path])?.files[path];
    return b ? parseJson<unknown>(b, path) : undefined;
  };
  return {
    manifest: first,
    data,
    files,
    missingAssetIds,
    missingParts,
    partCount,
    captureReport: pick(first.capture?.report),
    captureJobs: pick(first.capture?.jobs),
  };
}
