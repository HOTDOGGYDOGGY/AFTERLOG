import { useEffect, useRef, useState } from "react";

const PALETTE = ["#d9480f", "#e67700", "#2b8a3e", "#0c8599", "#1971c2", "#5f3dc4", "#9c36b5", "#c2255c", "#495057", "#212529"];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** 작은 견본 + 팝오버 + HEX 입력 */
export function ColorPicker({ value, onChange, label }: { value: string | null; onChange(v: string | null): void; label: string }) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value ?? "");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setHex(value ?? ""), [value]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="ui-color" ref={ref}>
      <button
        type="button"
        className="ui-swatch"
        style={{ background: value ?? "transparent" }}
        aria-label={`${label}: ${value ?? "기본"}`}
        title={`${label}: ${value ?? "기본"}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {value ? null : <span aria-hidden="true">·</span>}
      </button>
      {open ? (
        <div className="ui-color-pop" role="dialog" aria-label={label}>
          <div className="ui-color-grid">
            {PALETTE.map((c) => (
              <button key={c} type="button" className="ui-swatch" style={{ background: c }} aria-label={c} title={c} onClick={() => onChange(c)} />
            ))}
          </div>
          <div className="ui-color-row">
            <input
              aria-label="HEX 색상"
              value={hex}
              placeholder="#000000"
              maxLength={7}
              onChange={(e) => {
                setHex(e.target.value);
                if (HEX.test(e.target.value)) onChange(e.target.value.toLowerCase());
              }}
            />
            <button type="button" className="ui-btn ui-btn-small" onClick={() => onChange(null)}>
              기본색
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
