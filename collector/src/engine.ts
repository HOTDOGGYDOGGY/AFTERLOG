// 수집 엔진 (수집 명세 8·9절). 수집 관리 페이지 안에서 돈다.
// 상태는 전부 DB에 두고(메모리에 작업을 들고 있지 않음), 한 과제의 결과와 완료 표시는 한 트랜잭션에서 확정한다.
// 창이 닫히거나 확장이 업데이트되어도 점유(lease)가 끝난 과제는 다시 대기열로 돌아가 이어받는다.
import { parseBandHtml, type ParsedDocument } from "../../src/importers/band/html";
import { COLLECTOR_VERSION, LIMITS, MIN_DELAY_MS } from "./config";
import { cdb, type Capture, type Job, type Task } from "./db";
import { BrowserError, imageQuality, type CollectorBrowser } from "./browser";
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
    if (job.lastRunVersion && job.lastRunVersion !== COLLECTOR_VERSION) {
      // 업데이트 후 이어받기: 저장된 주소(안정 참조)에서 다시 시작한다
      await diag.event(null, { stage: "version", state: "ok", code: "versionChanged" });
    }
    await this.setJob(jobId, { status: "running", pauseReason: null, startedAt: job.startedAt ?? iso(this.now()), lastRunVersion: COLLECTOR_VERSION });
    await this.recoverLeases(jobId, diag);

    let sameErrorRun = 0;
    let lastError: string | null = null;
    try {
      for (;;) {
        const cur = await cdb().jobs.get(jobId);
        if (!cur || cur.status !== "running") return cur?.status === "needsUser" ? "needsUser" : "paused";
        if (this.stopRequested) {
          await this.setJob(jobId, { status: "paused", pauseReason: "사용자가 일시정지했습니다.", current: null });
          return "paused";
        }
        const task = await this.nextTask(jobId);
        if (!task) {
          // 완료 판정은 대기(pending)와 점유 중(inFlight)을 모두 본다(C01)
          const waiting = await cdb().tasks.where("[jobId+status]").equals([jobId, "pending"]).count();
          if (waiting) {
            // 재시도 대기 중인 과제가 있다
            await this.sleep(Math.max(MIN_DELAY_MS, 500));
            continue;
          }
          const held = await cdb().tasks.where("[jobId+status]").equals([jobId, "inFlight"]).toArray();
          if (held.length) {
            if (await this.recoverLeases(jobId, diag)) continue;
            // 아직 유효한 점유: 끝나거나 만료될 때까지 기다렸다가 다시 본다
            const until = Math.min(...held.map((t) => t.leaseUntil));
            await this.setJob(jobId, { current: null });
            await this.sleep(Math.min(Math.max(until - this.now(), 250), 5000));
            continue;
          }
          await this.setJob(jobId, { status: "finished", finishedAt: iso(this.now()), current: null });
          return "done";
        }
        if (!(await this.claim(task))) continue;
        await this.setJob(jobId, { current: task.url });
        let outcome: { ok: true } | { ok: false; code: string; text: string; retry: boolean; stopJob?: "needsUser" | "paused" };
        try {
          outcome = task.kind === "list" ? await this.runList(cur, task, diag) : await this.runPost(cur, task, diag);
        } catch (e) {
          const code = e instanceof BrowserError ? e.code : "other";
          outcome = { ok: false, code, text: (e as Error).message || "알 수 없는 오류", retry: code !== "loginRequired", stopJob: code === "loginRequired" ? "needsUser" : undefined };
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
            return outcome.stopJob === "needsUser" ? "needsUser" : "paused";
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
            return "paused";
          }
        }
        await this.setJob(jobId, { lastCheckpointAt: iso(this.now()) });
        // 요청 간격: 1.5~3초(명세 8.3)
        await this.sleep(MIN_DELAY_MS + this.random() * MIN_DELAY_MS);
      }
    } finally {
      this.emit(jobId);
    }
  }

  private async nextTask(jobId: string): Promise<Task | null> {
    const now = this.now();
    const pending = await cdb().tasks.where("[jobId+status]").equals([jobId, "pending"]).toArray();
    const ready = pending.filter((t) => t.notBefore <= now).sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === "list" ? -1 : 1));
    return ready[0] ?? null;
  }

  // ---------- 목록에서 글 찾기 ----------

  private async runList(job: Job, task: Task, diag: DiagRecorder): Promise<{ ok: true } | { ok: false; code: string; text: string; retry: boolean; stopJob?: "needsUser" }> {
    const b = parseBandUrl(task.url);
    if (!b) return { ok: false, code: "navigationFailed", text: "밴드 주소가 아닙니다.", retry: false };
    await this.deps.browser.openList(task.url);
    let emptyRounds = 0;
    let rounds = 0;
    let total = 0;
    let end: "noProgress" | "maxRounds" = "noProgress";
    let order = (await cdb().tasks.where("jobId").equals(job.id).count()) + 1;
    for (;;) {
      if (this.stopRequested) break;
      rounds++;
      const r = await this.deps.browser.discoverRound(b.bandNo);
      if (r.loginRequired) return { ok: false, code: "loginRequired", text: "밴드에 로그인해야 합니다. 로그인한 뒤 이어받기를 누르세요.", retry: false, stopJob: "needsUser" };
      let added = 0;
      // 발견 즉시 저장(가상화 목록에서 사라져도 남도록, T02)
      await cdb().transaction("rw", [cdb().tasks, cdb().captures], async () => {
        for (const link of r.links) {
          const p = parseBandUrl(link);
          if (p?.kind !== "post") continue;
          const key = postKey(p.bandNo, p.postNo);
          const exists = await cdb().tasks.where("[jobId+key]").equals([job.id, key]).first();
          if (exists) continue;
          const before = job.options.skipCaptured ? await cdb().captures.where("key").equals(key).filter((c) => c.jobId !== job.id).first() : undefined;
          await cdb().tasks.add({
            id: crypto.randomUUID(),
            jobId: job.id,
            key,
            kind: "post",
            url: p.canonical,
            order: order++,
            status: before ? "skipped" : "pending",
            attempts: 0,
            errorCode: before ? "alreadyCaptured" : null,
            errorText: before ? "이전 작업에서 이미 저장한 글이라 건너뛰었습니다." : null,
            leaseUntil: 0,
            notBefore: 0,
          });
          added++;
        }
      });
      total += added;
      await diag.event(task.id, { stage: "listRound", state: "ok", progress: added > 0, count: countBucket(added) });
      await cdb().tasks.update(task.id, { result: { coverage: "unknown", found: total, evidence: `${rounds}회 스크롤` }, leaseUntil: this.now() + LIMITS.leaseMs });
      this.emit(job.id);
      if (added === 0 && !r.loading) emptyRounds++;
      else emptyRounds = 0;
      if (emptyRounds >= LIMITS.emptyRoundsToStop) break;
      if (rounds >= LIMITS.maxListRounds) {
        end = "maxRounds";
        break;
      }
      await this.sleep(MIN_DELAY_MS + this.random() * MIN_DELAY_MS);
    }
    // 명시적인 끝 표시를 확인한 적이 없으므로 '끝 확인 불가'로 남긴다(8.2)
    const coverage = end === "maxRounds" ? "partial" : "unknown";
    const evidence =
      end === "maxRounds"
        ? `스크롤 ${rounds}회 상한에서 멈춤`
        : `스크롤 ${rounds}회, 마지막 ${LIMITS.emptyRoundsToStop}회 동안 새 글 없음(명시적인 끝 표시는 확인하지 못함)`;
    await diag.event(task.id, { stage: "listEnd", state: coverage === "partial" ? "partial" : "unknown", end, count: countBucket(total) });
    await cdb().tasks.update(task.id, { status: "succeeded", leaseUntil: 0, result: { coverage, found: total, evidence } });
    return { ok: true };
  }

  // ---------- 글 하나 ----------

  private async runPost(job: Job, task: Task, diag: DiagRecorder): Promise<{ ok: true } | { ok: false; code: string; text: string; retry: boolean; stopJob?: "needsUser" }> {
    const target = task.tabId !== undefined ? { tabId: task.tabId } : { url: task.url };
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
    await diag.event(task.id, {
      stage: "countCheck",
      state: countOk === null ? "unknown" : countOk ? "ok" : "partial",
      ...(countOk === false ? { code: "countMismatch" as const } : {}),
      count: countBucket(foundComments),
    });
    await diag.event(task.id, { stage: "reactions", state: post.reactions?.status === "value" ? "ok" : "unknown" });

    // 기간 조건(작성 시각 기준)
    const inRange = periodContains(post.time?.local ?? null, job.options.periodFrom, job.options.periodTo);
    const canonical = ex.postHref ? parseBandUrl(ex.postHref) : parseBandUrl(task.url);
    const key = canonical?.kind === "post" ? postKey(canonical.bandNo, canonical.postNo) : task.key;
    if (inRange === false) {
      await diag.event(task.id, { stage: "storage", state: "skipped", code: "outOfRange" });
      await cdb().tasks.update(task.id, { status: "skipped", leaseUntil: 0, key, result: { title: doc.title, outOfRange: true } });
      return { ok: true };
    }

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
    };
    const partial = countOk === false;
    try {
      await cdb().transaction("rw", [cdb().captures, cdb().tasks, cdb().jobs], async () => {
        // 같은 작업 안의 같은 글은 최신 관측 하나로(재시도·재개 시 중복 생성 방지)
        await cdb().captures.where("[jobId+key]").equals([job.id, key]).delete();
        await cdb().captures.add(capture);
        await cdb().tasks.update(task.id, {
          status: partial ? "partial" : "succeeded",
          key,
          url: capture.url,
          leaseUntil: 0,
          errorCode: partial ? "countMismatch" : null,
          errorText: partial ? `표시된 댓글 ${ex.commentsShown}개 중 ${foundComments}개만 화면에 있었습니다(접힌 댓글 미로딩 가능).` : null,
          result: { title: doc.title, commentsShown: ex.commentsShown, commentsFound: foundComments },
        });
        if (!job.bandName && ex.bandName) await cdb().jobs.update(job.id, { bandName: ex.bandName, bandNo: capture.bandNo || job.bandNo });
      });
      await diag.event(task.id, { stage: "storage", state: "ok" });
    } catch {
      await diag.event(task.id, { stage: "storage", state: "fail", code: "storageFailed" });
      return { ok: false, code: "storageFailed", text: "브라우저 저장 공간에 쓰지 못했습니다(용량 부족 가능). '지금까지 저장'으로 먼저 파일을 받아 주세요.", retry: false };
    }

    if (job.options.includeImages) await this.fetchAssets(ex.imageUrls, task.id, diag);
    return { ok: true };
  }

  /** 첨부·프로필 이미지 확보. 실패해도 본문과 자리는 남는다(11.1) */
  async fetchAssets(urls: string[], taskId: string | null, diag: DiagRecorder) {
    const queue = [...urls];
    const worker = async () => {
      for (let url = queue.shift(); url; url = queue.shift()) {
        const existing = await cdb().assets.get(url);
        if (existing?.status === "stored") continue;
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
    };
    await Promise.all(Array.from({ length: LIMITS.assetConcurrency }, worker));
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
  for (const l of input.lists ?? []) tasks.push({ ...base, id: crypto.randomUUID(), key: `list:${l}`, kind: "list", url: l, order: order++ });
  const skip = input.options.skipCaptured ? new Set((await cdb().captures.toArray()).map((c) => c.key)) : new Set<string>();
  for (const p of input.posts ?? []) {
    const already = skip.has(p.key) && p.tabId === undefined;
    tasks.push({
      ...base,
      id: crypto.randomUUID(),
      key: p.key,
      kind: "post",
      url: p.url,
      tabId: p.tabId,
      order: order++,
      ...(already ? { status: "skipped" as const, errorCode: "alreadyCaptured", errorText: "이전 작업에서 이미 저장한 글이라 건너뛰었습니다." } : {}),
    });
  }
  await cdb().transaction("rw", [cdb().jobs, cdb().tasks], async () => {
    await cdb().jobs.add(job);
    await cdb().tasks.bulkAdd(tasks);
  });
  return job;
}
