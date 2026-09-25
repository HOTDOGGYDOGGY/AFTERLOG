// 수집 결과 → .afterlog (웹 앱과 같은 규격, src/archive). 글 하나 = 문서 하나.
// 인증정보·서명 주소는 넣지 않는다: 원문은 게시글 영역 DOM 조각뿐, 이미지는 바이트와 주소만.
import { writeArchive, type ArchiveAsset, type ArchiveSource } from "../../src/archive/writer";
import type { CaptureReport } from "../../src/archive/captureReport";
import { SCHEMA_VERSION, type DocumentData, type Project } from "../../src/domain/types";
import { buildDocument } from "../../src/importers/band/build";
import { BAND_HTML_PARSER_VERSION, imageRefFromSrc, parseBandHtml } from "../../src/importers/band/html";
import { sha256Hex } from "../../src/storage/hash";
import { COLLECTOR_VERSION } from "./config";
import { cdb, type Capture, type CommentObservation, type Job, type Task } from "./db";
import { describeSelection } from "./selection";
import { safeName } from "../../src/exporters/fileName";

export interface ExportedPart {
  blob: Blob;
  fileName: string;
}

const UNSUPPORTED = [
  "접힌 댓글·'이전 댓글' 자동 펼치기 (실제 화면의 버튼 구조 확인 전이라 누르지 않음)",
  "표정 종류별 수·반응자 명단",
  "인물 프로필·스토리·프로필 댓글",
  "밴드 채팅",
  "동영상·일반 파일 첨부 원본",
];

export async function buildReport(job: Job, tasks: Task[], caps: Capture[], exportedAt: string, obs: CommentObservation[] = []): Promise<CaptureReport> {
  const urls = new Set(caps.flatMap((c) => c.imageUrls));
  const assets = (await cdb().assets.bulkGet([...urls])).filter(Boolean);
  const posts = tasks.filter((t) => t.kind === "post");
  const lists = tasks.filter((t) => t.kind === "list");
  const failed = posts.filter((t) => t.status === "failed").length;
  const partial = posts.filter((t) => t.status === "partial").length;
  const pending = posts.filter((t) => t.status === "pending" || t.status === "inFlight").length;
  const assetsFailed = assets.filter((a) => a!.status === "failed");
  const unknownEnd = lists.some((l) => l.result?.coverage === "unknown");
  const outcome: CaptureReport["outcome"] = failed || partial || pending || assetsFailed.length || lists.some((l) => l.result?.coverage === "partial") ? "partial" : unknownEnd ? "unknownEnd" : "complete";
  return {
    collectorVersion: COLLECTOR_VERSION,
    jobId: job.id,
    label: job.label,
    scope: job.scope,
    bandNo: job.bandNo,
    bandName: job.bandName,
    startedAt: job.startedAt ?? job.createdAt,
    finishedAt: job.finishedAt,
    exportedAt,
    outcome,
    options: { ...job.options },
    lists: lists.map((l) => ({ url: l.url, coverage: l.result?.coverage ?? "unknown", found: l.result?.found ?? 0, evidence: l.result?.evidence ?? "" })),
    posts: {
      discovered: posts.length,
      captured: posts.filter((t) => t.status === "succeeded" || t.status === "partial").length,
      failed,
      skipped: posts.filter((t) => t.status === "skipped").length,
      outOfRange: posts.filter((t) => t.result?.outOfRange).length,
      items: posts.map((t) => ({
        url: t.url,
        status: t.status,
        title: t.result?.title,
        comments: t.result?.commentsFound !== undefined ? { shown: t.result.commentsShown ?? null, found: t.result.commentsFound } : undefined,
        error: t.errorText ?? undefined,
        reasons: t.reasons,
      })),
    },
    totals: {
      posts: caps.length,
      comments: caps.reduce((n, c) => n + (c.commentsFound || 0), 0),
      commentsShown: caps.reduce((n, c) => n + Math.max(c.commentsShown ?? c.commentsFound ?? 0, c.commentsFound || 0), 0),
      memberComments: job.options.selection?.commentsOnly ? obs.filter((o) => o.inRange !== false).length : 0,
    },
    selection: job.options.selection
      ? {
          summary: describeSelection(job.options.selection),
          modes: { authored: job.options.selection.authored, commentsOnly: job.options.selection.commentsOnly, commentedPosts: job.options.selection.commentedPosts },
          period: { from: job.options.selection.periodFrom, to: job.options.selection.periodTo, basis: "쓴 글: 글 작성일 · 쓴 댓글·댓글 단 글: 이 인물의 댓글 작성일" },
          members: job.options.selection.members.map((m) => ({ bandNo: m.bandNo, name: tasks.find((t) => t.memberKey === m.memberKey && t.result?.memberName)?.result?.memberName ?? m.name })),
          comments: {
            observed: obs.length,
            inRange: obs.filter((o) => o.inRange === true).length,
            dateUnknown: obs.filter((o) => o.inRange === null).length,
            linked: obs.filter((o) => o.link === "linked").length,
            linkFailed: obs.filter((o) => o.link === "failed").length,
            verified: obs.filter((o) => o.content === "verified").length,
            listTextOnly: obs.filter((o) => o.content === "listText").length,
          },
        }
      : undefined,
    assets: {
      stored: assets.filter((a) => a!.status === "stored" && a!.quality !== "thumbnail").length,
      thumbnailOnly: assets.filter((a) => a!.status === "stored" && a!.quality === "thumbnail").length,
      failed: assetsFailed.length,
      notRequested: job.options.includeImages ? 0 : urls.size,
      failures: assetsFailed.map((a) => ({ url: a!.url, reason: a!.errorCode ?? "unknown" })),
    },
    unsupported: UNSUPPORTED,
    notes: [
      "목록의 '끝 확인 불가'는 스크롤해도 새 글이 나오지 않았다는 뜻이며, 밴드의 모든 글을 확인했다는 증명이 아닙니다.",
      "표정 수는 화면에 숫자가 보일 때만 기록합니다. '표정짓기' 버튼만 있으면 '미확보'입니다.",
      "프로필 사진은 밴드가 보여 준 축소 이미지일 수 있습니다(thumbnailOnly).",
    ],
  };
}

