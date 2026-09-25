// 확장에서 보관 파일(.afterlog) 가져오기(프로필 명세 6.1). 앱과 같은 판독기로 읽고, 가져오자마자 수집하지 않는다.
// '내용 보기'와 '부족한 자료 이어 수집'을 나눈다. 이어 수집할 주소가 없는 옛 자료는 열람만 되고 그 이유를 알린다.
import type { ArchiveReadResult } from "../../src/archive/reader";
import { isCaptureReport } from "../../src/archive/captureReport";
import type { DocumentData } from "../../src/domain/types";
import { isBandProfileRecord, type BandProfileRecord } from "../../src/importers/band/profile";
import { parseBandUrl, postKey } from "./urls";

export interface ArchiveSummary {
  title: string;
  producer: string;
  appVersion: string;
  exportedAt: string;
  missingParts: number[];
  docs: { id: string; title: string; format: string; comments: number; url: string | null; short: boolean }[];
  profiles: { record: BandProfileRecord; needsMore: boolean }[];
  /** 수집 보고서에 남은 실패·일부 글 주소 */
  reportRetry: string[];
  /** 이어 수집 대상(중복 없이) */
  resume: { posts: { url: string; key: string }[]; profiles: string[] };
  /** 모자란데 주소가 없어 이어 수집할 수 없는 글 */
  notResumable: number;
}

export function summarizeArchive(r: ArchiveReadResult): ArchiveSummary {
  const srcUrl = new Map(r.manifest.sources.map((s) => [s.id, (s as { sourceUrl?: string }).sourceUrl ?? null]));
  const docs = r.data.documents.map((d: DocumentData) => {
    const comments = Object.values(d.entries).filter((e) => e.kind !== "post").length;
    const short = d.issues.some((i) => i.kind === "comment-count-mismatch" && !i.resolved);
    return { id: d.id, title: d.title, format: d.inputFormat, comments, url: srcUrl.get(d.sourceId) ?? null, short };
  });
  const profiles: ArchiveSummary["profiles"] = [];
  const dec = new TextDecoder();
  for (const s of r.manifest.sources) {
    if (String((s as { kind?: string }).kind ?? "") !== "band-profile-data") continue;
    const bytes = r.files[s.path];
    if (!bytes) continue;
    try {
      const rec = JSON.parse(dec.decode(bytes));
      if (!isBandProfileRecord(rec)) continue;
      const needsMore = rec.stories.state === "notCollected" || rec.stories.state === "unrecognized" || rec.stories.items.some((x) => x.commentsState === "partial" || x.textSource === "list");
      profiles.push({ record: rec, needsMore });
    } catch {
      /* 읽지 못한 자료는 건너뜀 */
    }
  }
  const report = isCaptureReport(r.captureReport) ? r.captureReport : null;
  const reportRetry = report ? report.posts.items.filter((i) => i.status === "failed" || i.status === "partial").map((i) => i.url) : [];
  const posts = new Map<string, string>();
  const addPost = (u: string | null) => {
    const p = u ? parseBandUrl(u) : null;
    if (p?.kind === "post") posts.set(postKey(p.bandNo, p.postNo), p.canonical);
  };
  for (const d of docs) if (d.short) addPost(d.url);
  for (const u of reportRetry) addPost(u);
  const profileUrls = [...new Set(profiles.filter((p) => p.needsMore && p.record.profileUrl).map((p) => p.record.profileUrl!))];
  return {
    title: r.data.project.title,
    producer: r.manifest.producer ?? "",
    appVersion: r.manifest.appVersion,
    exportedAt: r.manifest.exportedAt,
    missingParts: r.missingParts,
    docs,
    profiles,
    reportRetry,
    resume: { posts: [...posts].map(([key, url]) => ({ key, url })), profiles: profileUrls },
    notResumable: docs.filter((d) => d.short && !(d.url && parseBandUrl(d.url)?.kind === "post")).length + profiles.filter((p) => p.needsMore && !p.record.profileUrl).length,
  };
}
