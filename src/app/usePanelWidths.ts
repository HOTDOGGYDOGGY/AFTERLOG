import { useCallback, useEffect, useState } from "react";

const KEY = "afterlog.panels";
interface Widths {
  left: number;
  right: number;
  leftCollapsed: boolean;
}
const DEF: Widths = { left: 300, right: 280, leftCollapsed: false };
const LIMITS = { left: [220, 520], right: [220, 480] } as const;

function read(): Widths {
  try {
    return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEF;
  }
}

/** 좌우 패널 폭(최소·최대 제한, 접기, 브라우저에 기억) */
export function usePanelWidths() {
  const [w, setW] = useState<Widths>(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(w));
    } catch {
      /* 기억하지 못해도 동작에는 문제 없음 */
    }
  }, [w]);

  const startDrag = useCallback((side: "left" | "right", e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = side === "left" ? w.left : w.right;
    const [lo, hi] = LIMITS[side];
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const next = Math.max(lo, Math.min(hi, side === "left" ? start + dx : start - dx));
      setW((cur) => ({ ...cur, [side]: next }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [w.left, w.right]);

  const nudge = useCallback((side: "left" | "right", delta: number) => {
    const [lo, hi] = LIMITS[side];
    setW((cur) => ({ ...cur, [side]: Math.max(lo, Math.min(hi, cur[side] + delta)) }));
  }, []);

  const toggleLeft = useCallback(() => setW((cur) => ({ ...cur, leftCollapsed: !cur.leftCollapsed })), []);
  return { widths: w, startDrag, nudge, toggleLeft };
}