/** 작업 하나를 .afterlog 파트들로 */
export async function exportJob(jobId: string, opts: { maxPartBytes?: number } = {}): Promise<{ parts: ExportedPart[]; documents: number; report: CaptureReport }> {
  const { job, documents, assets, sources, report, projectId, exportedAt } = await buildJobDocuments(jobId);
  const project: Project = {
    id: projectId,
    title: job.bandName ?? job.label,
    schemaVersion: SCHEMA_VERSION,
    createdAt: exportedAt,
    updatedAt: exportedAt,
    documentIds: documents.map((d) => d.id),
    deletedAt: null,
  };
  const base = `${safeName(job.bandName ?? job.label)}_수집`;
  const parts: ExportedPart[] = [];
  for await (const p of writeArchive(
    {
      project,
      documents,
      assets,
      sources,
      capture: { report, jobs: { jobId: job.id, scope: job.scope, options: job.options, createdVersion: job.createdVersion, lastRunVersion: job.lastRunVersion } },
      appVersion: COLLECTOR_VERSION,
      producer: "afterlog-collector",
      exportedAt,
    },
    { maxPartBytes: opts.maxPartBytes ?? job.options.maxPartMB * 1024 * 1024 },
  )) {
    const suffix = p.partCount > 1 ? `_part${String(p.partIndex).padStart(2, "0")}of${String(p.partCount).padStart(2, "0")}` : "";
    parts.push({ blob: new Blob([p.bytes as BlobPart], { type: "application/zip" }), fileName: `${base}${suffix}.afterlog` });
  }
  return { parts, documents: documents.length, report };
}

/**
 * 작업 하나를 바로 보는 HTML로(앱의 '감상용 HTML'과 같은 렌더러). 이미지는 파일 안에 넣어 인터넷 없이 열린다.
 * 글이 하나면 HTML 하나, 여러 개면 글마다 HTML + 목차(index.html)를 ZIP 하나로.
 */
