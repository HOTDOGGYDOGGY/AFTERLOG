// .afterlog 컨테이너 규격 (명세 11.2, 수집 명세 11.3). 웹 앱과 수집 확장이 함께 쓴다.
import type { DocumentData, Project } from "../domain/types";

export const AFTERLOG_FORMAT = "afterlog";
/** 1: 단일 파일. 2: 분할 묶음(archiveSet) 지원 */
export const AFTERLOG_FORMAT_VERSION = 2;

export const PROJECT_FILE_LIMITS = { maxEntries: 20000, maxTotalBytes: 1024 * 1024 * 1024, maxJsonBytes: 64 * 1024 * 1024 };
/** 분할 기본값: 파트당 첨부 원본 합계 약 100MiB */
export const DEFAULT_PART_BYTES = 100 * 1024 * 1024;

export interface ManifestFile {
  id: string;
  path: string;
  size: number;
  sha256: string;
  mime: string;
  name: string;
  /** 분할 묶음에서 이 파일이 들어 있는 파트 번호(1부터) */
  part?: number;
}

export interface ManifestSource extends ManifestFile {
  importedAt: string;
  parserVersion: string;
  kind?: string;
  sourceUrl?: string;
}

export interface ArchiveSetInfo {
  /** 같은 묶음의 파트끼리 같다 */
  id: string;
  /** 같은 시점의 내보내기끼리 같다. 다르면 합치지 않는다 */
  snapshotId: string;
  partCount: number;
  partIndex: number;
  /** 전체 자산·원문 색인의 해시. 파트끼리 같아야 한다 */
  indexHash: string;
}

export interface Manifest {
  format: typeof AFTERLOG_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  /** 만든 도구: 웹 앱 또는 수집 확장 */
  producer?: string;
  exportedAt: string;
  projectId: string;
  assets: ManifestFile[];
  sources: ManifestSource[];
  sourcesOmitted?: boolean;
  missingImages?: number;
  archiveSet?: ArchiveSetInfo;
  /** 수집 보고서 등 추가 파일 */
  capture?: { report?: string; jobs?: string };
}

export interface ProjectJson {
  project: Project;
  documents: DocumentData[];
}

export class ProjectFileError extends Error {
  name = "ProjectFileError";
}

export const ARCHIVE_PATH_RE = /^(manifest\.json|project\.json|assets\/[\w-]+|sources\/[\w-]+|capture\/(report|jobs)\.json)$/;
