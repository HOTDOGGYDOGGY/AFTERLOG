// 웹 앱의 .afterlog 저장·불러오기. 파일 규격은 src/archive/ (수집 확장과 공용).
import { newId, nowIso } from "../domain/ids";
import { ROOT, SCHEMA_VERSION, type ContentBlock, type DocumentData, type Project, type ReviewIssue, type SourceImport } from "../domain/types";
import { normalizeDocument } from "../domain/migrate";
import { db, type StoredAsset } from "../storage/db";
import { getDocuments, listAssets, listModuleStates, listSources } from "../storage/repo";
import { safeName } from "./fileName";
import { readArchive, type ArchiveReadResult } from "../archive/reader";
import { writeArchive } from "../archive/writer";
import { ProjectFileError } from "../archive/format";

export { ProjectFileError };
export const APP_VERSION = "0.3.0";

/**
 * includeSources=false: 공유용 사본. 원본 HTML/텍스트(로그인 정보·주변 화면이 섞일 수 있음)를 빼고
 * manifest에 제외했다고 기록한다. 편집 문서·이미지는 모두 포함한다.
 * 첨부가 많으면 여러 파일(파트)로 나뉜다.
 */
export async function exportProjectFile(
  projectId: string,
  opts: { includeSources?: boolean; maxPartBytes?: number } = {},
): Promise<{ files: { blob: Blob; fileName: string }[] }> {
  const includeSources = opts.includeSources ?? true;
  const project = await db().projects.get(projectId);
  if (!project) throw new Error("프로젝트가 없습니다.");
  const documents = await getDocuments(projectId);
  const assets = await listAssets(projectId);
  const sources = includeSources ? await listSources(projectId) : [];
  const modules = await listModuleStates(projectId);
  const base = `${safeName(project.title)}${includeSources ? "" : "_공유용"}`;
  const files: { blob: Blob; fileName: string }[] = [];
  for await (const part of writeArchive(
    {
      project,
      documents,
      modules: modules.map((m) => ({ moduleId: m.moduleId, stateVersion: m.stateVersion, updatedAt: m.updatedAt, payload: m.payload })),
      assets: assets.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, sha256: a.sha256, data: a.blob })),
      sources: sources.map((s) => ({
        id: s.id,
        fileName: s.fileName,
        mime: s.mime,
        importedAt: s.importedAt,
        parserVersion: s.parserVersion,
        sha256: s.sha256,
        kind: s.kind,
        sourceUrl: s.sourceUrl,
        data: s.blob,
      })),
      sourcesOmitted: !includeSources,
      appVersion: APP_VERSION,
      producer: "afterlog-web",
      exportedAt: nowIso(),
    },
    { maxPartBytes: opts.maxPartBytes },
  )) {
    const suffix = part.partCount > 1 ? `_part${String(part.partIndex).padStart(2, "0")}of${String(part.partCount).padStart(2, "0")}` : "";
    files.push({ blob: new Blob([part.bytes as BlobPart], { type: "application/zip" }), fileName: `${base}${suffix}.afterlog` });
  }
  return { files };
}

/** 파일 검사만 수행 (DB에 쓰지 않음). 분할 파트는 한꺼번에 넘긴다. */
export async function readProjectFile(file: Blob | Blob[]): Promise<ArchiveReadResult> {
  return readArchive(Array.isArray(file) ? file : [file]);
}

export interface ImportOutcome {
  project: Project;
  missingParts: number[];
  partCount: number;
  missingAssets: number;
}

/**
 * 프로젝트 파일을 새 사본으로 불러온다. 모든 ID를 새로 발급하고 내부 참조를 함께 바꾼다.
 * 현재 열린 프로젝트는 건드리지 않는다. 빠진 파트의 이미지는 '미확보'로 바꾸고 검토 항목을 남긴다.
 */
