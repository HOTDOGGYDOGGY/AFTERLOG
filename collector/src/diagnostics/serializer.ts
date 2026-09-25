// 진단 파일 직렬화: 전용 스키마로 새 객체만 검증해 내보낸다(원본 객체를 복사·가리는 방식 금지).
// 검증 실패 = 내보내기 차단. 원문으로 대체하지 않는다.
import * as S from "./schema";

type V = (x: unknown, path: string) => void;
class DiagSchemaError extends Error {
  name = "DiagSchemaError";
}
const fail = (path: string, why: string): never => {
  // 오류 메시지에도 값 자체는 넣지 않는다
  throw new DiagSchemaError(`진단 파일 검사 실패: ${path} (${why})`);
};
const oneOf =
  <T extends readonly string[]>(vals: T): V =>
  (x, p) => {
    if (typeof x !== "string" || !(vals as readonly string[]).includes(x)) fail(p, "허용되지 않은 값");
  };
const int =
  (min: number, max: number): V =>
  (x, p) => {
    if (typeof x !== "number" || !Number.isInteger(x) || x < min || x > max) fail(p, "숫자 범위");
  };
const bool: V = (x, p) => {
  if (typeof x !== "boolean") fail(p, "참/거짓 아님");
};
const version: V = (x, p) => {
  if (typeof x !== "string" || !/^[0-9A-Za-z.+-]{1,32}$/.test(x)) fail(p, "버전 형식");
};
const arr =
  (item: V, max: number): V =>
  (x, p) => {
    if (!Array.isArray(x)) fail(p, "배열 아님");
    const a = x as unknown[];
    if (a.length > max) fail(p, "배열이 너무 김");
    a.forEach((v, i) => item(v, `${p}[${i}]`));
  };
const obj =
  (shape: Record<string, V>, optional: string[] = []): V =>
  (x, p) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) fail(p, "객체 아님");
    const o = x as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!(k in shape)) fail(`${p}.?`, "정의되지 않은 키");
    for (const [k, v] of Object.entries(shape)) {
      if (!(k in o) || o[k] === undefined) {
        if (!optional.includes(k)) fail(`${p}.${k}`, "필수 값 없음");
        continue;
      }
      v(o[k], `${p}.${k}`);
    }
  };
const record =
  (keys: readonly string[], val: V): V =>
  (x, p) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) fail(p, "객체 아님");
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (!keys.includes(k)) fail(`${p}.?`, "정의되지 않은 키");
      val(v, `${p}.${k}`);
    }
  };

const eventV = obj(
  {
    seq: int(0, 100000),
    task: int(0, 100000),
    stage: oneOf(S.STAGES),
    state: oneOf(S.STATES),
    code: oneOf(S.ERROR_CODES),
    page: oneOf(S.PAGE_KINDS),
    fields: record(S.FIELD_KEYS, oneOf(S.FIELD_STATES)),
    probes: record(S.PROBE_IDS, oneOf(S.COUNT_BUCKETS)),
    wait: oneOf(S.DURATION_BUCKETS),
    count: oneOf(S.COUNT_BUCKETS),
    size: oneOf(S.SIZE_BUCKETS),
    media: oneOf(S.MEDIA_KINDS),
    progress: bool,
    waiting: bool,
    end: oneOf(S.END_EVIDENCE),
    attempt: int(0, 20),
    remaining: oneOf(S.COUNT_BUCKETS),
    candidates: oneOf(S.COUNT_BUCKETS),
  },
  ["code", "page", "fields", "probes", "wait", "count", "size", "media", "progress", "waiting", "end", "attempt", "remaining", "candidates"],
);

export const STRUCT_LIMITS = { maxDepth: 8, maxNodes: 150 };
const structV: V = (x, p) => {
  let nodes = 0;
  const walk = (n: unknown, path: string, depth: number) => {
    nodes++;
    if (nodes > STRUCT_LIMITS.maxNodes) fail(path, "구조 표본 노드 상한 초과");
    if (depth > STRUCT_LIMITS.maxDepth) fail(path, "구조 표본 깊이 상한 초과");
    obj(
      {
        n: int(0, 100000),
        tag: oneOf(S.STRUCT_TAGS),
        role: oneOf(S.STRUCT_ROLES),
        probes: arr(oneOf(S.PROBE_IDS), S.PROBE_IDS.length),
        text: bool,
        media: oneOf(S.STRUCT_MEDIA),
        repeat: oneOf(S.COUNT_BUCKETS),
        truncated: bool,
        c: (v, q) => {
          if (!Array.isArray(v)) fail(q, "배열 아님");
          (v as unknown[]).forEach((ch, i) => walk(ch, `${q}[${i}]`, depth + 1));
        },
      },
      ["role", "probes", "text", "media", "repeat", "truncated", "c"],
    )(n, path);
  };
  walk(x, p, 1);
};

const fileV = obj({
  diagnosticSchemaVersion: int(1, 1000),
  extensionVersion: version,
  adapterVersion: version,
  parserVersion: (x, p) => {
    if (typeof x !== "string" || !/^[a-z-]+\/\d+$/.test(x)) fail(p, "버전 형식");
  },
  probeSuiteVersion: version,
  environment: obj({ browser: oneOf(S.BROWSERS), browserMajor: int(0, 999), uiLang: oneOf(S.UI_LANGS), screen: oneOf(S.SCREEN_BUCKETS) }),
  job: obj({
    scope: oneOf(S.SCOPES),
    tasks: oneOf(S.COUNT_BUCKETS),
    succeeded: oneOf(S.COUNT_BUCKETS),
    partial: oneOf(S.COUNT_BUCKETS),
    failed: oneOf(S.COUNT_BUCKETS),
    skipped: oneOf(S.COUNT_BUCKETS),
    userVerified: oneOf(S.COUNT_BUCKETS),
  }),
  events: arr(eventV, 500),
  structure: (x, p) => {
    if (x !== null) structV(x, p);
  },
});

export function validateStructure(x: unknown): S.StructNode {
  structV(x, "structure");
  return x as S.StructNode;
}

export function validateEvent(e: unknown): S.DiagEvent {
  eventV(e, "event");
  return e as S.DiagEvent;
}

/** 허용 목록과 별개로 한 번 더 보는 보조 검사: 주소·메일·긴 숫자·한글·토큰 모양 */
const SUSPICIOUS = [/https?:|www\.|:\/\//i, /[\w.+-]+@[\w-]+\.[\w.]+/, /\d{7,}/, /[가-힣ㄱ-ㆎ]/, /[A-Za-z0-9_-]{32,}/, /eyJ[A-Za-z0-9_-]{10,}/];

/**
 * 진단 파일 문자열을 만든다. 미리보기와 저장 파일이 같은 문자열을 쓴다(D04).
 * 스키마·보조 검사 중 하나라도 걸리면 예외(D03).
 */
export function serializeDiagnostic(file: S.DiagnosticFile): string {
  fileV(file, "file");
  const text = JSON.stringify(file, null, 2);
  for (const re of SUSPICIOUS) if (re.test(text)) throw new DiagSchemaError("진단 파일 검사 실패: 개인정보처럼 보이는 문자열이 있어 저장을 막았습니다.");
  return text;
}

export { DiagSchemaError };
export const DIAG_FILE_NAME = "AFTERLOG_diagnostic_v1.json";
