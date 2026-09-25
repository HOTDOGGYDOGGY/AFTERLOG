import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentData } from "../domain/types";
import { commit, initHistory, redo as redoH, undo as undoH, type HistoryState } from "../editor/history";
import { ime } from "../editor/ime";
import { describeStorageError } from "../storage/db";
import { ConflictError, saveDocument } from "../storage/repo";
import { db } from "../storage/db";
import { normalizeDocument } from "../domain/migrate";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export interface ReadOnlyReason {
  kind: "other-tab" | "conflict";
  message: string;
}

const TAB_ID = crypto.randomUUID();
const channel: BroadcastChannel | null = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("afterlog") : null;
type Msg = { type: "claim" | "saved"; docId: string; tabId: string; revision?: number };

const SAVE_DELAY = 700;

export function useDocEditor(initial: DocumentData) {
  const [h, setH] = useState<HistoryState>(() => initHistory(initial));
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState<ReadOnlyReason | null>(null);
  const revRef = useRef(initial.revision);
  const savedDocRef = useRef<DocumentData>(initial);
  const docRef = useRef(h.doc);
  docRef.current = h.doc;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<void> | null>(null);

  const apply = useCallback((fn: (d: DocumentData) => DocumentData, coalesceKey?: string) => {
    if (readOnlyRef.current) return;
    setH((cur) => commit(cur, fn(cur.doc), coalesceKey));
  }, []);
  const undo = useCallback(() => !readOnlyRef.current && setH((cur) => undoH(cur)), []);
  const redo = useCallback(() => !readOnlyRef.current && setH((cur) => redoH(cur)), []);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (saving.current) await saving.current;
    const doc = docRef.current;
    if (doc === savedDocRef.current || readOnlyRef.current) return;
    setStatus("saving");
    const run = (async () => {
      try {
        const next = await saveDocument(doc, revRef.current);
        revRef.current = next;
        savedDocRef.current = doc;
        setError(null);
        setStatus(docRef.current === doc ? "saved" : "dirty");
        channel?.postMessage({ type: "saved", docId: doc.id, tabId: TAB_ID, revision: next } satisfies Msg);
      } catch (e) {
        if (e instanceof ConflictError) {
          setReadOnly({ kind: "conflict", message: e.message });
        }
        setError(describeStorageError(e));
        setStatus("error");
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, []);

  // 변경 → 잠시 멈추면 자동 저장. 한글 조합 중에는 미룬다.
  useEffect(() => {
    if (h.doc === savedDocRef.current) return;
    setStatus((s) => (s === "saving" ? s : "dirty"));
    const schedule = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (ime.composing > 0) schedule();
        else void flush();
      }, SAVE_DELAY);
    };
    schedule();
    return () => window.clearTimeout(timer.current);
  }, [h.doc, flush]);

  // 다른 탭과의 편집 충돌 방지: 같은 문서를 새로 연 탭이 편집권을 가져간다.
  useEffect(() => {
    const docId = initial.id;
    channel?.postMessage({ type: "claim", docId, tabId: TAB_ID } satisfies Msg);
    const onMsg = (ev: MessageEvent<Msg>) => {
      const m = ev.data;
      if (!m || m.docId !== docId || m.tabId === TAB_ID) return;
      if (m.type === "claim") setReadOnly({ kind: "other-tab", message: "다른 탭에서 이 문서를 열었습니다. 이 탭은 읽기 전용입니다." });
      if (m.type === "saved" && (m.revision ?? 0) > revRef.current)
        setReadOnly({ kind: "other-tab", message: "다른 탭에서 이 문서를 수정했습니다. 이 탭은 읽기 전용입니다." });
    };
    channel?.addEventListener("message", onMsg);
    return () => channel?.removeEventListener("message", onMsg);
  }, [initial.id]);

  // 닫기 전 저장 안 된 변경 경고 (탭 종료 이벤트만 믿지 않고 평소에 저장한다)
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (docRef.current !== savedDocRef.current && !readOnlyRef.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [flush]);

  // 문서를 닫을 때(다른 문서로 전환·가져오기 후 새로 열기) 남은 변경을 저장
  useEffect(() => () => void flush(), [flush]);

  /** 편집권 가져오기: 저장소의 최신 상태를 다시 읽고 이 탭에서 편집을 이어간다 */
  const takeOver = useCallback(async () => {
    const stored = await db().documents.get(initial.id);
    if (!stored) return;
    const fresh = normalizeDocument(stored);
    revRef.current = fresh.revision;
    savedDocRef.current = fresh;
    setH(initHistory(fresh));
    setReadOnly(null);
    setError(null);
    setStatus("saved");
    channel?.postMessage({ type: "claim", docId: initial.id, tabId: TAB_ID } satisfies Msg);
  }, [initial.id]);

  return {
    doc: h.doc,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    apply,
    undo,
    redo,
    status,
    error,
    readOnly,
    takeOver,
    flush,
  };
}

export type DocEditor = ReturnType<typeof useDocEditor>;
