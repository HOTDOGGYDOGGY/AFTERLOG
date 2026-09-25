// 수집 엔진 (수집 명세 8·9절). 수집 관리 페이지 안에서 돈다.
// 상태는 전부 DB에 두고(메모리에 작업을 들고 있지 않음), 한 과제의 결과와 완료 표시는 한 트랜잭션에서 확정한다.
// 창이 닫히거나 확장이 업데이트되어도 점유(lease)가 끝난 과제는 다시 대기열로 돌아가 이어받는다.
import { parseBandHtml, type ParsedDocument } from "../../src/importers/band/html";
import { COLLECTOR_VERSION, LIMITS, MIN_DELAY_MS } from "./config";
import { cdb, type Capture, type CommentObservation, type Job, type SelectReason, type Selection, type Task } from "./db";
import { parseKoreanDateTime } from "../../src/importers/band/time";
import { commentInCapture, describeSelection, judgePost, type PostVerdict } from "./selection";
import { BrowserError, imageQuality, type CollectorBrowser, type TabRole } from "./browser";
import { DiagRecorder, pruneDiagnostics } from "./diagnostics/recorder";
import { countBucket, durationBucket, sizeBucket, type CountBucket, type ProbeId } from "./diagnostics/schema";
import { parseBandUrl, postKey } from "./urls";

export type EngineEvent = { type: "changed"; jobId: string } | { type: "stopped"; jobId: string; reason: string };

export interface EngineDeps {
  browser: CollectorBrowser;
  /** 같은 작업이 두 창에서 동시에 돌지 않게(T06). 테스트에서는 바꿔 끼운다 */
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T | "busy">;
  /** lock이 '이 작업을 도는 실행은 하나뿐'을 보장하는가. 보장되면 다른 실행 이름의 점유는 끝난 실행의 잔여물이다 */
  exclusiveLock?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  onEvent?: (e: EngineEvent) => void;
}

const defaultLock = async <T,>(name: string, fn: () => Promise<T>): Promise<T | "busy"> => {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return fn();
  let ran = false;
  const r = await locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return "busy" as const;
    ran = true;
    return fn();
  });
  return ran ? (r as T) : "busy";
};

const iso = (t: number) => new Date(t).toISOString();

const INTERRUPTED = { ok: false as const, code: "other", text: "일시정지", retry: true, interrupted: true };

/**
 * 이전 작업에서 저장한 본문을 이 작업에 다시 쓴다(열지 않음, 7.1-4). 댓글을 다 못 받은(일부) 저장본은 쓰지 않고 다시 연다. 결과에는 '이전 저장본 재사용'으로 남긴다(9절 최신성).
 * 트랜잭션 안에서 부른다. 과제에 넣을 상태 필드를 돌려준다
 */
async function reuseCapture(before: Capture, jobId: string, taskId: string, key: string, reasons: SelectReason[], sel?: Selection | null): Promise<Partial<Task>> {
  const doc = parseBandHtml(before.html).documents.find((d) => d.format === "band-post");
  const title = doc?.title;
  const reusedNote = `이전 작업에서 저장한 본문을 다시 썼습니다(${before.capturedAt.slice(0, 10)} 저장, 이번에 다시 열지 않음).`;
  // 선택 수집이면 다시 쓴 본문도 같은 조건으로 판정한다(검색어·기간)
  const v = sel && doc ? judgePost(doc, reasons, sel, before.commentsShown === null || before.commentsShown <= before.commentsFound) : null;
  const judged = v ? { confirmed: v.confirmed, matches: v.matches?.map(({ where, index, terms }) => ({ where, index, terms })) } : {};
  await cdb().captures.add({ ...before, id: crypto.randomUUID(), jobId, taskId, key, reasons, excluded: v && !v.include ? v.excluded : undefined, reusedFrom: before.capturedAt });
  if (v && !v.include)
    return {
      status: "skipped",
      errorCode: v.excluded,
      errorText: `${EXCLUDED_TEXT[v.excluded!]} ${reusedNote}`,
      result: { title, commentsShown: before.commentsShown, commentsFound: before.commentsFound, reused: true, outOfRange: v.excluded === "outOfRange", ...judged },
    };
  const partial = before.commentsShown !== null && before.commentsShown !== before.commentsFound;
  return {
    status: partial ? "partial" : "succeeded",
    errorCode: "reused",
    errorText: reusedNote,
    result: { title, commentsShown: before.commentsShown, commentsFound: before.commentsFound, reused: true, ...judged },
  };
}

/** 이 글의 저장본(이전 작업 것 포함, 결과에서 뺀 것 제외). 가장 최근 것 */
async function findCapture(key: string, notJob?: string, completeOnly = false): Promise<Capture | undefined> {
  const all = await cdb()
    .captures.where("key")
    .equals(key)
    .filter((c) => !c.excluded && c.jobId !== notJob && (!completeOnly || c.commentsShown === null || c.commentsShown <= c.commentsFound))
    .toArray();
  return all.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))[0];
}

/** 진행 중인 이미지 요청(같은 주소 중복 방지). 수집 관리 창 하나에서 공유한다 */
const ASSET_IN_FLIGHT = new Map<string, Promise<void>>();

export const EXCLUDED_TEXT: Record<NonNullable<Capture["excluded"]>, string> = {
  outOfRange: "기간 밖이라 결과에서 뺐습니다(저장본은 남겨 둠).",
  noMatch: "검색어가 본문(선택 시 댓글)에 없어 결과에서 뺐습니다.",
  unknown: "판단할 수 없어 결과에서 뺐습니다(댓글을 다 불러오지 못했거나 작성 시각을 모름). 확인이 필요합니다.",
  notAll: "모든 조건(교집합)에 맞지 않아 결과에서 뺐습니다.",
};

/**
 * 과제에 선정 사유를 더한다(저장본에도). 조건 판정으로 빠졌던 글이 다른 조건으로 대상이 되면
 * 이미 받아 둔 저장본으로 다시 판정한다(다시 열지 않음). 살렸으면 그 저장본을 돌려준다(이미지를 받게)
 */
