// .afterlog 복구용 프로젝트 파일 (ZIP 컨테이너). 명세 11.2.
import { unzip, zip, strFromU8, strToU8 } from "fflate";
import { newId, nowIso } from "../domain/ids";
import { ROOT, SCHEMA_VERSION, type ContentBlock, type DocumentData, type Project, type SourceImport } from "../domain/types";
import { validateDocument } from "../domain/validate";
import { normalizeDocument } from "../domain/migrate";
import { db, type StoredAsset } from "../storage/db";
import { sha256Hex } from "../storage/hash";
import { getDocuments, listAssets, listSources } from "../storage/repo";
import { safeName } from "./fileName";

export const AFTERLOG_FORMAT = "afterlog";
export const AFTERLOG_FORMAT_VERSION = 1;
export const APP_VERSION = "0.1.0";

export const PROJECT_FILE_LIMITS = { maxEntries: 10000, maxTotalBytes: 1024 * 1024 * 1024, maxJsonBytes: 64 * 1024 * 1024 };

interface ManifestFile {
  id: string;
  path: string;
  size: number;
  sha256: string;
  mime: string;
  name: string;
}

export interface Manifest {
  format: typeof AFTERLOG_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  projectId: string;
  assets: ManifestFile[];
  sources: (ManifestFile & { importedAt: string; parserVersion: string; kind?: string; sourceUrl?: string })[];
  /** 공유용으로 원문을 뺀 경우 */
  sourcesOmitted?: boolean;
  /** 문서가 참조하지만 파일이 없는 이미지(미확보) 수 */
  missingImages?: number;
}

interface ProjectJson {
  project: Project;
  documents: DocumentData[];
}

export class ProjectFileError extends Error {
  name = "ProjectFileError";
}

function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((res, rej) => zip(files, { level: 0 }, (e, d) => (e ? rej(e) : res(d))));
}

/**
 * includeSources=false: 공유용 사본. 원본 HTML/텍스트(로그인 정보·주변 화면이 섞일 수 있음)를 빼고
 * manifest에 제외했다고 기록한다. 편집 문서·이미지는 모두 포함한다.
 */
export async function exportProjectFile(projectId: string, opts: { includeSources?: boolean } = {}): Promise<{ blob: Blob; fileName: string }> {
  const includeSources = opts.includeSources ?? true;
  const project = await db().projects.get(projectId);
  if (!project) throw new Error("프로젝트가 없습니다.");
  const documents = await getDocuments(projectId);
  const assets = await listAssets(projectId);
  const sources = includeSources ? await listSources(projectId) : [];

  const files: Record<string, Uint8Array> = {};
  const manifest: Manifest = {
    format: AFTERLOG_FORMAT,
    formatVersion: AFTERLOG_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: nowIso(),
    projectId,
    assets: [],
    sources: [],
    sourcesOmitted: !includeSources,
    missingImages: documents.reduce(
      (n, d) => n + Object.values(d.entries).reduce((m, e) => m + e.blocks.filter((b) => b.type === "image" && !b.assetId).length, 0),
      0,
    ),
  };
  for (const a of assets) {
    const path = `assets/${a.id}`;
    files[path] = new Uint8Array(await a.blob.arrayBuffer());
    manifest.assets.push({ id: a.id, path, size: a.size, sha256: a.sha256, mime: a.mime, name: a.name });
  }
  for (const s of sources) {
    const path = `sources/${s.id}`;
    files[path] = new Uint8Array(await s.blob.arrayBuffer());
    manifest.sources.push({
      id: s.id,
      path,
      size: s.blob.size,
      sha256: s.sha256,
      mime: s.mime,
      name: s.fileName,
      importedAt: s.importedAt,
      parserVersion: s.parserVersion,
      kind: s.kind,
      sourceUrl: s.sourceUrl,
    });
  }
  const pj: ProjectJson = { project, documents };
  files["project.json"] = strToU8(JSON.stringify(pj));
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  const bytes = await zipAsync(files);
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/zip" }),
    fileName: `${safeName(project.title)}${includeSources ? "" : "_공유용"}.afterlog`,
  };
}

// ---------- 불러오기 ----------

const PATH_RE = /^(manifest\.json|project\.json|assets\/[\w-]+|sources\/[\w-]+)$/;

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
          if (total > PROJECT_FILE_LIMITS.maxTotalBytes) problem = "압축을 풀면 1GB를 넘는 프로젝트 파일은 열 수 없습니다.";
          if ((f.name === "project.json" || f.name === "manifest.json") && f.originalSize > PROJECT_FILE_LIMITS.maxJsonBytes)
            problem = "프로젝트 데이터가 비정상적으로 큽니다.";
          if (problem) return false;
          return PATH_RE.test(f.name);
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

export interface ProjectFileCheck {
  manifest: Manifest;
  data: ProjectJson;
  files: Record<string, Uint8Array>;
}

