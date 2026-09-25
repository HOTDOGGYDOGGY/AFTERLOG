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
export const APP_VERSION = "0.3.4";

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
  const { project, documents, sources, assets, modules, r } = await prepareImport(files);
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

/** 파일을 읽어 새 ID를 붙인 저장 단위로 만든다(DB에는 쓰지 않음). targetProjectId를 주면 그 프로젝트 소속으로 */
async function prepareImport(files: Blob | Blob[], targetProjectId?: string) {
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
  const projectId = targetProjectId ?? re(data.project.id)!;

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

  return { project, documents, sources, assets, modules, r, captureReport: r.captureReport };
}

export interface MergeOutcome {
  added: number;
  updated: number;
  skipped: number;
  /** 사용자가 고친 글이라 더 많이 확보한 새 자료가 와도 덮어쓰지 않은 글 */
  keptEdited: number;
  sourcesAdded: number;
  profilesAdded: number;
  assetsReused: number;
  missingParts: number[];
}

/**
 * .afterlog를 지금 프로젝트에 합친다. 같은 글은 한 번만: 밴드 글 주소(수집 확장 원문)나 내용 지문(작성자·시각·본문 앞부분)이 같으면 같은 글로 본다.
 * 같은 글이면 새 자료가 댓글을 더 많이 확보했고 기존 글을 고친 적이 없을 때만 새 자료로 바꾸고, 아니면 건너뛴다.
 * 이미지는 바이트 해시가 같으면 기존 것을 다시 쓰고, 원문(프로필 보관본 포함)은 해시가 같으면 건너뛴다.
 */
