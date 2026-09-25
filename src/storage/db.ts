import Dexie, { type Table } from "dexie";
import type { Asset, DocumentData, Project, SourceImport } from "../domain/types";

export interface StoredAsset extends Asset {
  projectId: string;
  createdAt: string;
}

/**
 * 기존 도구(카톡·카페·트위터·DM)와 원문 보관(짓시)의 상태. 새 공통 문서 모델로 억지로 바꾸지 않고
 * 모듈 ID·상태 버전과 함께 그대로 보관한다(명세 v1.2 15.5).
 */
export interface ModuleState {
  projectId: string;
  moduleId: string;
  stateVersion: number;
  /** 모듈이 돌려준 상태(JSON). 이미지는 data URL로 들어 있다 */
  payload: unknown;
  updatedAt: string;
}

export class AfterlogDB extends Dexie {
  projects!: Table<Project, string>;
  modules!: Table<ModuleState, [string, string]>;
  documents!: Table<DocumentData, string>;
  sources!: Table<SourceImport, string>;
  assets!: Table<StoredAsset, string>;

  constructor(name = "afterlog") {
    super(name);
    this.version(1).stores({
      projects: "id, updatedAt, deletedAt",
      documents: "id, projectId",
      sources: "id, projectId, sha256",
      assets: "id, projectId, [projectId+sha256]",
    });
    this.version(2).stores({
      modules: "[projectId+moduleId], projectId",
    });
  }
}

let instance: AfterlogDB | null = null;
export function db(): AfterlogDB {
  if (!instance) instance = new AfterlogDB();
  return instance;
}

/** 저장 공간이 부족하거나 브라우저가 거부했을 때 사람이 읽을 수 있는 이유 */
export function describeStorageError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  const inner = (e as { inner?: { name?: string } })?.inner?.name ?? "";
  if (name === "QuotaExceededError" || inner === "QuotaExceededError") return "브라우저 저장 공간이 부족합니다.";
  if (name === "ConflictError") return (e as Error).message;
  if (name === "InvalidStateError" || name === "MissingAPIError") return "이 브라우저 창에서는 저장소를 쓸 수 없습니다(사생활 보호 모드 등).";
  return (e as Error)?.message || "알 수 없는 저장 오류";
}