/** 파일 검사만 수행 (DB에 쓰지 않음) */
export async function readProjectFile(file: Blob): Promise<ProjectFileCheck> {
  const files = await unzipChecked(new Uint8Array(await file.arrayBuffer()));
  const manifest = parseJson<Manifest>(files["manifest.json"], "manifest.json");
  if (manifest.format !== AFTERLOG_FORMAT) throw new ProjectFileError(".afterlog 프로젝트 파일이 아닙니다.");
  if (typeof manifest.formatVersion !== "number" || manifest.formatVersion > AFTERLOG_FORMAT_VERSION) {
    throw new ProjectFileError(
      `이 파일은 더 새로운 AFTERLOG(파일 형식 ${manifest.formatVersion})에서 만들어졌습니다. 이 버전은 형식 ${AFTERLOG_FORMAT_VERSION}까지 읽을 수 있습니다. 앱을 업데이트해 주세요.`,
    );
  }
  const data = parseJson<ProjectJson>(files["project.json"], "project.json");
  if (!data.project?.id || !Array.isArray(data.documents)) throw new ProjectFileError("project.json 구조가 올바르지 않습니다.");

  // 자산·원문 무결성
  for (const m of [...(manifest.assets ?? []), ...(manifest.sources ?? [])]) {
    const bytes = files[m.path];
    if (!bytes) throw new ProjectFileError(`파일이 빠져 있습니다: ${m.path}`);
    const h = await sha256Hex(bytes);
    if (h !== m.sha256) throw new ProjectFileError(`파일 내용이 기록과 다릅니다(손상): ${m.path}`);
  }
  const assetIds = new Set((manifest.assets ?? []).map((a) => a.id));
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
  return { manifest, data, files };
}

/**
 * 프로젝트 파일을 새 사본으로 불러온다. 모든 ID를 새로 발급하고 내부 참조를 함께 바꾼다.
 * 현재 열린 프로젝트는 건드리지 않는다.
 */
export async function importProjectFile(file: Blob): Promise<Project> {
  const { manifest, data, files } = await readProjectFile(file);
  const map = new Map<string, string>();
  const re = (id: string | null | undefined): string | null => {
    if (!id) return null;
    let n = map.get(id);
    if (!n) {
      n = newId();
      map.set(id, n);
    }
    return n;
  };
  const now = nowIso();
  const projectId = re(data.project.id)!;

  const reBlocks = (bs: ContentBlock[] | undefined) =>
    bs?.map((b) => (b.type === "image" ? { ...b, assetId: b.assetId ? re(b.assetId) : null } : { ...b }));

  const documents: DocumentData[] = data.documents.map(normalizeDocument).map((doc) => {
    const identities: DocumentData["identities"] = {};
    for (const idn of Object.values(doc.identities)) {
      const id = re(idn.id)!;
      identities[id] = { ...idn, id, avatarAssetId: idn.avatarAssetId ? re(idn.avatarAssetId) : null };
    }
    const entries: DocumentData["entries"] = {};
    for (const e of Object.values(doc.entries)) {
      const id = re(e.id)!;
      entries[id] = {
        ...e,
        id,
        authorId: e.authorId ? re(e.authorId) : null,
        blocks: reBlocks(e.blocks)!,
        originalBlocks: reBlocks(e.originalBlocks)!,
        excerpt: reBlocks(e.excerpt),
      };
    }
    const children: DocumentData["children"] = {};
    for (const [p, list] of Object.entries(doc.children)) children[p === ROOT ? ROOT : re(p)!] = list.map((x) => re(x)!);
    return {
      ...doc,
      id: re(doc.id)!,
      projectId,
      sourceId: re(doc.sourceId)!,
      identities,
      identityOrder: doc.identityOrder.map((x) => re(x)!),
      entries,
      children,
      issues: doc.issues.map((i) => ({ ...i, id: newId(), entryId: i.entryId ? re(i.entryId) ?? undefined : undefined })),
      revision: 1,
    };
  });

  const project: Project = {
    ...data.project,
    id: projectId,
    title: data.project.title,
    documentIds: documents.map((d) => d.id),
    updatedAt: now,
    deletedAt: null,
    schemaVersion: SCHEMA_VERSION,
  };
  const assets: StoredAsset[] = (manifest.assets ?? []).map((m) => ({
    id: re(m.id)!,
    projectId,
    name: m.name,
    mime: m.mime,
    size: m.size,
    sha256: m.sha256,
    blob: new Blob([files[m.path] as BlobPart], { type: m.mime }),
    createdAt: now,
  }));
  const sources: SourceImport[] = (manifest.sources ?? []).map((m) => ({
    id: re(m.id)!,
    projectId,
    fileName: m.name,
    mime: m.mime,
    importedAt: m.importedAt,
    parserVersion: m.parserVersion,
    sha256: m.sha256,
    blob: new Blob([files[m.path] as BlobPart], { type: m.mime }),
    kind: m.kind as SourceImport["kind"],
    sourceUrl: m.sourceUrl,
  }));

  const d = db();
  await d.transaction("rw", [d.projects, d.documents, d.sources, d.assets], async () => {
    await d.projects.add(project);
    await d.documents.bulkAdd(documents);
    await d.sources.bulkAdd(sources);
    await d.assets.bulkAdd(assets);
  });
  return project;
}