export async function exportJobHtml(jobId: string, appTheme: "light" | "dark" = "light"): Promise<{ file: ExportedPart; documents: number; report: CaptureReport }> {
  const { job, documents, assets, report, docUrls } = await buildJobDocuments(jobId);
  if (!documents.length) throw new Error("저장한 글이 없습니다.");
  const { renderDocumentHtml, usedAssetIds, blobToDataUrl, escapeHtml } = await import("../../src/exporters/html");
  const byId = new Map(assets.map((a) => [a.id, a]));
  const dataUrl = new Map<string, string>();
  const urlsFor = async (doc: DocumentData) => {
    const m = new Map<string, string>();
    for (const id of usedAssetIds(doc)) {
      const a = byId.get(id);
      if (!a) continue;
      if (!dataUrl.has(id)) dataUrl.set(id, await blobToDataUrl(a.data as Blob));
      m.set(id, dataUrl.get(id)!);
    }
    return m;
  };
  const base = safeName(job.bandName ?? job.label);
  if (documents.length === 1) {
    const html = renderDocumentHtml(documents[0], await urlsFor(documents[0]), appTheme);
    return { file: { blob: new Blob([html], { type: "text/html;charset=utf-8" }), fileName: `${safeName(documents[0].title)}.html` }, documents: 1, report };
  }
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  const rows: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < documents.length; i++) {
    const d = documents[i];
    let name = `${String(i + 1).padStart(3, "0")}_${safeName(d.title).slice(0, 60)}.html`;
    while (used.has(name)) name = name.replace(/\.html$/, "_.html");
    used.add(name);
    files[name] = strToU8(renderDocumentHtml(d, await urlsFor(d), appTheme));
    const comments = Object.values(d.entries).filter((e) => e.kind !== "post").length;
    const url = docUrls.get(d.id);
    rows.push(
      `<tr><td>${i + 1}</td><td><a href="${encodeURI(name)}">${escapeHtml(d.title)}</a>${d.inputFormat === "band-member-comments" ? " <small>(댓글 모음)</small>" : ""}</td><td>${comments}</td><td>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">밴드에서 열기 ↗</a>` : ""}</td></tr>`,
    );
  }
  const t = report.totals;
  files["index.html"] = strToU8(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="AFTERLOG Collector">
<title>${escapeHtml(job.bandName ?? job.label)} · 목차</title>
<style>
:root{color-scheme:light dark}body{font:15px/1.5 system-ui,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:900px;margin:24px auto;padding:0 16px}
table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;border-bottom:1px solid #8884;text-align:left;vertical-align:top}td:nth-child(3){white-space:nowrap}
.muted{opacity:.7;font-size:13px}
</style></head><body>
<h1>${escapeHtml(job.bandName ?? job.label)}</h1>
<p>${t ? `글 ${t.posts}개 · 댓글 ${t.comments}개${t.commentsShown > t.comments ? ` (밴드 표시 ${t.commentsShown}개)` : ""}${t.memberComments ? ` · 인물 댓글 모음 ${t.memberComments}개` : ""}` : ""}</p>
<p class="muted">AFTERLOG 수집 확장 v${COLLECTOR_VERSION} · ${new Date(report.exportedAt).toLocaleString()} 저장. 제목을 누르면 그 글이 열립니다. 이 파일들은 인터넷 없이 열립니다. 고치거나 다시 내보내려면 같은 작업의 .afterlog 파일을 AFTERLOG에서 여세요.</p>
<table><thead><tr><th>#</th><th>글</th><th>댓글</th><th>원래 글</th></tr></thead><tbody>
${rows.join("\n")}
</tbody></table></body></html>
`);
  return { file: { blob: new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: "application/zip" }), fileName: `${base}_HTML.zip` }, documents: documents.length, report };
}

