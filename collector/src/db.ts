// 수집 확장 DB (확장 origin의 IndexedDB). 작업·과제·수집 원문·첨부·진단을 보관한다.
// 진단은 백업과 다른 표에 두고 짧게 보관한다(명세 v1.1 20.7).
import Dexie, { type Table } from "dexie";
import type { Coverage } from "../../src/archive/captureReport";

export type JobStatus = "queued" | "running" | "paused" | "needsUser" | "finished" | "cancelled";
export type TaskStatus = "pending" | "inFlight" | "succeeded" | "partial" | "failed" | "skipped";

export interface JobOptions {
  /** 작성 시각 기준 기간(시작일 포함 ~ 종료 다음 날 미만, Asia/Seoul) */
  periodFrom: string | null;
  periodTo: string | null;
  includeImages: boolean;
  /** 이 확장에서 이미 저장한 글은 건너뛰기 */
  skipCaptured: boolean;
  maxPartMB: number;
  /** 개발용 진단 기록(허용 목록 방식) */
  diagnostics: boolean;
}

export interface Job {
  id: string;
  createdAt: string;
  label: string;
  scope: "current-post" | "post-urls" | "list";
  status: JobStatus;
  pauseReason: string | null;
  options: JobOptions;
  bandNo: string | null;
  bandName: string | null;
  /** 처음 확인한 계정 표식(약한 근거). 바뀌면 멈춘다 */
  accountMarker: string | null;
  /** 작업을 만든/마지막으로 실행한 확장 버전 */
  createdVersion: string;
  lastRunVersion: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastCheckpointAt: string | null;
  current: string | null;
}

export interface Task {
  id: string;
  jobId: string;
  key: string;
  kind: "list" | "post";
  url: string;
  /** 사용자의 탭에서 바로 읽을 때(탭을 이동시키지 않음) */
  tabId?: number;
  order: number;
  status: TaskStatus;
  attempts: number;
  errorCode: string | null;
  errorText: string | null;
  leaseUntil: number;
  /** 점유한 실행의 이름(Engine.run 마다 새로). 예전 과제에는 없다 */
  leaseOwner?: string | null;
  notBefore: number;
  result?: {
    title?: string;
    commentsShown?: number | null;
    commentsFound?: number;
    outOfRange?: boolean;
    coverage?: Coverage;
    found?: number;
    evidence?: string;
    userVerified?: boolean;
  };
}

export interface Capture {
  id: string;
  jobId: string;
  taskId: string;
  key: string;
  url: string;
  bandNo: string;
  postNo: string;
  bandName: string | null;
  html: string;
  imageUrls: string[];
  capturedAt: string;
  commentsShown: number | null;
  commentsFound: number;
  collectorVersion: string;
}

export type AssetStatus = "pending" | "stored" | "failed" | "unavailable" | "notRequested" | "unsupported";
export interface StoredCollectorAsset {
  url: string;
  status: AssetStatus;
  quality: "original" | "thumbnail" | "unknown";
  mime: string | null;
  size: number;
  sha256: string | null;
  blob: Blob | null;
  errorCode: string | null;
  attempts: number;
  fetchedAt: string | null;
}

export interface DiagRecord {
  id?: number;
  jobId: string;
  at: number;
  /** 허용 목록 이벤트(진단 스키마로 이미 검증된 객체) */
  event: unknown;
  bytes: number;
}

export class CollectorDB extends Dexie {
  jobs!: Table<Job, string>;
  tasks!: Table<Task, string>;
  captures!: Table<Capture, string>;
  assets!: Table<StoredCollectorAsset, string>;
  diag!: Table<DiagRecord, number>;

  constructor(name = "afterlog-collector") {
    super(name);
    this.version(1).stores({
      jobs: "id, createdAt, status",
      tasks: "id, jobId, [jobId+key], [jobId+status], [jobId+order], key",
      captures: "id, jobId, key, [jobId+key], capturedAt",
      assets: "url, status",
      diag: "++id, jobId, at",
    });
  }
}

let inst: CollectorDB | null = null;
export const cdb = () => (inst ??= new CollectorDB());
export const _resetCollectorDbForTests = (name?: string) => {
  inst = new CollectorDB(name);
  return inst;
};
