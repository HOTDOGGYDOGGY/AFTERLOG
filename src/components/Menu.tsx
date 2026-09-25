import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  hint?: string;
}

/** 화면 좌표에 뜨는 메뉴. 키보드(↑↓ Enter Esc)로 조작 가능 */
export function PopupMenu({ x, y, items, onClose, label }: { x: number; y: number; items: MenuItem[]; onClose(): void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    el.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const n = e.key === "ArrowDown" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[n]?.focus();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="ui-menu" role="menu" aria-label={label} style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ui-menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={it.danger ? "is-danger" : undefined}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect?.();
            }}
          >
            <span>{it.label}</span>
            {it.hint ? <kbd>{it.hint}</kbd> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

export function MenuButton({ items, label, children, className }: { items: () => MenuItem[]; label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        className={className ?? "ui-icon-btn"}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setOpen({ x: r.left, y: r.bottom + 4 });
        }}
      >
        {children}
      </button>
      {open ? <PopupMenu x={open.x} y={open.y} items={items()} label={label} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
