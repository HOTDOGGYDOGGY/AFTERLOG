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
import { mergeDocEntries } from "./mergeDocs";
import { bandMemberKey, isBandProfileRecord, mergeProfileRecords, type BandProfileRecord } from "../importers/band/profile";
import { sha256Hex } from "../storage/hash";

export { ProjectFileError };
export const APP_VERSION = "0.4.2";

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

export interface MergeCounts {
  /** 새로 더한 글(댓글 모음 포함) */
  added: number;
  /** 같은 글에 새 댓글·답글을 보탠 글 수와 보탠 항목 수 */
  updated: number;
  commentsAdded: number;
  /** 완전 중복이라 건너뛴 글 */
  skipped: number;
  /** 사용자가 고친 글이라 자동으로 보태지 않은 글(확인 필요) */
  keptEdited: number;
  sourcesAdded: number;
  /** 프로필: 새 인물 · 보완(새 스토리·댓글·정보 변화) · 완전 중복 */
  profilesAdded: number;
  profilesUpdated: number;
  profilesSkipped: number;
  assetsAdded: number;
  assetsReused: number;
  missingParts: number[];
}
/** 이전 이름 호환 */
export type MergeOutcome = MergeCounts;

export interface MergePlan {
  targetProjectId: string;
  targetTitle: string;
  counts: MergeCounts;
  /** 적용할 변경(계획 시점의 대상 프로젝트 판(updatedAt)을 함께 기억해, 그 사이 바뀌었으면 다시 계획한다) */
  baseUpdatedAt: string;
  addDocs: DocumentData[];
  replaceDocs: { before: DocumentData; after: DocumentData }[];
  addSources: SourceImport[];
  replaceSources: { before: SourceImport; after: SourceImport }[];
  addAssets: StoredAsset[];
  modules: { projectId: string; moduleId: string; stateVersion: number; payload: unknown; updatedAt: string }[];
  captureReport: unknown | null;
}

export interface MergeUndo {
  id: string;
  at: string;
  targetProjectId: string;
  counts: MergeCounts;
  prevDocumentIds: string[];
  prevCaptureReports: unknown[] | undefined;
  addedDocIds: string[];
  replaced: { before: DocumentData; afterRevision: number; afterUpdatedAt: string }[];
  addedSourceIds: string[];
  replacedSources: SourceImport[];
  addedAssetIds: string[];
}

const PROFILE_DATA = "band-profile-data";
const PROFILE_SNAPSHOT = "band-profile-snapshot";

async function readProfile(src: SourceImport): Promise<BandProfileRecord | null> {
  try {
    const j = JSON.parse(await src.blob.text());
    return isBandProfileRecord(j) ? j : null;
  } catch {
    return null;
  }
}

/**
 * 합치기 계획(아직 쓰지 않음). 파일을 검증·해석하고 대상 프로젝트와 비교해 새 항목·보완·완전 중복·확인 필요를 센다.
 * - 글: 밴드 글 주소 또는 내용 지문이 같으면 같은 글. 고치지 않은 글이면 새 댓글·답글만 보태고(기존 항목은 그대로), 고친 글은 건드리지 않는다.
 * - 프로필: band+member 식별자가 같으면 같은 인물 → 새 스토리·댓글·정보 변화만 보탠다. 식별자가 없는 프로필(팝업)은 이름으로 합치지 않는다.
 * - 이미지·원문: 같은 바이트는 다시 넣지 않는다.
 */
