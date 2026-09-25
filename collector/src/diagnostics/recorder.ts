// 진단 이벤트 기록·보관·파일 생성. 이벤트는 기록할 때 이미 스키마 검사를 통과해야 한다.
import { cdb, type Job, type Task } from "../db";
import { COLLECTOR_VERSION } from "../config";
import { BAND_HTML_PARSER_VERSION } from "../../../src/importers/band/html";
import * as S from "./schema";
import { serializeDiagnostic, validateEvent, validateStructure } from "./serializer";

/** 보관 한도: 최근 작업 3개 · 총 5MiB · 7일 (먼저 닿는 쪽) */
export const DIAG_RETENTION = { jobs: 3, bytes: 5 * 1024 * 1024, days: 7 };

type Stored = { type: "event"; e: S.DiagEvent } | { type: "structure"; s: S.StructNode };

export class DiagRecorder {
  private seq = 0;
  private taskNos = new Map<string, number>();
  constructor(
    private jobId: string,
    private enabled: boolean,
  ) {}

  /**
   * 원본 과제 ID 대신 보고서 안에서만 쓰는 번호(C03).
   * 과제 DB에 저장된 작업 내 순서(order)로 정하므로 기록기를 다시 만들어도(중단·재개·업데이트) 같은 과제는 같은 번호,
   * 다른 과제는 다른 번호다. 주소·원본 ID는 쓰지 않는다. 과제 표에 없는 ID는 0(작업 전체)으로 남긴다.
   */
  async taskNo(taskId: string): Promise<number> {
    const cached = this.taskNos.get(taskId);
    if (cached !== undefined) return cached;
    const t = await cdb().tasks.get(taskId);
    const n = t && t.jobId === this.jobId ? t.order + 1 : 0;
    this.taskNos.set(taskId, n);
    return n;
  }

  /** 이어받을 때 순번을 이어서 */
  async init() {
    const all = await cdb().diag.where("jobId").equals(this.jobId).toArray();
    this.seq = Math.max(0, ...all.map((r) => ((r.event as Stored).type === "event" ? (r.event as { e: S.DiagEvent }).e.seq : 0)));
  }

  async event(taskId: string | null, e: Omit<S.DiagEvent, "seq" | "task">) {
    if (!this.enabled) return;
    const task = taskId ? await this.taskNo(taskId) : 0;
    const full = validateEvent({ seq: ++this.seq, task, ...e });
    const rec: Stored = { type: "event", e: full };
    await cdb().diag.add({ jobId: this.jobId, at: Date.now(), event: rec, bytes: JSON.stringify(rec).length });
  }

  async structure(s: unknown) {
    if (!this.enabled) return;
    if (!s || (typeof s === "object" && (s as { scopeMissing?: boolean }).scopeMissing)) {
      // 대상 범위를 못 찾으면 더 넓은 영역을 표본으로 쓰지 않는다
      await this.event(null, { stage: "scope", state: "fail", code: "scopeMissing" });
      return;
    }
    let node: S.StructNode;
    try {
      node = validateStructure(s);
    } catch {
      // 상한 초과 등으로 검사에 걸리면 표본 없이 사건만 남긴다(원문으로 대체하지 않음)
      await this.event(null, { stage: "scope", state: "partial", code: "other" });
      return;
    }
    const rec: Stored = { type: "structure", s: node };
    await cdb().diag.add({ jobId: this.jobId, at: Date.now(), event: rec, bytes: JSON.stringify(rec).length });
  }
}

/** 오래된 진단 정리. 백업 자료(captures·assets)는 건드리지 않는다(D11) */
export async function pruneDiagnostics(now = Date.now()) {
  const d = cdb();
  const cutoff = now - DIAG_RETENTION.days * 86400_000;
  await d.diag.where("at").below(cutoff).delete();
  const all = await d.diag.orderBy("at").toArray();
  const jobOrder: string[] = [];
  for (let i = all.length - 1; i >= 0; i--) if (!jobOrder.includes(all[i].jobId)) jobOrder.push(all[i].jobId);
  const drop = jobOrder.slice(DIAG_RETENTION.jobs);
  if (drop.length) await d.diag.where("jobId").anyOf(drop).delete();
  const rest = await d.diag.orderBy("at").toArray();
  let total = rest.reduce((n, r) => n + r.bytes, 0);
  const ids: number[] = [];
  for (const r of rest) {
    if (total <= DIAG_RETENTION.bytes) break;
    total -= r.bytes;
    ids.push(r.id!);
  }
  if (ids.length) await d.diag.bulkDelete(ids);
}

export async function deleteDiagnostics(jobId: string) {
  await cdb().diag.where("jobId").equals(jobId).delete();
}

function environment(): S.DiagnosticFile["environment"] {
  const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } };
  const brands = nav.userAgentData?.brands ?? [];
  const edge = brands.find((b) => /Edge/i.test(b.brand));
  const chrome = brands.find((b) => /Google Chrome|Chromium/i.test(b.brand));
  const pick = edge ?? chrome;
  const lang = (globalThis.navigator?.language || "").slice(0, 2);
  const w = (globalThis as { screen?: { width?: number } }).screen?.width ?? 0;
  return {
    browser: edge ? "edge" : chrome ? "chrome" : "other",
    browserMajor: pick ? Math.min(999, Number.parseInt(pick.version, 10) || 0) : 0,
    uiLang: (["ko", "en", "ja"].includes(lang) ? lang : "other") as S.DiagnosticFile["environment"]["uiLang"],
    screen: w < 1024 ? "lt1024" : w <= 1440 ? "1024to1440" : "gt1440",
  };
}

/** 진단 파일 문자열(미리보기와 저장에 같은 문자열 사용) */
export async function buildDiagnosticText(job: Job, tasks: Task[], opts: { includeStructure: boolean }): Promise<string> {
  const recs = await cdb().diag.where("jobId").equals(job.id).sortBy("at");
  const events = recs
    .map((r) => r.event as Stored)
    .filter((x): x is { type: "event"; e: S.DiagEvent } => x.type === "event")
    .map((x) => x.e)
    .slice(-500);
  const structs = recs.map((r) => r.event as Stored).filter((x): x is { type: "structure"; s: S.StructNode } => x.type === "structure");
  const by = (st: Task["status"]) => S.countBucket(tasks.filter((t) => t.status === st).length);
  const file: S.DiagnosticFile = {
    diagnosticSchemaVersion: S.DIAG_SCHEMA_VERSION,
    extensionVersion: COLLECTOR_VERSION,
    adapterVersion: S.ADAPTER_VERSION,
    parserVersion: BAND_HTML_PARSER_VERSION,
    probeSuiteVersion: S.PROBE_SUITE_VERSION,
    environment: environment(),
    job: {
      scope: job.scope,
      tasks: S.countBucket(tasks.length),
      succeeded: by("succeeded"),
      partial: by("partial"),
      failed: by("failed"),
      skipped: by("skipped"),
      userVerified: S.countBucket(tasks.filter((t) => t.result?.userVerified).length),
    },
    events,
    structure: opts.includeStructure ? structs.at(-1)?.s ?? null : null,
  };
  return serializeDiagnostic(file);
}