async function addReason(task: Task, reason: SelectReason, job: Job): Promise<Capture | null> {
  const fresh = (await cdb().tasks.get(task.id)) ?? task;
  if (fresh.reasons?.includes(reason)) return null;
  const reasons = [...(fresh.reasons ?? []), reason];
  await cdb().tasks.update(task.id, { reasons });
  await cdb().captures.where("[jobId+key]").equals([task.jobId, task.key]).modify({ reasons });
  const sel = job.options.selection;
  if (!sel || fresh.status !== "skipped" || !fresh.errorCode || !(fresh.errorCode in EXCLUDED_TEXT)) return null;
  const cap = await cdb().captures.where("[jobId+key]").equals([task.jobId, task.key]).filter((c) => !!c.excluded).first();
  if (!cap) {
    // 저장본이 없으면 다시 연다
    await cdb().tasks.update(task.id, { status: "pending", attempts: 0, notBefore: 0, errorCode: null, errorText: null });
    return null;
  }
  const doc = parseBandHtml(cap.html).documents.find((d) => d.format === "band-post");
  if (!doc) return null;
  const v = judgePost(doc, reasons, sel, cap.commentsShown === null || cap.commentsShown <= cap.commentsFound);
  const judged = { confirmed: v.confirmed, matches: v.matches?.map(({ where, index, terms }) => ({ where, index, terms })) };
  if (!v.include) {
    await cdb().captures.update(cap.id, { excluded: v.excluded });
    await cdb().tasks.update(task.id, { errorCode: v.excluded, errorText: EXCLUDED_TEXT[v.excluded!], result: { ...fresh.result, ...judged } });
    return null;
  }
  const partial = cap.commentsShown !== null && cap.commentsShown !== cap.commentsFound;
  await cdb().captures.update(cap.id, { excluded: undefined });
  await cdb().tasks.update(task.id, {
    status: partial ? "partial" : "succeeded",
    errorCode: partial ? "countMismatch" : null,
    errorText: partial ? `표시된 댓글 ${cap.commentsShown}개 중 ${cap.commentsFound}개만 화면에 있었습니다(접힌 댓글 미로딩 가능).` : null,
    result: { ...fresh.result, outOfRange: false, commentsShown: cap.commentsShown, commentsFound: cap.commentsFound, ...judged },
  });
  return { ...cap, excluded: undefined };
}

/** 댓글 펼치기 결과 설명 */
export function expandNote(clicks: number, stop?: string) {
  if (!clicks) return "펼칠 버튼을 찾지 못함. 삭제·숨김 댓글이 숫자에만 들어 있을 수 있음";
  if (stop === "timeout") return `'이전 댓글' 펼치기 ${clicks}번 뒤 시간 한도에 걸림. '댓글 모자란 글 다시'로 이어서 펼칠 수 있음`;
  if (stop === "noProgress") return `'이전 댓글' 펼치기 ${clicks}번 뒤 더 눌러도 늘지 않음. 삭제·숨김 댓글일 수 있음`;
  return `'이전 댓글' 펼치기 ${clicks}번 뒤 더 누를 버튼이 없음. 삭제·숨김 댓글이 숫자에만 들어 있을 수 있음`;
}

/** 요청 사이 대기(명세 8.3: 1.5~3초) */
export function paceDelay(r: number) {
  return MIN_DELAY_MS + r * MIN_DELAY_MS;
}