/** .afterlog와 HTML 저장이 함께 쓰는 문서 만들기(지금 저장된 것만 읽어 일관된 시점으로) */
async function buildJobDocuments(jobId: string) {
  const job = await cdb().jobs.get(jobId);
  if (!job) throw new Error("작업이 없습니다.");
  // 수집 중에도 일관된 시점으로(명세 11.3): 지금 저장된 것만 읽어서 만든다
  const tasks = await cdb().tasks.where("jobId").equals(jobId).sortBy("order");
  // 선택 수집에서 기간 밖이라 뺀 저장본은 넣지 않는다
  const caps = (await cdb().captures.where("jobId").equals(jobId).toArray()).filter((c) => !c.excluded);
  const orderOf = new Map(tasks.map((t) => [t.id, t.order]));
  caps.sort((a, b) => (orderOf.get(a.taskId) ?? 0) - (orderOf.get(b.taskId) ?? 0));
  const exportedAt = new Date().toISOString();
  const projectId = crypto.randomUUID();

  // 이미지: 해시가 같으면 한 자산으로
  const bySha = new Map<string, ArchiveAsset>();
  const urlToAsset = new Map<string, string>();
  for (const url of new Set(caps.flatMap((c) => c.imageUrls))) {
    const a = await cdb().assets.get(url);
    if (!a || a.status !== "stored" || !a.blob || !a.sha256) continue;
    let asset = bySha.get(a.sha256);
    if (!asset) {
      asset = { id: crypto.randomUUID(), name: imageRefFromSrc(url) ?? "image", mime: a.mime ?? a.blob.type, size: a.size, sha256: a.sha256, data: a.blob };
      bySha.set(a.sha256, asset);
    }
    urlToAsset.set(url, asset.id);
  }

  const documents: DocumentData[] = [];
  const sources: ArchiveSource[] = [];
  const docUrls = new Map<string, string>();
  for (const c of caps) {
    const parsed = parseBandHtml(c.html);
    const pd = parsed.documents.find((d) => d.format === "band-post");
    if (!pd) continue;
    // 문서 안에서는 파일명(ref)으로 연결되므로, 이 글에 나온 주소만으로 ref → 자산 표를 만든다
    const assetMap = new Map<string, string>();
    for (const url of c.imageUrls) {
      const ref = imageRefFromSrc(url);
      const id = urlToAsset.get(url);
      if (ref && id) assetMap.set(ref, id);
    }
    const bytes = new TextEncoder().encode(c.html);
    const sourceId = crypto.randomUUID();
    sources.push({
      id: sourceId,
      fileName: `band-${c.bandNo}-post-${c.postNo || "unknown"}.html`,
      mime: "text/html",
      importedAt: c.capturedAt,
      parserVersion: BAND_HTML_PARSER_VERSION,
      sha256: await sha256Hex(bytes),
      kind: "band-collector-capture",
      sourceUrl: c.url,
      data: bytes,
    });
    const doc = buildDocument(pd, { projectId, sourceId, parserVersion: BAND_HTML_PARSER_VERSION, assetMap, sourceKind: "band-collector-capture" });
    if (c.commentsShown !== null && c.commentsShown !== c.commentsFound) {
      doc.issues.push({
        id: crypto.randomUUID(),
        kind: "comment-count-mismatch",
        message: `수집할 때 표시된 댓글은 ${c.commentsShown}개, 화면에서 확보한 댓글은 ${c.commentsFound}개였습니다. 접힌 댓글을 펼친 뒤 이 글을 다시 수집하면 채울 수 있습니다.`,
        resolved: false,
      });
    }
    doc.revision = 1;
    documents.push(doc);
    docUrls.set(doc.id, c.url);
  }

  // 인물의 댓글만(B): 인물마다 댓글 모음 문서 하나. 목록이 보여 준 그대로(원글은 목록의 발췌만)이며 다른 사람의 글·댓글 전문은 넣지 않는다(F05)
  const obs = await cdb().comments.where("jobId").equals(jobId).toArray();
  if (job.options.selection?.commentsOnly) {
    for (const t of tasks.filter((x) => x.kind === "comments")) {
      // 교집합(AND)이면 조건을 만족한(결과에 든) 원글에 연결된 댓글만(4.3)
      const included = new Set(caps.map((c) => c.key));
      const mine = obs
        .filter((o) => o.taskId === t.id && o.inRange !== false && (job.options.selection?.combine !== "and" || (!!o.postKey && included.has(o.postKey))))
        .sort((a, b) => a.seq - b.seq);
      if (!mine.length) continue;
      const name = t.result?.memberName ?? mine[0].memberName ?? "";
      const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} 댓글 모음</title></head><body><div class="accountSectionHeader"><h1 class="title"><span class="sf_color">${esc(name)}</span></h1></div><div data-viewname="DBandMemberCommentListView">${mine.map((o) => o.html).join("")}</div></body></html>`;
      const pd = parseBandHtml(html).documents.find((d) => d.format === "band-member-comments");
      if (!pd) continue;
      const bytes = new TextEncoder().encode(html);
      const sourceId = crypto.randomUUID();
      sources.push({
        id: sourceId,
        fileName: `band-${mine[0].bandNo}-member-comments.html`,
        mime: "text/html",
        importedAt: exportedAt,
        parserVersion: BAND_HTML_PARSER_VERSION,
        sha256: await sha256Hex(bytes),
        kind: "band-collector-capture",
        data: bytes,
      });
      const doc = buildDocument(pd, { projectId, sourceId, parserVersion: BAND_HTML_PARSER_VERSION, assetMap: new Map(), sourceKind: "band-collector-capture" });
      const unverified = mine.filter((o) => o.content !== "verified").length;
      if (unverified)
        doc.issues.push({
          id: crypto.randomUUID(),
          kind: "unverified-structure",
          message: `댓글 ${mine.length}개 중 ${unverified}개는 댓글 목록에 보인 글자 그대로입니다(원글의 댓글과 대조하지 않아 전문인지 확인되지 않음).`,
          resolved: false,
        });
      doc.revision = 1;
      documents.push(doc);
    }
  }

  const report = await buildReport(job, tasks, caps, exportedAt, obs);
  return { job, documents, assets: [...bySha.values()], sources, report, projectId, exportedAt, docUrls };
}
