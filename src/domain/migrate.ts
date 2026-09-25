import { defaultViewSettings, type DocumentData } from "./types";

/**
 * 저장된 문서를 현재 스키마로 맞춘다. 빠진 필드는 기본값으로 채우고 기존 값은 바꾸지 않는다.
 * (스키마 1 안에서 추가된 선택 필드용. 구조가 바뀌면 SCHEMA_VERSION을 올리고 여기서 변환한다.)
 */
export function normalizeDocument(doc: DocumentData): DocumentData {
  const def = defaultViewSettings();
  const view = { ...def, ...doc.view, sizes: { ...def.sizes, ...doc.view?.sizes }, show: { ...def.show, ...doc.view?.show } };
  const entries: DocumentData["entries"] = {};
  let changed = JSON.stringify(view) !== JSON.stringify(doc.view);
  for (const [id, e] of Object.entries(doc.entries)) {
    const meta = e.meta as DocumentData["entries"][string]["meta"] & { emotionCount?: number };
    if ("emotionCount" in meta) {
      // 초기 버전은 표정 레이어 버튼 값을 숫자로 저장했다. 확정값이 아니므로 미확보로 옮긴다.
      const { emotionCount, ...rest } = meta;
      entries[id] = {
        ...e,
        meta: rest,
        reactions: e.reactions ?? {
          status: "unknown",
          total: null,
          kinds: [],
          reactors: "unknown",
          evidence: `이전 버전이 저장한 값 ${emotionCount} (확정 아님)`,
        },
      };
      changed = true;
    } else entries[id] = e;
  }
  return changed ? { ...doc, view, entries } : doc;
}