export async function planMerge(files: Blob | Blob[], targetProjectId: string): Promise<MergePlan> {
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
  const replaceDocs: { before: DocumentData; after: DocumentData }[] = [];
  const working = new Map<string, DocumentData>();
  let skipped = 0;
  let keptEdited = 0;
  let commentsAdded = 0;
  for (const raw of inc.documents) {
    const doc = remapDoc({ ...raw, sourceId: srcRemap.get(raw.sourceId) ?? raw.sourceId });
    const oldHit = keyOf(doc).map((k) => oldByKey.get(k)).find(Boolean);
    if (!oldHit) {
      addDocs.push(doc);
      for (const k of keyOf(doc)) oldByKey.set(k, doc);
      continue;
    }
    // 이번 묶음 안에서 같은 글을 두 번 만나도 누적해서 비교
    const base = working.get(oldHit.id) ?? addDocs.find((x) => x.id === oldHit.id) ?? oldHit;
    const isNew = addDocs.includes(base);
    if (!isNew && (oldHit.revision ?? 1) > 1) {
      // 사용자가 고친 글: 지운 댓글을 되살리지 않도록 자동으로 보태지 않는다(확인 필요)
      const { added } = mergeDocEntries(base, doc);
      if (added) keptEdited++;
      else skipped++;
      continue;
    }
    const { doc: merged, added } = mergeDocEntries(base, doc);
    if (!added) {
      skipped++;
      continue;
    }
    commentsAdded += added;
    if (isNew) addDocs[addDocs.indexOf(base)] = merged;
    else working.set(oldHit.id, merged);
  }
  for (const [id, after] of working) replaceDocs.push({ before: oldDocs.find((x) => x.id === id)!, after: { ...after, updatedAt: nowIso() } });

  // 프로필 구조 자료: 같은 인물은 보완, 다른 인물은 추가
  const oldProfiles: { src: SourceImport; rec: BandProfileRecord }[] = [];
  for (const x of oldSources) if (String(x.kind ?? "") === PROFILE_DATA) {
    const rec = await readProfile(x);
    if (rec) oldProfiles.push({ src: x, rec });
  }
  const replaceSources: { before: SourceImport; after: SourceImport }[] = [];
  const addSources: SourceImport[] = [];
  let profilesAdded = 0;
  let profilesUpdated = 0;
  let profilesSkipped = inc.sources.filter((x) => String(x.kind ?? "") === PROFILE_DATA && srcRemap.has(x.id)).length;
  const keptProfileData = new Set<string>();
  for (const x of candSources.filter((c) => String(c.kind ?? "") === PROFILE_DATA)) {
    const rec = await readProfile(x);
    const key = rec ? bandMemberKey(rec) : null;
    const hit = key ? oldProfiles.find((o) => bandMemberKey(o.rec) === key) : undefined;
    if (!rec || !hit) {
      addSources.push(x);
      keptProfileData.add(x.id);
      if (rec && key) oldProfiles.push({ src: x, rec });
      profilesAdded++;
      continue;
    }
    const m = mergeProfileRecords(hit.rec, rec);
    if (!m.changed) {
      profilesSkipped++;
      continue;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(m.record));
    const after: SourceImport = { ...hit.src, blob: new Blob([bytes], { type: "application/json" }), sha256: await sha256Hex(bytes), importedAt: hit.src.importedAt };
    const prev = replaceSources.find((r) => r.before.id === hit.src.id);
    if (prev) prev.after = after;
    else if (addSources.includes(hit.src)) addSources[addSources.indexOf(hit.src)] = after;
    else replaceSources.push({ before: hit.src, after });
    hit.src = after;
    hit.rec = m.record;
    keptProfileData.add(x.id);
    profilesUpdated++;
  }
  // 그 밖의 원문: 새로 들어가는 글이 가리키는 것, 보관 당시 화면(같은 관측의 구조 자료가 새로 들어갔거나 구조 자료가 없는 것)
  const usedSources = new Set([...addDocs, ...replaceDocs.map((r) => r.after)].map((x) => x.sourceId));
  const pairedData = (snap: SourceImport) => inc.sources.find((dd) => String(dd.kind ?? "") === PROFILE_DATA && dd.importedAt === snap.importedAt);
  for (const x of candSources) {
    const kind = String(x.kind ?? "");
    if (kind === PROFILE_DATA) continue;
    if (kind === PROFILE_SNAPSHOT) {
      const pd = pairedData(x);
      if (!pd || keptProfileData.has(pd.id)) addSources.push(x);
      continue;
    }
    if (usedSources.has(x.id)) addSources.push(x);
  }

  const counts: MergeCounts = {
    added: addDocs.length,
    updated: replaceDocs.length,
    commentsAdded,
    skipped,
    keptEdited,
    sourcesAdded: addSources.length,
    profilesAdded,
    profilesUpdated,
    profilesSkipped,
    assetsAdded: newAssets.length,
    assetsReused: assetRemap.size,
    missingParts: inc.r.missingParts,
  };
  const haveModules = new Set((await d.modules.where("projectId").equals(targetProjectId).toArray()).map((m) => m.moduleId));
  return {
    targetProjectId,
    targetTitle: target.title,
    counts,
    baseUpdatedAt: target.updatedAt,
    addDocs,
    replaceDocs,
    addSources,
    replaceSources,
    addAssets: newAssets,
    modules: inc.modules.filter((m) => !haveModules.has(m.moduleId)),
    captureReport: inc.captureReport ?? null,
  };
}