export function periodContains(local: string | null, from: string | null, to: string | null): boolean | null {
  if (!from && !to) return true;
  if (!local) return null; // 시각을 모르면 판단 불가
  const day = local.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export class Engine {
  private stopRequested = false;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private random: () => number;
  private lock: NonNullable<EngineDeps["lock"]>;
  private exclusive: boolean;
  /** 이번 실행의 이름. 과제 점유에 적어 두고, 남의 점유와 구분한다 */
  private runId = "";
  /** 글 저장 뒤 뒤에서 받는 이미지(다음 글을 여는 동안 받는다). 작업을 끝내거나 멈추기 전에 모두 기다린다 */
  private assetJobs = new Set<Promise<void>>();
  /** 한쪽 일꾼이 멈춤·로그인 필요로 끝내면 다른 쪽도 멈춘다 */
  private halt: "paused" | "needsUser" | null = null;
  private diag: DiagRecorder | null = null;
  /** 이번 실행에서 이미 시도한 이미지 주소(실패한 주소를 글마다 다시 받지 않음. 다시 받기는 '이미지 실패 다시') */
  private assetTried = new Set<string>();
  private lastRequestAt = 0;
  private gateChain: Promise<void> = Promise.resolve();

  constructor(private deps: EngineDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    this.lock = deps.lock ?? defaultLock;
    this.exclusive = deps.lock ? !!deps.exclusiveLock : !!(globalThis.navigator as Navigator | undefined)?.locks;
  }

  requestStop() {
    this.stopRequested = true;
  }

  private emit(jobId: string) {
    this.deps.onEvent?.({ type: "changed", jobId });
  }

  private async setJob(id: string, patch: Partial<Job>) {
    await cdb().jobs.update(id, patch);
    this.emit(id);
  }

  /**
   * 점유가 끝난 과제를 대기열로 되돌린다(T04, D09, C01).
   * 점유 시간이 지났거나, 잠금이 단독 실행을 보장하는데 다른 실행 이름으로 점유된 과제(창이 닫혀 끝난 실행의 잔여물)가 대상이다.
   * 되돌린 개수를 돌려준다.
   */
  async recoverLeases(jobId: string, diag: DiagRecorder): Promise<number> {
    const now = this.now();
    const stale = await cdb().tasks.where("[jobId+status]").equals([jobId, "inFlight"]).toArray();
    let n = 0;
    for (const t of stale) {
      const orphan = this.exclusive && t.leaseOwner !== this.runId;
      if (t.leaseUntil <= now || orphan) {
        // 조건을 다시 확인하면서 바꾼다(그 사이 다른 쪽이 끝냈으면 건드리지 않음)
        const changed = await cdb().tasks
          .where("id")
          .equals(t.id)
          .filter((x) => x.status === "inFlight" && x.leaseOwner === t.leaseOwner)
          .modify({ status: "pending", leaseUntil: 0, leaseOwner: null });
        if (changed) {
          n++;
          await diag.event(t.id, { stage: "resume", state: "ok", code: "leaseRecovered" });
        }
      }
    }
    return n;
  }

  /** 대기 과제를 점유한다. 이미 다른 쪽이 가져갔으면 false(중복 실행 방지) */
  private async claim(task: Task): Promise<boolean> {
    const changed = await cdb().tasks
      .where("id")
      .equals(task.id)
      .filter((x) => x.status === "pending")
      .modify({ status: "inFlight", leaseUntil: this.now() + LIMITS.leaseMs, leaseOwner: this.runId, attempts: task.attempts + 1 });
    return changed === 1;
  }

  /** 작업 실행. 다른 창에서 이미 돌고 있으면 "busy" */
  async run(jobId: string): Promise<"done" | "paused" | "busy" | "stopped" | "needsUser"> {
    this.stopRequested = false;
    this.runId = crypto.randomUUID();
    const r = await this.lock(`afterlog-collector-job-${jobId}`, () => this.runLocked(jobId));
    return r;
  }

  private async runLocked(jobId: string): Promise<"done" | "paused" | "stopped" | "needsUser"> {
    const job = await cdb().jobs.get(jobId);
    if (!job) return "stopped";
    await pruneDiagnostics(this.now());
    const diag = new DiagRecorder(jobId, job.options.diagnostics);
    await diag.init();
    this.diag = diag;
    this.assetTried = new Set();
    if (job.lastRunVersion && job.lastRunVersion !== COLLECTOR_VERSION) {
      // 업데이트 후 이어받기: 저장된 주소(안정 참조)에서 다시 시작한다
      await diag.event(null, { stage: "version", state: "ok", code: "versionChanged" });
    }
    await this.setJob(jobId, { status: "running", pauseReason: null, startedAt: job.startedAt ?? iso(this.now()), lastRunVersion: COLLECTOR_VERSION });
    await this.recoverLeases(jobId, diag);
    this.halt = null;
    try {
      // 탐색(목록·댓글 목록)과 글 저장을 따로 돌린다(선택 수집 명세 7.2): 목록을 다 훑기 전에도 찾은 글부터 저장한다.
      // 각 쪽은 자기 탭에서 한 번에 하나씩, 요청 간격은 둘이 함께 지킨다(gate)
      const [a, b] = await Promise.all([this.worker(jobId, diag, "discover"), this.worker(jobId, diag, "body")]);
      for (const r of [a, b]) if (r !== "idle") return r;
      const left = await cdb().tasks.where("[jobId+status]").anyOf([jobId, "pending"], [jobId, "inFlight"]).count();
      if (left) return "paused";
      if (this.assetJobs.size) {
        await this.setJob(jobId, { current: "이미지 받는 중" });
        await this.drainAssets();
      }
      await this.setJob(jobId, { status: "finished", finishedAt: iso(this.now()), current: null });
      return "done";
    } finally {
      await this.drainAssets();
      this.emit(jobId);
    }
  }

  /** 한쪽(탐색 또는 글 저장) 일꾼. 할 일이 더 없으면 "idle" */
  private async worker(jobId: string, diag: DiagRecorder, role: TabRole): Promise<"idle" | "paused" | "stopped" | "needsUser"> {
    const kinds: Task["kind"][] = role === "discover" ? ["list", "comments"] : ["post"];
    let sameErrorRun = 0;
    let lastError: string | null = null;
    for (;;) {
      if (this.halt) return this.halt;
      const cur = await cdb().jobs.get(jobId);
      if (!cur || cur.status !== "running") return cur?.status === "needsUser" ? "needsUser" : cur ? "paused" : "stopped";
      if (this.stopRequested) {
        await this.setJob(jobId, { status: "paused", pauseReason: "사용자가 일시정지했습니다.", current: null });
        this.halt = "paused";
        return "paused";
      }
      const task = await this.nextTask(jobId, kinds);
      if (!task) {
        // 완료 판정은 대기(pending)와 점유 중(inFlight)을 모두 본다(C01)
        const mine = await cdb().tasks.where("[jobId+status]").anyOf([jobId, "pending"], [jobId, "inFlight"]).filter((t) => kinds.includes(t.kind)).toArray();
        const waiting = mine.filter((t) => t.status === "pending");
        if (waiting.length) {
          // 재시도 대기 중인 과제가 있다
          await this.sleep(Math.max(MIN_DELAY_MS, 500));
          continue;
        }
        const held = mine.filter((t) => t.status === "inFlight");
        if (held.length) {
          if (await this.recoverLeases(jobId, diag)) continue;
          // 아직 유효한 점유: 끝나거나 만료될 때까지 기다렸다가 다시 본다
          const until = Math.min(...held.map((t) => t.leaseUntil));
          await this.sleep(Math.min(Math.max(until - this.now(), 250), 5000));
          continue;
        }
        // 글 저장 쪽은 탐색이 새 글을 더 찾을 수 있는 동안 기다린다(탐색 쪽은 글 확인 결과로 댓글 목록을 다시 열 수 있음)
        const other = await cdb().tasks.where("[jobId+status]").anyOf([jobId, "pending"], [jobId, "inFlight"]).filter((t) => !kinds.includes(t.kind)).count();
        if (other) {
          await this.sleep(500);
          continue;
        }
        return "idle";
      }
      if (!(await this.claim(task))) continue;
      await this.setJob(jobId, { current: task.url });
      let outcome: { ok: true } | { ok: false; code: string; text: string; retry: boolean; stopJob?: "needsUser" | "paused"; interrupted?: boolean };
      try {
        outcome = task.kind === "list" ? await this.runList(cur, task, diag) : task.kind === "comments" ? await this.runComments(cur, task, diag) : await this.runPost(cur, task, diag);
      } catch (e) {
        const code = e instanceof BrowserError ? e.code : "other";
        outcome = { ok: false, code, text: (e as Error).message || "알 수 없는 오류", retry: code !== "loginRequired", stopJob: code === "loginRequired" ? "needsUser" : undefined };
      }
      if (!outcome.ok && outcome.interrupted) {
        // 일시정지로 중간에 멈춤: 실패로 세지 않고 대기열로(이어받으면 저장된 관측부터 계속)
        await cdb().tasks.update(task.id, { status: "pending", leaseUntil: 0, leaseOwner: null, attempts: task.attempts });
        continue;
      }
      if (outcome.ok) {
        sameErrorRun = 0;
        lastError = null;
      } else {
        const attempts = task.attempts + 1;
        const canRetry = outcome.retry && attempts <= LIMITS.maxRetries;
        const backoff = MIN_DELAY_MS * 2 ** attempts;
        await cdb().tasks.update(task.id, {
          status: outcome.stopJob ? "pending" : canRetry ? "pending" : "failed",
          leaseUntil: 0,
          leaseOwner: null,
          notBefore: canRetry ? this.now() + backoff : 0,
          errorCode: outcome.code,
          errorText: outcome.text,
          ...(outcome.stopJob ? { attempts: task.attempts } : {}),
        });
        if (outcome.stopJob) {
          await this.setJob(jobId, { status: outcome.stopJob, pauseReason: outcome.text, current: null });
          this.halt = outcome.stopJob === "needsUser" ? "needsUser" : "paused";
          return this.halt;
        }
        // 재시도는 세지 않고, 서로 다른 글이 같은 이유로 최종 실패할 때만 센다
        if (!canRetry) {
          sameErrorRun = lastError === outcome.code ? sameErrorRun + 1 : 1;
          lastError = outcome.code;
        }
        if (!canRetry && sameErrorRun >= LIMITS.sameErrorPause) {
          await this.setJob(jobId, {
            status: "paused",
            pauseReason: `같은 오류가 ${sameErrorRun}번 연속으로 나서 멈췄습니다: ${outcome.text}`,
            current: null,
          });
          this.halt = "paused";
          return "paused";
        }
      }
      await this.setJob(jobId, { lastCheckpointAt: iso(this.now()) });
    }
  }

  /**
   * 요청 간격(명세 8.3: 1.5~3초). 탐색 탭과 글 탭이 함께 지킨다. 페이지 이동·스크롤 회차·항목 누르기 전에 부른다.
   * 앞 요청이 끝난 뒤가 아니라 앞 요청을 시작한 때부터 잰다(준비를 기다린 시간만큼 또 기다리지 않음, 7.3)
   */
  private gate(): Promise<void> {
    const run = async () => {
      const wait = this.lastRequestAt + paceDelay(this.random()) - this.now();
      if (this.lastRequestAt && wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
    };
    const p = this.gateChain.then(run, run);
    this.gateChain = p.catch(() => undefined);
    return p;
  }

  private queueAssets(urls: string[], taskId: string | null, diag?: DiagRecorder) {
    const d = diag ?? this.diag;
    if (!d) return;
    const p: Promise<void> = this.fetchAssets(urls, taskId, d)
      .catch(() => undefined)
      .finally(() => this.assetJobs.delete(p));
    this.assetJobs.add(p);
  }

  private async drainAssets() {
    while (this.assetJobs.size) await Promise.allSettled([...this.assetJobs]);
  }

  private async nextTask(jobId: string, kinds: Task["kind"][]): Promise<Task | null> {
    const now = this.now();
    const pending = await cdb().tasks.where("[jobId+status]").equals([jobId, "pending"]).toArray();
    // 교집합(AND): 모든 조건의 후보를 다 찾은 뒤에 글을 연다(한 조건에만 걸린 글은 열지 않게, 7.1)
    if (kinds.includes("post") && (await cdb().jobs.get(jobId))?.options.selection?.combine === "and") {
      const discovering = await cdb().tasks.where("[jobId+status]").anyOf([jobId, "pending"], [jobId, "inFlight"]).filter((t) => t.kind !== "post").count();
      if (discovering) return null;
    }
    const ready = pending.filter((t) => kinds.includes(t.kind) && t.notBefore <= now).sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === "list" ? -1 : 1));
    return ready[0] ?? null;
  }

  // ---------- 목록에서 글 찾기 ----------

  private async runList(job: Job, task: Task, diag: DiagRecorder): Promise<{ ok: true } | { ok: false; code: string; text: string; retry: boolean; stopJob?: "needsUser" }> {
    const b = parseBandUrl(task.url);
    if (!b) return { ok: false, code: "navigationFailed", text: "밴드 주소가 아닙니다.", retry: false };
    await this.gate();
    await this.deps.browser.openList(task.url);
    const reason: SelectReason = task.listReason ?? "list";
    let emptyRounds = 0;
    let rounds = 0;
    let total = 0;
    let end: "noProgress" | "maxRounds" | "error" = "noProgress";
    let broken: string | null = null;
    let order = (await cdb().tasks.where("jobId").equals(job.id).count()) + 1;
    for (;;) {
      if (this.stopRequested) break;
      rounds++;
      if (rounds > 1) await this.gate();
      let r: Awaited<ReturnType<CollectorBrowser["discoverRound"]>>;
      try {
        r = await this.deps.browser.discoverRound(b.bandNo);
      } catch (e) {
        // 목록 읽기가 중간에 끊겨도 이미 찾은 글은 수집으로 넘긴다(목록을 처음부터 다시 돌지 않음)
        if (total > 0 && !(e instanceof BrowserError && e.code === "loginRequired")) {
          broken = (e as Error).message || "목록 읽기가 끊겼습니다.";
          end = "error";
          break;
        }
        throw e;
      }
      if (r.loginRequired) return { ok: false, code: "loginRequired", text: "밴드에 로그인해야 합니다. 로그인한 뒤 이어받기를 누르세요.", retry: false, stopJob: "needsUser" };
      if (task.memberKey && r.memberName) await this.learnMemberName(job.id, task.memberKey, r.memberName);
      let added = 0;
      // 발견 즉시 저장(가상화 목록에서 사라져도 남도록, T02)
      await cdb().transaction("rw", [cdb().tasks, cdb().captures], async () => {
        for (const link of r.links) {
          const p = parseBandUrl(link);
          if (p?.kind !== "post") continue;
          const key = postKey(p.bandNo, p.postNo);
          const exists = await cdb().tasks.where("[jobId+key]").equals([job.id, key]).first();
          if (exists) {
            // 같은 글이 다른 조건으로도 찾아지면 사유만 더한다(원글은 한 번만 연다, 8절)
            await addReason(exists, reason, job);
            continue;
          }
          const before = job.options.skipCaptured ? await findCapture(key, job.id, true) : undefined;
          const id = crypto.randomUUID();
          await cdb().tasks.add({
            id,
            jobId: job.id,
            key,
            kind: "post",
            url: p.canonical,
            reasons: [reason],
            order: order++,
            status: "pending",
            attempts: 0,
            errorCode: null,
            errorText: null,
            leaseUntil: 0,
            notBefore: 0,
            ...(before ? await reuseCapture(before, job.id, id, key, [reason], job.options.selection) : {}),
          });
          added++;
        }
      });
      total += added;
      await diag.event(task.id, { stage: "listRound", state: "ok", progress: added > 0, count: countBucket(added), waiting: r.loading });
      await cdb().tasks.update(task.id, { result: { coverage: "unknown", found: total, evidence: `${rounds}회 스크롤` }, leaseUntil: this.now() + LIMITS.leaseMs });
      this.emit(job.id);
      // 끝 판단: 새 글이 연속으로 없으면 끝. 로딩 표시가 보이면 조금 더 기다리되, 계속 보여도 상한을 넘기면 끝으로 본다
      if (added === 0) emptyRounds++;
      else emptyRounds = 0;
      if (emptyRounds >= (r.loading ? LIMITS.emptyRoundsWhileLoading : LIMITS.emptyRoundsToStop)) break;
      if (rounds >= LIMITS.maxListRounds) {
        end = "maxRounds";
        break;
      }
    }
    // 명시적인 끝 표시를 확인한 적이 없으므로 '끝 확인 불가'로 남긴다(8.2)
    const coverage = end === "noProgress" ? "unknown" : "partial";
    const evidence =
      end === "maxRounds"
        ? `스크롤 ${rounds}회 상한에서 멈춤`
        : end === "error"
          ? `스크롤 ${rounds}회 뒤 목록 읽기가 끊겨 찾은 ${total}개부터 수집(${broken}). 목록을 다시 수집하면 빠진 글을 더 찾을 수 있습니다`
          : `스크롤 ${rounds}회, 마지막 ${emptyRounds}회 동안 새 글 없음(명시적인 끝 표시는 확인하지 못함)`;
    await diag.event(task.id, { stage: "listEnd", state: coverage === "partial" ? "partial" : "unknown", end, count: countBucket(total), ...(end === "error" ? { code: "frameGone" as const } : {}) });
    await cdb().tasks.update(task.id, { status: "succeeded", leaseUntil: 0, result: { coverage, found: total, evidence } });
    return { ok: true };
  }

  // ---------- 멤버 댓글 목록(B·C) ----------

  /**
   * 1) 목록을 끝까지 훑으며 댓글을 관측·저장한다(B: 이것이 결과, C: 원글을 찾는 단서).
   * 2) C이면 기간 안의 댓글마다 원글을 찾아 글 과제를 만든다. 같은 발췌의 원글을 이미 찾았으면 누르지 않고
   *    그 원글에서 같은 댓글이 있는지 대조한다(같은 글을 여러 번 열지 않음, F02). 대조 실패면 그 댓글만 눌러 확인한다.
   */
  private async runComments(job: Job, task: Task, diag: DiagRecorder): Promise<{ ok: true } | { ok: false; code: string; text: string; retry: boolean; stopJob?: "needsUser"; interrupted?: boolean }> {
    const b = parseBandUrl(task.url);
    const br = this.deps.browser;
    const sel = job.options.selection;
    if (!b || b.kind !== "member-list" || !br.readMemberComments || !sel) return { ok: false, code: "navigationFailed", text: "멤버 댓글 목록 주소가 아닙니다.", retry: false };
    // 원글 연결: 댓글 단 글(C), 또는 교집합에서 '조건을 만족한 원글의 댓글'만 남기려면 댓글만(B)에도 필요(4.3)
    const wantLinks = sel.commentedPosts || (sel.combine === "and" && sel.commentsOnly);
    await this.gate();
    await br.openList(task.url);
    let memberName = task.result?.memberName ?? null;
    const stored = await cdb().comments.where("[taskId+seq]").between([task.id, 0], [task.id, Infinity]).count();
    let seen = 0;
    let emptyRounds = 0;
    let rounds = 0;
    let end: "noProgress" | "maxRounds" = "noProgress";
    let listMissing = 0;
    // 1) 관측
    for (;;) {
      if (this.stopRequested || this.halt) return INTERRUPTED;
      rounds++;
      if (rounds > 1) await this.gate();
      const r = await br.readMemberComments({ from: seen, scroll: rounds > 1 });
      if (r.loginRequired) return { ok: false, code: "loginRequired", text: "밴드에 로그인해야 합니다. 로그인한 뒤 이어받기를 누르세요.", retry: false, stopJob: "needsUser" };
      if (!r.listFound) {
        if (++listMissing >= 3) {
          await diag.event(task.id, { stage: "scope", state: "fail", code: "selectorMissing" });
          return { ok: false, code: "selectorMissing", text: "멤버 댓글 목록을 찾지 못했습니다(권한·화면 구조 변경 가능).", retry: true };
        }
        continue;
      }
      if (!memberName && r.memberName) {
        memberName = r.memberName;
        await this.learnMemberName(job.id, b.memberKey, memberName);
      }
      const fresh = r.items.filter((it) => it.seq >= stored);
      if (fresh.length) {
        await cdb().transaction("rw", cdb().comments, async () => {
          for (const it of fresh) {
            if (await cdb().comments.where("[taskId+seq]").equals([task.id, it.seq]).first()) continue;
            const local = it.dateText ? parseKoreanDateTime(it.dateText).local : null;
            const inRange = periodContains(local, sel.periodFrom, sel.periodTo);
            const ob: CommentObservation = {
              id: crypto.randomUUID(),
              jobId: job.id,
              taskId: task.id,
              bandNo: b.bandNo,
              memberKey: b.memberKey,
              memberName,
              seq: it.seq,
              html: it.html,
              text: it.text,
              excerpt: it.excerpt,
              dateText: it.dateText,
              local,
              inRange,
              link: wantLinks && inRange !== false ? "pending" : "notNeeded",
              postKey: null,
              postUrl: null,
              content: "listText",
            };
            await cdb().comments.add(ob);
          }
        });
      }
      const added = r.total - seen;
      seen = Math.max(seen, r.total);
      await diag.event(task.id, { stage: "listRound", state: "ok", progress: added > 0, count: countBucket(Math.max(0, added)), waiting: r.loading });
      await cdb().tasks.update(task.id, { leaseUntil: this.now() + LIMITS.leaseMs, result: { ...task.result, memberName, comments: seen, coverage: "unknown", evidence: `${rounds}회 스크롤` } });
      this.emit(job.id);
      if (added <= 0) emptyRounds++;
      else emptyRounds = 0;
      if (emptyRounds >= (r.loading ? LIMITS.emptyRoundsWhileLoading : LIMITS.emptyRoundsToStop)) break;
      if (rounds >= LIMITS.maxListRounds) {
        end = "maxRounds";
        break;
      }
    }
    // 2) 원글 찾기(C)
    let linked = 0;
    if (wantLinks) {
      const obs = (await cdb().comments.where("[taskId+seq]").between([task.id, 0], [task.id, Infinity]).toArray()).filter((o) => o.link === "pending");
      let needReopen = false;
      for (const ob of obs) {
        if (this.stopRequested || this.halt) return INTERRUPTED;
        await cdb().tasks.update(task.id, { leaseUntil: this.now() + LIMITS.leaseMs });
        // 같은 발췌의 원글을 이미 찾았다면 그 글로 추정하고, 저장본이 있으면 바로 대조한다
        const sibling = ob.excerpt
          ? await cdb().comments.where("[taskId+seq]").between([task.id, 0], [task.id, Infinity]).filter((o) => o.id !== ob.id && o.excerpt === ob.excerpt && !!o.postKey && (o.link === "linked" || o.link === "guessed")).first()
          : undefined;
        if (sibling?.postKey && !ob.linkError) {
          const cap = await findCapture(sibling.postKey);
          if (!cap) {
            await cdb().comments.update(ob.id, { link: "guessed", postKey: sibling.postKey, postUrl: sibling.postUrl });
            continue;
          }
          if (commentInCapture({ ...ob, memberName: ob.memberName ?? memberName }, cap)) {
            await cdb().comments.update(ob.id, { link: "linked", postKey: sibling.postKey, postUrl: sibling.postUrl, content: "verified" });
            linked++;
            continue;
          }
        }
        // 항목을 눌러 원글 번호를 읽는다. 레이어를 못 닫았으면 목록을 다시 연다
        if (needReopen) {
          await this.gate();
          await br.openList(task.url);
          needReopen = false;
        }
        let loaded = (await br.readMemberComments({ from: ob.seq, scroll: false })).total;
        for (let i = 0; loaded <= ob.seq && i < LIMITS.maxListRounds; i++) {
          await this.gate();
          loaded = (await br.readMemberComments({ from: ob.seq, scroll: true })).total;
        }
        await this.gate();
        const res = await br.openCommentPost!({ seq: ob.seq, expectText: ob.text, expectDate: ob.dateText, bandNo: b.bandNo });
        if (!res.closed) needReopen = true;
        if (!res.ok || !res.postNo) {
          const why = res.reason === "moved" ? "목록이 바뀌어 같은 댓글을 찾지 못함" : res.reason === "noLayer" ? "눌러도 원글이 열리지 않음(삭제·권한 가능)" : "원글 번호를 찾지 못함";
          await cdb().comments.update(ob.id, { link: "failed", linkError: why });
          continue;
        }
        const key = postKey(b.bandNo, res.postNo);
        const url = `${b.origin.replace("://www.", "://")}/band/${b.bandNo}/post/${res.postNo}`;
        await cdb().comments.update(ob.id, { link: "linked", postKey: key, postUrl: url, linkError: undefined });
        linked++;
        await this.ensurePostTask(job, key, url, "commented");
        // 이미 저장된 원글이면(이전 작업 포함) 바로 대조
        const cap = await findCapture(key);
        if (cap && commentInCapture({ ...ob, memberName: ob.memberName ?? memberName }, cap)) await cdb().comments.update(ob.id, { content: "verified" });
        this.emit(job.id);
      }
      // 추정만 한 댓글의 원글 과제도 만든다(같은 발췌의 원글)
      const guessed = (await cdb().comments.where("[taskId+seq]").between([task.id, 0], [task.id, Infinity]).toArray()).filter((o) => o.link === "guessed" && o.postKey);
      for (const g of guessed) await this.ensurePostTask(job, g.postKey!, g.postUrl!, "commented");
    }
    const all = await cdb().comments.where("[taskId+seq]").between([task.id, 0], [task.id, Infinity]).toArray();
    const coverage = end === "noProgress" ? "unknown" : "partial";
    await diag.event(task.id, { stage: "listEnd", state: coverage === "partial" ? "partial" : "unknown", end, count: countBucket(all.length) });
    await cdb().tasks.update(task.id, {
      status: "succeeded",
      leaseUntil: 0,
      result: {
        memberName,
        comments: all.length,
        linked: all.filter((o) => o.link === "linked").length,
        found: new Set(all.map((o) => o.postKey).filter(Boolean)).size,
        coverage,
        evidence:
          end === "maxRounds" ? `스크롤 ${rounds}회 상한에서 멈춤` : `스크롤 ${rounds}회, 마지막 ${emptyRounds}회 동안 새 댓글 없음(명시적인 끝 표시는 확인하지 못함)`,
      },
    });
    void linked;
    return { ok: true };
  }

  /** 인물 이름을 알게 되면 작업 이름·선택 요약에 반영(표시용. 인물 구분은 멤버 식별자) */
  private async learnMemberName(jobId: string, memberKey: string, name: string) {
    const cur = await cdb().jobs.get(jobId);
    const sel = cur?.options.selection;
    if (!cur || !sel || !sel.members.some((m) => m.memberKey === memberKey && !m.name)) return;
    const selection = { ...sel, members: sel.members.map((m) => (m.memberKey === memberKey && !m.name ? { ...m, name } : m)) };
    await this.setJob(jobId, { options: { ...cur.options, selection }, label: describeSelection(selection) });
  }

  /** 글 과제가 없으면 만들고, 있으면 사유를 더한다 */
  private async ensurePostTask(job: Job, key: string, url: string, reason: SelectReason) {
    let revived: Capture | null = null;
    let reused: Capture | undefined;
    await cdb().transaction("rw", [cdb().tasks, cdb().captures], async () => {
      const exists = await cdb().tasks.where("[jobId+key]").equals([job.id, key]).first();
      if (exists) {
        revived = await addReason(exists, reason, job);
        return;
      }
      const order = (await cdb().tasks.where("jobId").equals(job.id).count()) + 1;
      const before = job.options.skipCaptured ? await findCapture(key, job.id, true) : undefined;
      const id = crypto.randomUUID();
      await cdb().tasks.add({
        id,
        jobId: job.id,
        key,
        kind: "post",
        url,
        reasons: [reason],
        order,
        status: "pending",
        attempts: 0,
        errorCode: null,
        errorText: null,
        leaseUntil: 0,
        notBefore: 0,
        ...(before ? await reuseCapture(before, job.id, id, key, [reason], job.options.selection) : {}),
      });
      if (before) reused = before;
    });
    if (reused) await this.verifyLinkedComments(job, key, reused);
    const r = revived as Capture | null;
    if (r && job.options.includeImages) this.queueAssets(r.imageUrls, r.taskId);
  }

  /** 원글을 저장한 뒤, 이 글로 연결(추정 포함)된 댓글 관측을 대조한다. 추정이 틀렸으면 그 댓글만 다시 찾게 한다 */
  private async verifyLinkedComments(job: Job, key: string, capture: Capture) {
    const obs = await cdb().comments.where("jobId").equals(job.id).filter((o) => o.postKey === key && (o.link === "guessed" || (o.link === "linked" && o.content !== "verified"))).toArray();
    const reopen = new Set<string>();
    for (const ob of obs) {
      if (commentInCapture(ob, capture)) await cdb().comments.update(ob.id, { link: "linked", content: "verified" });
      else if (ob.link === "guessed") {
        await cdb().comments.update(ob.id, { link: "pending", postKey: null, postUrl: null });
        reopen.add(ob.taskId);
      }
    }
    for (const id of reopen) await cdb().tasks.where("id").equals(id).filter((t) => t.status === "succeeded").modify({ status: "pending", attempts: 0, notBefore: 0 });
  }

  // ---------- 글 하나 ----------

  private async runPost(job: Job, task: Task, diag: DiagRecorder): Promise<{ ok: true } | { ok: false; code: string; text: string; retry: boolean; stopJob?: "needsUser" }> {
    const sel0 = job.options.selection;
    if (sel0?.combine === "and") {
      const need: SelectReason[] = [sel0.authored ? "authored" : null, sel0.commentedPosts ? "commented" : null, sel0.search ? "search" : null].filter((x): x is SelectReason => !!x);
      const have = (await cdb().tasks.get(task.id))?.reasons ?? task.reasons ?? [];
      if (!need.every((r) => have.includes(r))) {
        await cdb().tasks.update(task.id, { status: "skipped", leaseUntil: 0, errorCode: "notAll", errorText: "모든 조건(교집합)의 후보에 들지 않아 열지 않았습니다." });
        return { ok: true };
      }
    }
    const target = task.tabId !== undefined ? { tabId: task.tabId } : { url: task.url };
    if (task.tabId === undefined) await this.gate();
    const { ex, loadMs } = await this.deps.browser.extractPost(target);
    await diag.event(task.id, { stage: "pageLoad", state: ex.ok ? "ok" : "fail", wait: durationBucket(loadMs), page: ex.reason === "login" ? "login" : ex.ok ? "postDetail" : "unknown", attempt: task.attempts + 1 });
    const probes: Partial<Record<ProbeId, CountBucket>> = {};
    for (const [k, v] of Object.entries(ex.probeCounts ?? {})) probes[k as ProbeId] = countBucket(v);
    if (Object.keys(probes).length) await diag.event(task.id, { stage: "probes", state: ex.ok ? "ok" : "fail", probes });

    if (!ex.ok) {
      if (ex.reason === "login") return { ok: false, code: "loginRequired", text: "밴드에 로그인해야 합니다. 로그인한 뒤 이어받기를 누르세요.", retry: false, stopJob: "needsUser" };
      if (job.options.diagnostics) await diag.structure(await this.deps.browser.sampleStructure(target).catch(() => null));
      if (ex.reason === "multiple") {
        await diag.event(task.id, { stage: "scope", state: "fail", code: "multipleScopes" });
        return { ok: false, code: "multipleScopes", text: ex.message ?? "게시글이 여러 개 보입니다.", retry: false };
      }
      if (ex.reason === "timeout") {
        await diag.event(task.id, { stage: "scope", state: "partial", code: "loadTimeout" });
        return { ok: false, code: "loadTimeout", text: ex.message ?? "게시글이 제한 시간 안에 준비되지 않았습니다.", retry: true };
      }
      await diag.event(task.id, { stage: "scope", state: "fail", code: "selectorMissing" });
      return { ok: false, code: "selectorMissing", text: ex.message ?? "게시글을 찾지 못했습니다.", retry: true };
    }

    // 계정 확인(약한 근거: 내 프로필 사진 파일명). 바뀌면 섞지 않고 멈춘다(T07)
    if (ex.accountMarker) {
      if (!job.accountMarker) await cdb().jobs.update(job.id, { accountMarker: ex.accountMarker });
      else if (job.accountMarker !== ex.accountMarker) {
        await diag.event(task.id, { stage: "scope", state: "fail", code: "accountChanged" });
        return {
          ok: false,
          code: "accountChanged",
          text: "처음과 다른 계정으로 보입니다. 같은 계정으로 로그인했는지 확인한 뒤 이어받기를 누르세요.",
          retry: false,
          stopJob: "needsUser",
        };
      }
    }

    const parsed = parseBandHtml(ex.html ?? "");
    const doc: ParsedDocument | undefined = parsed.documents.find((d) => d.format === "band-post");
    if (!doc) {
      await diag.event(task.id, { stage: "fields", state: "fail", code: "parseFailed" });
      return { ok: false, code: "parseFailed", text: "게시글 구조를 해석하지 못했습니다.", retry: true };
    }
    const post = doc.entries[0];
    const comments = doc.entries.filter((e) => e.kind === "comment");
    const present = (b: boolean) => (b ? "present" : "missing") as "present" | "missing";
    await diag.event(task.id, {
      stage: "fields",
      state: "ok",
      fields: {
        author: present(!!post.authorKey),
        authorDesc: present(!!doc.identities[0]?.description),
        avatar: present(doc.identities.every((i) => i.avatarRef || i.avatarUrl)),
        body: present(post.blocks.length > 0),
        time: present(!!post.time),
        timeDetail: present(!!post.time?.local),
        readCount: present(post.meta.readCount !== undefined),
        commentCount: present(post.meta.commentCount !== undefined),
        commentItem: comments.length ? "present" : ex.commentsShown ? "missing" : "present",
        commentAuthor: present(comments.every((c) => !!c.authorKey)),
        commentBody: present(comments.every((c) => c.blocks.length > 0)),
        commentTime: present(comments.every((c) => !!c.time?.local)),
        replyList: present(comments.some((c) => c.parentTempId !== post.tempId)),
        mention: present(comments.some((c) => c.blocks.some((b) => b.type === "mention"))),
        emotionRegion: present((ex.probeCounts?.emotionRegion ?? 0) > 0),
        attachment: present(post.blocks.some((b) => b.type === "image")),
      },
    });
    const orphan = comments.some((c) => c.parentTempId && !doc.entries.some((e) => e.tempId === c.parentTempId));
    await diag.event(task.id, { stage: "relations", state: orphan ? "fail" : "ok", ...(orphan ? { code: "parentLinkUnknown" as const } : {}) });
    // 미분류로 보존한 댓글 영역도 화면의 댓글 하나로 센다
    const foundComments = doc.entries.filter((e) => e.kind !== "post").length;
    const countOk = ex.commentsShown === null ? null : ex.commentsShown === foundComments;
    if (ex.commentsShown !== null && (ex.expandClicks || ex.commentsShown > foundComments))
      await diag.event(task.id, {
        stage: "expand",
        state: ex.commentsShown <= foundComments ? "ok" : "partial",
        count: countBucket(ex.expandClicks ?? 0),
        candidates: countBucket(ex.expandCandidates ?? 0),
        remaining: countBucket(Math.max(0, ex.commentsShown - foundComments)),
      });
    await diag.event(task.id, {
      stage: "countCheck",
      state: countOk === null ? "unknown" : countOk ? "ok" : "partial",
      ...(countOk === false ? { code: "countMismatch" as const } : {}),
      count: countBucket(foundComments),
    });
    await diag.event(task.id, { stage: "reactions", state: post.reactions?.status === "value" ? "ok" : "unknown" });

    // 기간 조건(작성 시각 기준)
    // 기간: 선택 수집에서는 '인물이 쓴 글'만 글 작성일로 본다. '댓글 단 글'은 댓글 날짜로 이미 골랐다(5절)
    const sel = job.options.selection;
    const inRange = sel ? true : periodContains(post.time?.local ?? null, job.options.periodFrom, job.options.periodTo);
    const canonical = ex.postHref ? parseBandUrl(ex.postHref) : parseBandUrl(task.url);
    const key = canonical?.kind === "post" ? postKey(canonical.bandNo, canonical.postNo) : task.key;
    if (inRange === false && !sel) {
      await diag.event(task.id, { stage: "storage", state: "skipped", code: "outOfRange" });
      await cdb().tasks.update(task.id, { status: "skipped", leaseUntil: 0, key, result: { title: doc.title, outOfRange: true } });
      return { ok: true };
    }
    // 선택 수집: 조건 판정(judgePost)에서 빠져도 저장본은 남겨 두고 결과에서만 뺀다(나중에 다른 조건으로 대상이 되면 다시 열지 않음)
    const commentsComplete = ex.commentsShown === null || ex.commentsShown <= foundComments;
    let verdict: PostVerdict | null = null;

    const capture: Capture = {
      id: crypto.randomUUID(),
      jobId: job.id,
      taskId: task.id,
      key,
      url: canonical?.canonical ?? task.url,
      bandNo: canonical?.kind === "post" ? canonical.bandNo : job.bandNo ?? "",
      postNo: canonical?.kind === "post" ? canonical.postNo : "",
      bandName: ex.bandName,
      html: ex.html!,
      imageUrls: ex.imageUrls,
      capturedAt: iso(this.now()),
      commentsShown: ex.commentsShown,
      commentsFound: foundComments,
      collectorVersion: COLLECTOR_VERSION,
      reasons: task.reasons,
    };
    const partial = countOk === false;
    try {
      await cdb().transaction("rw", [cdb().captures, cdb().tasks, cdb().jobs], async () => {
        // 같은 작업 안의 같은 글은 최신 관측 하나로(재시도·재개 시 중복 생성 방지)
        await cdb().captures.where("[jobId+key]").equals([job.id, key]).delete();
        // 사유는 저장 시점의 과제에서 다시 읽는다(열어 보는 사이 다른 조건이 더해졌을 수 있음)
        const nowTask = await cdb().tasks.get(task.id);
        capture.reasons = nowTask?.reasons ?? task.reasons;
        if (sel) {
          verdict = judgePost(doc, capture.reasons ?? [], sel, commentsComplete);
          if (!verdict.include) capture.excluded = verdict.excluded;
        }
        await cdb().captures.add(capture);
        const judged = verdict ? { confirmed: verdict.confirmed, matches: verdict.matches?.map(({ where, index, terms }) => ({ where, index, terms })) } : {};
        if (capture.excluded) {
          await cdb().tasks.update(task.id, {
            status: "skipped",
            leaseUntil: 0,
            key,
            url: capture.url,
            errorCode: capture.excluded,
            errorText: EXCLUDED_TEXT[capture.excluded],
            result: { title: doc.title, outOfRange: capture.excluded === "outOfRange", commentsShown: ex.commentsShown, commentsFound: foundComments, ...judged },
          });
          return;
        }
        await cdb().tasks.update(task.id, {
          status: partial ? "partial" : "succeeded",
          key,
          url: capture.url,
          leaseUntil: 0,
          errorCode: partial ? "countMismatch" : null,
          errorText: partial
            ? `표시된 댓글 ${ex.commentsShown}개 중 ${foundComments}개만 확보했습니다(${expandNote(ex.expandClicks ?? 0, ex.expandStop)}).`
            : null,
          result: { title: doc.title, commentsShown: ex.commentsShown, commentsFound: foundComments, ...judged },
        });
        if (!job.bandName && ex.bandName) await cdb().jobs.update(job.id, { bandName: ex.bandName, bandNo: capture.bandNo || job.bandNo });
      });
      await diag.event(task.id, { stage: "storage", state: "ok" });
      await this.verifyLinkedComments(job, key, capture);
    } catch {
      await diag.event(task.id, { stage: "storage", state: "fail", code: "storageFailed" });
      return { ok: false, code: "storageFailed", text: "브라우저 저장 공간에 쓰지 못했습니다(용량 부족 가능). '지금까지 저장'으로 먼저 파일을 받아 주세요.", retry: false };
    }

    if (job.options.includeImages && !capture.excluded) {
      // 이미지는 다음 글을 여는 동안 뒤에서 받는다(본문 저장을 막지 않음, 7.1). 너무 쌓이면 잠깐 기다린다
      while (this.assetJobs.size >= 3) await Promise.race([...this.assetJobs]);
      this.queueAssets(ex.imageUrls, task.id, diag);
    }
    return { ok: true };
  }

  /** 첨부·프로필 이미지 확보. 실패해도 본문과 자리는 남는다(11.1) */
  async fetchAssets(urls: string[], taskId: string | null, diag: DiagRecorder) {
    const queue = [...urls];
    const worker = async () => {
      for (let url = queue.shift(); url; url = queue.shift()) {
        // 같은 주소는 진행 중인 요청과도 합쳐 한 번만 받는다(F13)
        const running = ASSET_IN_FLIGHT.get(url);
        if (running) {
          await running;
          continue;
        }
        if (this.assetTried.has(url)) continue;
        this.assetTried.add(url);
        let done!: () => void;
        ASSET_IN_FLIGHT.set(url, new Promise<void>((r) => (done = r)));
        try {
          await this.fetchOne(url, taskId, diag);
        } finally {
          ASSET_IN_FLIGHT.delete(url);
          done();
        }
      }
    };
    await Promise.all(Array.from({ length: LIMITS.assetConcurrency }, worker));
  }

  private async fetchOne(url: string, taskId: string | null, diag: DiagRecorder) {
    {
      {
        const existing = await cdb().assets.get(url);
        if (existing?.status === "stored") return;
        const attempts = (existing?.attempts ?? 0) + 1;
        const r = await this.deps.browser.fetchAsset(url);
        if (r.ok && r.blob) {
          const buf = new Uint8Array(await r.blob.arrayBuffer());
          const digest = await crypto.subtle.digest("SHA-256", buf);
          const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
          await cdb().assets.put({
            url,
            status: "stored",
            quality: imageQuality(url),
            mime: r.mime ?? r.blob.type,
            size: r.blob.size,
            sha256: sha,
            blob: r.blob,
            errorCode: null,
            attempts,
            fetchedAt: iso(this.now()),
          });
          await diag.event(taskId, { stage: "asset", state: "ok", media: r.mime === "image/gif" ? "gif" : "image", size: sizeBucket(r.blob.size) });
        } else {
          await cdb().assets.put({ url, status: "failed", quality: imageQuality(url), mime: null, size: 0, sha256: null, blob: null, errorCode: r.code ?? "assetNetwork", attempts, fetchedAt: iso(this.now()) });
          await diag.event(taskId, { stage: "asset", state: "fail", code: r.code ?? "assetNetwork", media: "unknown" });
        }
      }
    }
  }

  /** 실패한 첨부만 다시 */
  async retryFailedAssets(jobId: string) {
    const caps = await cdb().captures.where("jobId").equals(jobId).toArray();
    const urls = new Set(caps.flatMap((c) => c.imageUrls));
    const failed = (await cdb().assets.where("status").equals("failed").toArray()).filter((a) => urls.has(a.url)).map((a) => a.url);
    const job = await cdb().jobs.get(jobId);
    await this.fetchAssets(failed, null, new DiagRecorder(jobId, !!job?.options.diagnostics));
    this.emit(jobId);
    return failed.length;
  }
}

