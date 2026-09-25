import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as C from "../editor/commands";
import { EditableText } from "../editor/EditableText";
import { caret } from "../editor/ime";
import { ROOT, type DocumentData, type Entry } from "../domain/types";
import { findParent } from "../domain/validate";
import { BandView, type BandEditHooks } from "../renderers/band/BandView";
import { MenuButton, PopupMenu, type MenuItem } from "../components/Menu";
import type { DocEditor } from "./useDocEditor";
import { Icon } from "../components/Icon";

interface Props {
  editor: DocEditor;
  assetUrl(id: string): string | undefined;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onInsertImage(entryId: string): void;
  appTheme: "light" | "dark";
}

const DRAG_TYPE = "application/x-afterlog-entry";

/** 항목 메뉴(점 세 개·우클릭·키보드 공통) */
export function entryMenuItems(doc: DocumentData, entry: Entry, editor: DocEditor, onInsertImage: (id: string) => void, onSelect: (id: string | null) => void): MenuItem[] {
  const parent = findParent(doc, entry.id);
  const siblings = parent ? doc.children[parent] : [];
  const idx = siblings.indexOf(entry.id);
  const isPost = entry.kind === "post";
  const prevSibling = idx > 0 ? siblings[idx - 1] : null;
  const post = (doc.children[ROOT] ?? []).find((id) => doc.entries[id]?.kind === "post") ?? null;
  const parentEntry = parent && parent !== ROOT ? doc.entries[parent] : null;
  const canSplit = caret.entryId === entry.id && entry.blocks[caret.blockIndex]?.type === "text";
  const kids = doc.children[entry.id]?.length ?? 0;
  return [
    { label: "위로 이동", hint: "Alt+↑", disabled: idx <= 0, onSelect: () => editor.apply((d) => C.moveBy(d, entry.id, -1)) },
    { label: "아래로 이동", hint: "Alt+↓", disabled: idx < 0 || idx >= siblings.length - 1, onSelect: () => editor.apply((d) => C.moveBy(d, entry.id, 1)) },
    { separator: true, label: "" },
    {
      label: "바로 위 댓글의 답글로",
      disabled: isPost || !prevSibling || doc.inputFormat !== "band-post",
      onSelect: () => prevSibling && editor.apply((d) => C.setParent(d, entry.id, prevSibling)),
    },
    {
      label: "답글 → 댓글로 올리기",
      disabled: isPost || !parentEntry || parentEntry.kind === "post" || !post,
      onSelect: () => {
        if (!parent || !post) return;
        const grand = findParent(doc, parent) ?? post;
        const at = doc.children[grand].indexOf(parent) + 1;
        editor.apply((d) => C.moveEntry(d, entry.id, grand, at));
      },
    },
    { separator: true, label: "" },
    { label: "커서 위치에서 나누기", disabled: !canSplit, onSelect: () => editor.apply((d) => C.splitEntry(d, entry.id, caret.blockIndex, caret.offset)) },
    { label: "다음 항목과 합치기", disabled: idx < 0 || idx >= siblings.length - 1, onSelect: () => editor.apply((d) => C.mergeWithNext(d, entry.id)) },
    { label: "이미지 넣기…", onSelect: () => onInsertImage(entry.id) },
    { label: "복제", disabled: isPost, onSelect: () => editor.apply((d) => C.duplicateEntry(d, entry.id)) },
    { label: "원본 내용으로 되돌리기", onSelect: () => editor.apply((d) => C.restoreOriginal(d, entry.id)) },
    { separator: true, label: "" },
    {
      label: kids ? `삭제 (답글 ${kids}개도 함께)` : "삭제",
      danger: true,
      disabled: isPost,
      onSelect: () => {
        onSelect(null);
        editor.apply((d) => C.deleteEntry(d, entry.id, "with-children"));
      },
    },
    ...(kids
      ? [
          {
            label: "삭제 (답글은 위 단계로 올림)",
            danger: true,
            onSelect: () => {
              onSelect(null);
              editor.apply((d) => C.deleteEntry(d, entry.id, "promote-children"));
            },
          },
        ]
      : []),
  ];
}

/**
 * 출력 폭과 화면 배율을 분리한다(V04): 공간이 충분하면 지정 폭(CSS px) 그대로, 좁으면 맞춤 배율로 줄이고 배율을 표시한다.
 * 배율은 화면 표시일 뿐 출력 설정을 바꾸지 않는다.
 */