/** 계획을 한 번에 적용(실패하면 아무것도 바뀌지 않음). 적용 전 프로젝트가 바뀌었으면 거부한다(오래된 계획으로 덮지 않음) */
export async function applyMerge(plan: MergePlan): Promise<MergeUndo> {
  const d = db();
  let undo!: MergeUndo;
  await d.transaction("rw", [d.projects, d.documents, d.sources, d.assets, d.modules], async () => {
    const target = await d.projects.get(plan.targetProjectId);
    if (!target) throw new Error("합칠 프로젝트가 없습니다.");
    if (target.updatedAt !== plan.baseUpdatedAt) throw new Error("합치기를 준비하는 사이 프로젝트가 바뀌었습니다. 다시 합쳐 주세요.");
    for (const r of plan.replaceDocs) {
      const cur = await d.documents.get(r.before.id);
      if (!cur || cur.revision !== r.before.revision) throw new Error("합치는 사이 글이 바뀌었습니다. 다시 합쳐 주세요.");
    }
    const now = nowIso();
    undo = {
      id: newId(),
      at: now,
      targetProjectId: plan.targetProjectId,
      counts: plan.counts,
      prevDocumentIds: target.documentIds,
      prevCaptureReports: target.captureReports,
      addedDocIds: plan.addDocs.map((x) => x.id),
      replaced: plan.replaceDocs.map((r) => ({ before: r.before, afterRevision: r.after.revision, afterUpdatedAt: r.after.updatedAt })),
      addedSourceIds: plan.addSources.map((x) => x.id),
      replacedSources: plan.replaceSources.map((r) => r.before),
      addedAssetIds: plan.addAssets.map((a) => a.id),
    };
    for (const r of plan.replaceDocs) await d.documents.put(r.after);
    await d.documents.bulkAdd(plan.addDocs);
    for (const r of plan.replaceSources) await d.sources.put(r.after);
    await d.sources.bulkAdd(plan.addSources);
    await d.assets.bulkAdd(plan.addAssets);
    await d.modules.bulkPut(plan.modules);
    const reports = plan.captureReport ? [...(target.captureReports ?? []), plan.captureReport] : target.captureReports;
    await d.projects.update(plan.targetProjectId, { documentIds: [...new Set([...target.documentIds, ...plan.addDocs.map((x) => x.id)])], captureReports: reports, updatedAt: now });
  });
  return undo;
}

/**
 * 이번 합치기 되돌리기. 합친 뒤 사용자가 고친 글은 되돌리지 않고 알려 준다(충돌).
 * 다른 자료가 함께 쓰는 이미지는 지우지 않는다(이번에 새로 넣은 이미지 중 아무도 쓰지 않는 것만).
 */
export async function undoMerge(u: MergeUndo): Promise<{ conflicts: number }> {
  const d = db();
  let conflicts = 0;
  await d.transaction("rw", [d.projects, d.documents, d.sources, d.assets], async () => {
    const target = await d.projects.get(u.targetProjectId);
    if (!target) throw new Error("프로젝트가 없습니다.");
    const keepDocs = new Set<string>();
    for (const id of u.addedDocIds) {
      const cur = await d.documents.get(id);
      if (cur && cur.revision > 1) {
        conflicts++;
        keepDocs.add(id);
      } else await d.documents.delete(id);
    }
    for (const r of u.replaced) {
      const cur = await d.documents.get(r.before.id);
      if (cur && (cur.revision !== r.afterRevision || cur.updatedAt !== r.afterUpdatedAt)) conflicts++;
      else await d.documents.put(r.before);
    }
    await d.sources.bulkDelete(u.addedSourceIds);
    for (const s of u.replacedSources) await d.sources.put(s);
    // 남은 글이 쓰는 이미지는 두고 지운다
    const docs = await d.documents.where("projectId").equals(u.targetProjectId).toArray();
    const used = new Set<string>();
    for (const doc of docs) {
      for (const i of Object.values(doc.identities)) if (i.avatarAssetId) used.add(i.avatarAssetId);
      for (const e of Object.values(doc.entries)) for (const b of [...e.blocks, ...(e.originalBlocks ?? []), ...(e.excerpt ?? [])]) if (b.type === "image" && b.assetId) used.add(b.assetId);
    }
    await d.assets.bulkDelete(u.addedAssetIds.filter((id) => !used.has(id)));
    await d.projects.update(u.targetProjectId, {
      documentIds: [...u.prevDocumentIds.filter((id) => !u.addedDocIds.includes(id) || keepDocs.has(id)), ...[...keepDocs].filter((id) => !u.prevDocumentIds.includes(id))],
      captureReports: u.prevCaptureReports,
      updatedAt: nowIso(),
    });
  });
  return { conflicts };
}

/** 합치기 결과 한 줄(분석 화면·완료 알림 공통) */
export function mergeSummary(c: MergeCounts): string {
  const parts = [
    c.added ? `새 글 ${c.added}개` : "",
    c.updated ? `기존 글 ${c.updated}개에 댓글·답글 ${c.commentsAdded}개 보탬` : "",
    c.profilesAdded ? `프로필 ${c.profilesAdded}명 추가` : "",
    c.profilesUpdated ? `프로필 ${c.profilesUpdated}명 보완` : "",
    c.assetsAdded ? `이미지 ${c.assetsAdded}개 추가` : "",
    c.skipped || c.profilesSkipped ? `완전 중복 ${c.skipped + c.profilesSkipped}개 건너뜀` : "",
    c.keptEdited ? `확인 필요 ${c.keptEdited}개(고친 글이라 자동으로 보태지 않음)` : "",
    c.missingParts.length ? `빠진 파트 ${c.missingParts.join(", ")}번(그 파트의 이미지 없음)` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")}.` : "새로 더할 것이 없습니다(모두 이미 있는 자료).";
}

/** 계획 + 적용 */
export async function mergeProjectFiles(files: Blob | Blob[], targetProjectId: string): Promise<MergeCounts & { undo: MergeUndo }> {
  const plan = await planMerge(files, targetProjectId);
  const undo = await applyMerge(plan);
  return { ...plan.counts, undo };
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
