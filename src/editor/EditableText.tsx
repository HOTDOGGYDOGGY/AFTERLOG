import { useLayoutEffect, useRef } from "react";
import { caret, ime } from "./ime";

interface Props {
  value: string;
  onChange(text: string): void;
  readOnly?: boolean;
  entryId: string;
  blockIndex: number;
  label?: string;
}

function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return 0;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

/**
 * 상태 모델에 순수 텍스트로 반영되는 편집 영역.
 * DOM을 제어 컴포넌트로 다시 그리지 않아 커서·한글 조합이 깨지지 않는다.
 * 실행취소 등 외부에서 값이 바뀐 경우에만 내용을 교체한다.
 */
export function EditableText({ value, onChange, readOnly, entryId, blockIndex, label }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const composing = useRef(false);
  const lastEmitted = useRef(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const external = value !== lastEmitted.current;
    if (el.textContent !== value && (external || document.activeElement !== el)) {
      el.textContent = value;
    }
    lastEmitted.current = value;
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const t = (el.innerText ?? el.textContent ?? "").replace(/\r/g, "");
    if (t === lastEmitted.current) return;
    lastEmitted.current = t;
    onChange(t);
  };
  const remember = () => {
    const el = ref.current;
    if (!el) return;
    caret.entryId = entryId;
    caret.blockIndex = blockIndex;
    caret.offset = caretOffset(el);
  };

  return (
    <span
      ref={ref}
      className="al-editable"
      role="textbox"
      aria-multiline="true"
      aria-label={label ?? "본문"}
      contentEditable={readOnly ? false : ("plaintext-only" as unknown as boolean)}
      suppressContentEditableWarning
      spellCheck={false}
      onInput={() => {
        if (!composing.current) emit();
      }}
      onCompositionStart={() => {
        composing.current = true;
        ime.composing++;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        ime.composing = Math.max(0, ime.composing - 1);
        emit();
      }}
      onBlur={() => {
        if (composing.current) {
          composing.current = false;
          ime.composing = Math.max(0, ime.composing - 1);
        }
        emit();
      }}
      onKeyUp={remember}
      onMouseUp={remember}
      onFocus={remember}
      onPaste={(e) => {
        // 서식 없는 텍스트만 받는다
        e.preventDefault();
        const t = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, t);
      }}
    />
  );
}