export function useFitScale(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const avail = el.clientWidth - 32;
      setScale(avail > 0 && avail < width ? Math.max(0.4, avail / width) : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return { ref, scale };
}

export function Preview({ editor, assetUrl, selectedId, onSelect, onInsertImage, appTheme }: Props) {
  const { doc } = editor;
  const ro = !!editor.readOnly;
  const [ctx, setCtx] = useState<{ x: number; y: number; entryId: string } | null>(null);
  const [drop, setDrop] = useState<BandEditHooks["dropIndicator"]>(null);

  const canDrop = useCallback(
    (dragId: string, targetId: string) => {
      if (dragId === targetId) return false;
      const a = doc.entries[dragId];
      const b = doc.entries[targetId];
      if (!a || !b) return false;
      return (a.kind === "post") === (b.kind === "post");
    },
    [doc],
  );

  const hooks: BandEditHooks = useMemo(
    () => ({
      selectedId,
      onSelect: (id) => onSelect(id),
      dropIndicator: drop,
      renderText: (entry, i, text) => (
        <EditableText
          key={`${entry.id}:${i}`}
          value={text}
          readOnly={ro}
          entryId={entry.id}
          blockIndex={i}
          onChange={(t) => editor.apply((d) => C.editTextBlock(d, entry.id, i, t), `text:${entry.id}:${i}`)}
        />
      ),
      renderTools: (entry) =>
        ro ? null : (
          <span className="al-tools" onClick={(e) => e.stopPropagation()}>
            <span
              className="ui-icon-btn al-drag"
              draggable
              role="button"
              tabIndex={-1}
              aria-label="끌어서 옮기기"
              title="끌어서 옮기기"
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, entry.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDrop(null)}
            >
              <Icon name="drag" size={16} />
            </span>
            <MenuButton label="항목 메뉴" items={() => entryMenuItems(doc, entry, editor, onInsertImage, onSelect)}>
              <Icon name="more" size={16} />
            </MenuButton>
          </span>
        ),
      entryProps: (entry) => ({
        onContextMenu: (e) => {
          if (ro) return;
          e.preventDefault();
          e.stopPropagation();
          onSelect(entry.id);
          setCtx({ x: e.clientX, y: e.clientY, entryId: entry.id });
        },
        onDragOver: (e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const pos = e.clientY < r.top + r.height / 2 ? "before" : "after";
          if (drop?.id !== entry.id || drop.pos !== pos) setDrop({ id: entry.id, pos });
        },
        onDragLeave: (e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop((d) => (d?.id === entry.id ? null : d));
        },
        onDrop: (e) => {
          const dragId = e.dataTransfer.getData(DRAG_TYPE);
          setDrop(null);
          if (!dragId) return;
          e.preventDefault();
          e.stopPropagation();
          if (!canDrop(dragId, entry.id)) return;
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const after = e.clientY >= r.top + r.height / 2;
          const parent = findParent(doc, entry.id);
          if (!parent) return;
          const at = doc.children[parent].indexOf(entry.id) + (after ? 1 : 0);
          editor.apply((d) => C.moveEntry(d, dragId, parent, at));
        },
        onKeyDown: (e) => {
          if (ro || !e.altKey) return;
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            editor.apply((d) => C.moveBy(d, entry.id, e.key === "ArrowUp" ? -1 : 1));
          }
        },
        tabIndex: 0,
        "aria-selected": selectedId === entry.id,
      }),
    }),
    [doc, editor, selectedId, onSelect, onInsertImage, drop, ro, canDrop],
  );

  const ctxEntry = ctx ? doc.entries[ctx.entryId] : null;
  const fit = useFitScale(doc.view.width);
  return (
    <div className="preview-scroll" ref={fit.ref} onClick={() => onSelect(null)}>
      {fit.scale < 1 ? (
        <p className="fit-note small muted" role="status">
          화면에 맞춰 {Math.round(fit.scale * 100)}%로 보는 중 · 출력 폭 {doc.view.width}px는 그대로
        </p>
      ) : null}
      <div className="preview-page" style={{ width: doc.view.width, zoom: fit.scale < 1 ? fit.scale : undefined }}>
        <BandView doc={doc} mode="edit" appTheme={appTheme} assetUrl={assetUrl} edit={hooks} />
      </div>
      {ctx && ctxEntry ? (
        <PopupMenu x={ctx.x} y={ctx.y} label="항목 메뉴" items={entryMenuItems(doc, ctxEntry, editor, onInsertImage, onSelect)} onClose={() => setCtx(null)} />
      ) : null}
    </div>
  );
}
