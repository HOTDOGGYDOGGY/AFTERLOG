// 저장소 접근. 모든 쓰기는 트랜잭션 완료 후에만 성공으로 본다.
import { newId, nowIso } from "../domain/ids";
import { SCHEMA_VERSION, type DocumentData, type Project, type SourceImport } from "../domain/types";
import { sha256Hex } from "./hash";
import { normalizeDocument } from "../domain/migrate";
import { db, type ModuleState, type StoredAsset } from "./db";

export class ConflictError extends Error {
  name = "ConflictError";
}

export async function createProject(title: string): Promise<Project> {
  const now = nowIso();
  const p: Project = { id: newId(), title, schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now, documentIds: [], deletedAt: null };
  await db().projects.add(p);
  return p;
}

export async function listProjects(): Promise<Project[]> {
  const all = await db().projects.toArray();
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string) {
  return db().projects.get(id);
}

export async function renameProject(id: string, title: string) {
  await db().projects.update(id, { title, updatedAt: nowIso() });
}

/** 휴지통으로 이동 (복구 가능) */
export async function trashProject(id: string, trashed: boolean) {
  await db().projects.update(id, { deletedAt: trashed ? nowIso() : null });
}

/** 영구 삭제: 프로젝트의 문서·원문·자산을 한 트랜잭션에서 지운다 */
export async function purgeProject(id: string) {
  const d = db();
  await d.transaction("rw", [d.projects, d.documents, d.sources, d.assets, d.modules], async () => {
    await d.modules.where("projectId").equals(id).delete();
    await d.documents.where("projectId").equals(id).delete();
    await d.sources.where("projectId").equals(id).delete();
    await d.assets.where("projectId").equals(id).delete();
    await d.projects.delete(id);
  });
}

export async function getDocuments(projectId: string): Promise<DocumentData[]> {
  const p = await db().projects.get(projectId);
  const docs = await db().documents.where("projectId").equals(projectId).toArray();
  const order = p?.documentIds ?? [];
  return docs.map(normalizeDocument).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** 가져온 원문·자산·문서를 한 번에 기록 */
export async function addImport(projectId: string, source: SourceImport, docs: DocumentData[]) {
  const d = db();
  await d.transaction("rw", [d.projects, d.documents, d.sources], async () => {
    await d.sources.put(source);
    for (const doc of docs) await d.documents.put({ ...doc, revision: 1 });
    const p = await d.projects.get(projectId);
    if (!p) throw new Error("프로젝트가 없습니다.");
    await d.projects.put({ ...p, documentIds: [...p.documentIds, ...docs.map((x) => x.id)], updatedAt: nowIso() });
  });
}

export async function removeDocument(projectId: string, docId: string) {
  const d = db();
  await d.transaction("rw", [d.projects, d.documents], async () => {
    await d.documents.delete(docId);
    const p = await d.projects.get(projectId);
    if (p) await d.projects.put({ ...p, documentIds: p.documentIds.filter((x) => x !== docId), updatedAt: nowIso() });
  });
}

/**
 * 문서 저장. 저장된 revision이 expected와 다르면(다른 탭이 먼저 저장) ConflictError.
 * 성공 시 새 revision을 돌려준다.
 */
export async function saveDocument(doc: DocumentData, expectedRevision: number): Promise<number> {
  const d = db();
  let next = expectedRevision;
  await d.transaction("rw", [d.documents, d.projects], async () => {
    const cur = await d.documents.get(doc.id);
    const curRev = cur?.revision ?? 0;
    if (cur && curRev !== expectedRevision) {
      throw new ConflictError("다른 탭에서 이 문서를 먼저 저장했습니다. 덮어쓰지 않았습니다.");
    }
    next = curRev + 1;
    const now = nowIso();
    await d.documents.put({ ...doc, revision: next, updatedAt: now });
    await d.projects.update(doc.projectId, { updatedAt: now });
  });
  return next;
}

export async function getRevision(docId: string): Promise<number> {
  return (await db().documents.get(docId))?.revision ?? 0;
}

// ---------- 자산 ----------

const ALLOWED_IMAGE = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;

export function guessMime(name: string, fallback = ""): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" };
  return map[ext] ?? fallback;
}

/** 같은 프로젝트에서 해시가 같으면 기존 자산을 재사용 */
export async function addAsset(projectId: string, blob: Blob, name: string): Promise<StoredAsset> {
  const mime = blob.type && blob.type !== "application/octet-stream" ? blob.type : guessMime(name);
  if (!ALLOWED_IMAGE.test(mime)) throw new Error(`이미지 파일이 아닙니다: ${name}`);
  const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
  const sha256 = await sha256Hex(typed);
  const d = db();
  const existing = await d.assets.where("[projectId+sha256]").equals([projectId, sha256]).first();
  if (existing) return existing;
  const a: StoredAsset = { id: newId(), projectId, name, mime, size: typed.size, sha256, blob: typed, createdAt: nowIso() };
  await d.assets.add(a);
  return a;
}

export async function listAssets(projectId: string): Promise<StoredAsset[]> {
  return db().assets.where("projectId").equals(projectId).toArray();
}

export async function deleteAsset(id: string) {
  await db().assets.delete(id);
}

export async function listSources(projectId: string) {
  return db().sources.where("projectId").equals(projectId).toArray();
}

// ---------- 기존 도구·원문 보관 모듈 상태 ----------

export async function getModuleState(projectId: string, moduleId: string): Promise<ModuleState | undefined> {
  return db().modules.get([projectId, moduleId]);
}

export async function listModuleStates(projectId: string): Promise<ModuleState[]> {
  return db().modules.where("projectId").equals(projectId).toArray();
}

/** 모듈 상태 저장. 트랜잭션이 끝나야 성공으로 본다 */
export async function putModuleState(state: Omit<ModuleState, "updatedAt">): Promise<void> {
  const d = db();
  const now = nowIso();
  await d.transaction("rw", [d.modules, d.projects], async () => {
    await d.modules.put({ ...state, updatedAt: now });
    await d.projects.update(state.projectId, { updatedAt: now });
  });
}