export async function mergeProjectFiles(files: Blob | Blob[], targetProjectId: string): Promise<MergeOutcome> {
  const d = db();
  const target = await d.projects.get(targetProjectId);
  if (!target) throw new Error("합칠 프로젝트가 없습니다.");
  const inc = await prepareImport(files, targetProjectId);
  const [oldDocs, oldSources, oldAssets] = await Promise.all([
    d.documents.where("projectId").equals(targetProjectId).toArray(),
    d.sources.where("projectId").equals(targetProjectId).toArray(),
    d.assets.where("projectId").equals(targetProjectId).toArray(),
  ]);

  // 이미지: 같은 바이트면 기존 자산으로 바꿔 쓴다
  const assetBySha = new Map(oldAssets.map((a) => [a.sha256, a.id]));
  const assetRemap = new Map<string, string>();
  const newAssets: StoredAsset[] = [];
  for (const a of inc.assets) {
    const hit = assetBySha.get(a.sha256);
    if (hit) assetRemap.set(a.id, hit);
    else {
      newAssets.push(a);
      assetBySha.set(a.sha256, a.id);
    }
  }
  const ra = (id: string | null | undefined) => (id ? assetRemap.get(id) ?? id : id ?? null);
  const remapDoc = (doc: DocumentData): DocumentData => {
    const identities: DocumentData["identities"] = {};
    for (const [k, idn] of Object.entries(doc.identities)) identities[k] = { ...idn, avatarAssetId: ra(idn.avatarAssetId) };
    const fix = (bs: ContentBlock[] | undefined) => bs?.map((b) => (b.type === "image" ? { ...b, assetId: ra(b.assetId) } : b));
    const entries: DocumentData["entries"] = {};
    for (const [k, e] of Object.entries(doc.entries)) entries[k] = { ...e, blocks: fix(e.blocks)!, originalBlocks: fix(e.originalBlocks)!, excerpt: fix(e.excerpt) };
    return { ...doc, identities, entries };
  };

  // 원문: 같은 해시면 건너뛴다
  const srcBySha = new Map(oldSources.map((x) => [x.sha256, x.id]));
  const srcRemap = new Map<string, string>();
  const candSources: SourceImport[] = [];
  for (const x of inc.sources) {
    const hit = srcBySha.get(x.sha256);
    if (hit) srcRemap.set(x.id, hit);
    else {
      candSources.push(x);
      srcBySha.set(x.sha256, x.id);
    }
  }

  // 글: 같은 글 판정 키
  const allSources = new Map([...oldSources, ...inc.sources].map((x) => [x.id, x]));
  const keyOf = (doc: DocumentData) => documentKey(doc, allSources.get(doc.sourceId)?.sourceUrl);
  const oldByKey = new Map<string, DocumentData>();
  for (const od of oldDocs) for (const k of keyOf(od)) oldByKey.set(k, od);
  const addDocs: DocumentData[] = [];
  const replace: { old: DocumentData; doc: DocumentData }[] = [];
  let skipped = 0;
  let keptEdited = 0;
  for (const raw of inc.documents) {
    const doc = remapDoc({ ...raw, sourceId: srcRemap.get(raw.sourceId) ?? raw.sourceId });
    const old = keyOf(doc).map((k) => oldByKey.get(k)).find(Boolean);
    if (!old) {
      addDocs.push(doc);
      for (const k of keyOf(doc)) oldByKey.set(k, doc);
      continue;
    }
    const more = Object.keys(doc.entries).length > Object.keys(old.entries).length;
    if (more && (old.revision ?? 1) <= 1) replace.push({ old, doc: { ...doc, id: old.id } });
    else {
      skipped++;
      if (more) keptEdited++;
    }
  }

  // 원문은 새로 들어가는 글이 가리키는 것과 프로필 보관본(글이 아닌 자료)만 더한다. 건너뛴 글의 원문은 남기지 않는다
  const usedSources = new Set([...addDocs, ...replace.map((r) => r.doc)].map((x) => x.sourceId));
  const isStandalone = (x: SourceImport) => /^band-profile/.test(String(x.kind ?? ""));
  const newSources = candSources.filter((x) => usedSources.has(x.id) || isStandalone(x));
  const profilesAdded = newSources.filter((x) => String(x.kind ?? "") === "band-profile-snapshot").length;

  const reports = inc.captureReport ? [...(target.captureReports ?? []), inc.captureReport] : target.captureReports;
  const docIds = [...target.documentIds.filter((id) => !replace.some((r) => r.old.id === id)), ...replace.map((r) => r.doc.id), ...addDocs.map((x) => x.id)];
  const haveModules = new Set((await d.modules.where("projectId").equals(targetProjectId).toArray()).map((m) => m.moduleId));
  await d.transaction("rw", [d.projects, d.documents, d.sources, d.assets, d.modules], async () => {
    for (const r of replace) await d.documents.put(r.doc);
    await d.documents.bulkAdd(addDocs);
    await d.sources.bulkAdd(newSources);
    await d.assets.bulkAdd(newAssets);
    await d.modules.bulkPut(inc.modules.filter((m) => !haveModules.has(m.moduleId)));
    await d.projects.update(targetProjectId, { documentIds: [...new Set(docIds)], captureReports: reports, updatedAt: nowIso() });
  });
  return {
    added: addDocs.length,
    updated: replace.length,
    skipped,
    keptEdited,
    sourcesAdded: newSources.length,
    profilesAdded,
    assetsReused: assetRemap.size,
    missingParts: inc.r.missingParts,
  };
}

/** 같은 글 판정 키들: 밴드 글 주소(있으면) + 내용 지문 */
export function documentKey(doc: DocumentData, sourceUrl?: string): string[] {
  const keys: string[] = [];
  const m = sourceUrl?.match(/\/band\/(\d+)\/post\/(\d+)/);
  if (m) keys.push(`band:${m[1]}:post:${m[2]}`);
  const first = (doc.children[ROOT] ?? []).map((id) => doc.entries[id]).find(Boolean) ?? Object.values(doc.entries)[0];
  if (first) {
    const who = first.authorId ? doc.identities[first.authorId]?.originalName ?? "" : "";
    const text = first.blocks.map((b) => ("text" in b ? String((b as { text?: string }).text ?? "") : "")).join("").replace(/\s+/g, "").slice(0, 200);
    keys.push(`sig:${doc.inputFormat}:${who}:${first.time?.local ?? first.time?.raw ?? ""}:${text}`);
  }
  return keys;
}

/** 이전 이름 호환 */
export async function importProjectFile(file: Blob): Promise<Project> {
  return (await importProjectFiles(file)).project;
}