export async function importProjectFiles(files: Blob | Blob[]): Promise<ImportOutcome> {
  const r = await readProjectFile(files);
  const { manifest, data } = r;
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
  const reAsset = (id: string | null | undefined) => (id && !r.missingAssetIds.has(id) ? re(id) : null);
  const now = nowIso();
  const projectId = re(data.project.id)!;

  const reBlocks = (bs: ContentBlock[] | undefined) => bs?.map((b) => (b.type === "image" ? { ...b, assetId: reAsset(b.assetId) } : { ...b }));

  const documents: DocumentData[] = data.documents.map(normalizeDocument).map((doc) => {
    const identities: DocumentData["identities"] = {};
    for (const idn of Object.values(doc.identities)) {
      const id = re(idn.id)!;
      identities[id] = { ...idn, id, avatarAssetId: reAsset(idn.avatarAssetId) };
    }
    const entries: DocumentData["entries"] = {};
    let lost = 0;
    for (const e of Object.values(doc.entries)) {
      const id = re(e.id)!;
      lost += [...e.blocks, ...(e.excerpt ?? [])].filter((b) => b.type === "image" && b.assetId && r.missingAssetIds.has(b.assetId)).length;
      entries[id] = {
        ...e,
        id,
        authorId: e.authorId ? re(e.authorId) : null,
        blocks: reBlocks(e.blocks)!,
        originalBlocks: reBlocks(e.originalBlocks)!,
        excerpt: reBlocks(e.excerpt),
        suggestedParentId: e.suggestedParentId ? re(e.suggestedParentId) ?? undefined : undefined,
      };
    }
    const children: DocumentData["children"] = {};
    for (const [p, list] of Object.entries(doc.children)) children[p === ROOT ? ROOT : re(p)!] = list.map((x) => re(x)!);
    const issues: ReviewIssue[] = doc.issues.map((i) => ({ ...i, id: newId(), entryId: i.entryId ? re(i.entryId) ?? undefined : undefined }));
    const lostAvatars = Object.values(doc.identities).filter((i) => i.avatarAssetId && r.missingAssetIds.has(i.avatarAssetId)).length;
    if (lost || lostAvatars)
      issues.push({
        id: newId(),
        kind: "missing-image",
        message: `분할 파일 중 빠진 파트(${r.missingParts.join(", ")}번)에 있던 이미지 ${lost + lostAvatars}개를 불러오지 못했습니다. 그 파트를 함께 넣어 다시 불러오면 채워집니다.`,
        resolved: false,
      });
    return {
      ...doc,
      id: re(doc.id)!,
      projectId,
      sourceId: re(doc.sourceId)!,
      identities,
      identityOrder: doc.identityOrder.map((x) => re(x)!),
      entries,
      children,
      issues,
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
    captureReports: [...(data.project.captureReports ?? []), ...(r.captureReport ? [r.captureReport] : [])],
  };
  const assets: StoredAsset[] = (manifest.assets ?? [])
    .filter((m) => r.files[m.path])
    .map((m) => ({
      id: re(m.id)!,
      projectId,
      name: m.name,
      mime: m.mime,
      size: m.size,
      sha256: m.sha256,
      blob: new Blob([r.files[m.path] as BlobPart], { type: m.mime }),
      createdAt: now,
    }));
  const sources: SourceImport[] = (manifest.sources ?? [])
    .filter((m) => r.files[m.path])
    .map((m) => ({
      id: re(m.id)!,
      projectId,
      fileName: m.name,
      mime: m.mime,
      importedAt: m.importedAt,
      parserVersion: m.parserVersion,
      sha256: m.sha256,
      blob: new Blob([r.files[m.path] as BlobPart], { type: m.mime }),
      kind: m.kind as SourceImport["kind"],
      sourceUrl: m.sourceUrl,
    }));

  // 기존 도구 상태: 알 수 없는 모듈·버전도 버리지 않고 그대로 보관한다(해당 모듈이 읽을 때 판단)
  const modules = (Array.isArray(data.modules) ? data.modules : [])
    .filter((m) => m && typeof m.moduleId === "string")
    .map((m) => ({ projectId, moduleId: m.moduleId, stateVersion: Number(m.stateVersion) || 1, payload: m.payload, updatedAt: m.updatedAt || now }));

  const d = db();
  await d.transaction("rw", [d.projects, d.documents, d.sources, d.assets, d.modules], async () => {
    await d.projects.add(project);
    await d.modules.bulkPut(modules);
    await d.documents.bulkAdd(documents);
    await d.sources.bulkAdd(sources);
    await d.assets.bulkAdd(assets);
  });
  return { project, missingParts: r.missingParts, partCount: r.partCount, missingAssets: r.missingAssetIds.size };
}

/** 이전 이름 호환 */
export async function importProjectFile(file: Blob): Promise<Project> {
  return (await importProjectFiles(file)).project;
}
