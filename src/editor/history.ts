import type { DocumentData } from "../domain/types";

export const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

export interface HistoryState {
  doc: DocumentData;
  past: DocumentData[];
  future: DocumentData[];
  /** 연속 타이핑 묶기용 */
  lastKey: string | null;
  lastAt: number;
}

export function initHistory(doc: DocumentData): HistoryState {
  return { doc, past: [], future: [], lastKey: null, lastAt: 0 };
}

/**
 * 새 문서 상태를 기록한다. 같은 coalesceKey가 짧은 간격으로 이어지면(연속 타이핑) 한 단계로 묶는다.
 * 문서 객체는 immer 구조 공유라 스냅샷 비용이 작고, 이미지 Blob은 자산 ID로만 참조한다.
 */
export function commit(h: HistoryState, next: DocumentData, coalesceKey?: string, now = Date.now()): HistoryState {
  if (next === h.doc) return h;
  const merge = coalesceKey && coalesceKey === h.lastKey && now - h.lastAt < COALESCE_MS;
  const past = merge ? h.past : [...h.past, h.doc].slice(-HISTORY_LIMIT);
  return { doc: next, past, future: [], lastKey: coalesceKey ?? null, lastAt: now };
}

export function undo(h: HistoryState): HistoryState {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { doc: prev, past: h.past.slice(0, -1), future: [h.doc, ...h.future], lastKey: null, lastAt: 0 };
}

export function redo(h: HistoryState): HistoryState {
  const next = h.future[0];
  if (!next) return h;
  return { doc: next, past: [...h.past, h.doc], future: h.future.slice(1), lastKey: null, lastAt: 0 };
}