// ---------- 작업 만들기 ----------

export const DEFAULT_OPTIONS: Job["options"] = {
  periodFrom: null,
  periodTo: null,
  includeImages: true,
  skipCaptured: true,
  maxPartMB: 100,
  diagnostics: true,
};

export async function createJob(input: {
  scope: Job["scope"];
  label: string;
  options: Job["options"];
  bandNo: string | null;
  posts?: { url: string; key: string; tabId?: number }[];
  lists?: string[];
  now?: number;
}): Promise<Job> {
  // 선택 수집: 인물마다 작성글 목록(A)·작성댓글 목록(B·C) 과제를 만든다. 밴드 전체 목록은 먼저 훑지 않는다(7.1)
  const sel = input.options.selection;
  const selLists: { url: string; kind: "list" | "comments"; reason: SelectReason; memberKey: string }[] = [];
  if (sel) {
    for (const m of sel.members) {
      const base = `${m.origin ?? "https://band.us"}/band/${m.bandNo}/member/${m.memberKey}`;
      if (sel.authored) selLists.push({ url: `${base}/post`, kind: "list", reason: "authored", memberKey: m.memberKey });
      if (sel.commentsOnly || sel.commentedPosts) selLists.push({ url: `${base}/comment`, kind: "comments", reason: "commented", memberKey: m.memberKey });
    }
    // 검색 결과: 사용자가 연 주소를 그대로(검색어·조건을 일반 주소 정리로 잃지 않게, 4.2)
    if (sel.search) for (const url of sel.search.urls?.length ? sel.search.urls : [sel.search.url]) selLists.push({ url, kind: "list", reason: "search", memberKey: "" });
  }
  const now = input.now ?? Date.now();
  const job: Job = {
    id: crypto.randomUUID(),
    createdAt: iso(now),
    label: input.label,
    scope: input.scope,
    status: "queued",
    pauseReason: null,
    options: input.options,
    bandNo: input.bandNo,
    bandName: null,
    accountMarker: null,
    createdVersion: COLLECTOR_VERSION,
    lastRunVersion: null,
    startedAt: null,
    finishedAt: null,
    lastCheckpointAt: null,
    current: null,
  };
  let order = 0;
  const tasks: Task[] = [];
  const base = { jobId: job.id, status: "pending" as const, attempts: 0, errorCode: null, errorText: null, leaseUntil: 0, notBefore: 0 };
  for (const l of input.lists ?? []) tasks.push({ ...base, id: crypto.randomUUID(), key: `list:${l}`, kind: "list", url: l, listReason: "list", order: order++ });
  for (const l of selLists)
    tasks.push({ ...base, id: crypto.randomUUID(), key: `${l.kind}:${l.url}`, kind: l.kind, url: l.url, listReason: l.reason, memberKey: l.memberKey || undefined, order: order++ });
  for (const p of input.posts ?? [])
    tasks.push({ ...base, id: crypto.randomUUID(), key: p.key, kind: "post", url: p.url, tabId: p.tabId, reasons: ["url"], order: order++ });
  await cdb().transaction("rw", [cdb().jobs, cdb().tasks, cdb().captures], async () => {
    await cdb().jobs.add(job);
    for (const t of tasks) {
      // 이전 작업의 저장본이 있으면 다시 열지 않고 쓴다(지금 열린 탭에서 저장하는 경우는 항상 새로 읽음)
      const before = input.options.skipCaptured && t.kind === "post" && t.tabId === undefined ? await findCapture(t.key, job.id, true) : undefined;
      await cdb().tasks.add({ ...t, ...(before ? await reuseCapture(before, job.id, t.id, t.key, t.reasons ?? [], input.options.selection) : {}) });
    }
  });
  return job;
}
