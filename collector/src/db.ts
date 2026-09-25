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
  /** 선택 수집(선택 수집 명세 v1.0). 없으면 예전처럼 주소·목록 전체 */
  selection?: Selection | null;
}

/** 선택 인물. 밴드 ID + 멤버 식별자로 구분한다(이름은 표시·찾기용, 3.3) */
export interface SelectedMember {
  /** 밴드 주소의 출처(https://band.us). 테스트 빌드는 가짜 서버 */
  origin?: string;
  bandNo: string;
  memberKey: string;
  /** 목록 머리글에서 읽은 표시 이름. 모르면 null */
  name: string | null;
}

/**
 * 네 가지 모드(3.1). 켜진 모드들의 합집합(OR)으로 대상을 모은다.
 * A authored: 이 인물이 쓴 글 · B commentsOnly: 이 인물이 쓴 댓글만 · C commentedPosts: 이 인물이 댓글 단 글 · D search: 검색 결과
 */
export interface Selection {
  members: SelectedMember[];
  authored: boolean;
  commentsOnly: boolean;
  commentedPosts: boolean;
  /** 기간 기준(5절): A는 글 작성일, B·C는 이 인물의 댓글 작성일 */
  periodFrom: string | null;
  periodTo: string | null;
}

/** 대상이 된 이유(한 글에 여러 개 가능, 8절) */
export type SelectReason = "authored" | "commented" | "search" | "list" | "url";

/** 멤버 댓글 목록에서 관측한 댓글 하나(B·C). 목록이 보여 준 그대로 보관한다 */
export interface CommentObservation {
  id: string;
  jobId: string;
  /** 이 댓글을 찾은 댓글 목록 과제 */
  taskId: string;
  bandNo: string;
  memberKey: string;
  memberName: string | null;
  /** 목록에서의 순서(0부터). 목록에 댓글 ID가 없어 이 순서로만 구분한다 */
  seq: number;
  /** 정리된 목록 항목 HTML(입력칸·스크립트·data-* 제거) */
  html: string;
  /** 목록에 보이는 댓글 글자 / 원글 발췌 / 날짜 표기 */
  text: string;
  excerpt: string;
  dateText: string;
  /** 날짜 해석(Asia/Seoul, YYYY-MM-DDTHH:mm). 못 읽으면 null */
  local: string | null;
  /** 기간 안인지. 날짜를 못 읽으면 null(조용히 빼지 않음) */
  inRange: boolean | null;
  /** 원글 연결: pending 대기 · linked 확인 · guessed 같은 발췌의 원글로 추정(원글에서 확인 전) · failed 실패 · notNeeded 요청 안 함 */
  link: "pending" | "linked" | "guessed" | "failed" | "notNeeded";
  postKey: string | null;
  postUrl: string | null;
  /** 내용 상태: listText 목록 표시 그대로(전문 여부 미확인) · verified 원글의 댓글과 대조해 같음 */
  content: "listText" | "verified";
  linkError?: string;
}

export interface Job {
  id: string;
  createdAt: string;
  label: string;
  scope: "current-post" | "post-urls" | "list" | "selection";
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
  /** list: 글 목록에서 글 찾기 · comments: 멤버 댓글 목록 읽기(B·C) · post: 글 하나 */
  kind: "list" | "post" | "comments";
  url: string;
  /** 대상이 된 이유(post). 같은 글이 여러 조건에 걸리면 모두 쌓는다 */
  reasons?: SelectReason[];
  /** 목록 과제가 어떤 조건의 탐색인지(list·comments) */
  listReason?: SelectReason;
  memberKey?: string;
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
    /** 댓글 목록: 관측한 댓글 수 · 원글 연결 수 */
    comments?: number;
    linked?: number;
    memberName?: string | null;
    userVerified?: boolean;
    /** 이전 저장본 재사용(이번에 다시 열지 않음) */
    reused?: boolean;
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
  reasons?: SelectReason[];
  /** 이전 작업의 저장본을 다시 쓴 것이면 그 저장 시각(이번에 다시 열지 않음) */
  reusedFrom?: string;
  /** 선택 수집에서 열어 봤지만 결과에서 뺀 저장본(글 작성일이 기간 밖). 다른 조건(댓글 단 글)으로 대상이 되면 다시 열지 않고 살린다 */
  excluded?: "outOfRange";
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
  comments!: Table<CommentObservation, string>;

  constructor(name = "afterlog-collector") {
    super(name);
    this.version(1).stores({
      jobs: "id, createdAt, status",
      tasks: "id, jobId, [jobId+key], [jobId+status], [jobId+order], key",
      captures: "id, jobId, key, [jobId+key], capturedAt",
      assets: "url, status",
      diag: "++id, jobId, at",
    });
    // v2: 멤버 댓글 목록 관측(선택 수집 B·C)
    this.version(2).stores({
      comments: "id, jobId, taskId, [jobId+link], [taskId+seq]",
    });
  }
}

let inst: CollectorDB | null = null;
export const cdb = () => (inst ??= new CollectorDB());
export const _resetCollectorDbForTests = (name?: string) => {
  inst = new CollectorDB(name);
  return inst;
};
