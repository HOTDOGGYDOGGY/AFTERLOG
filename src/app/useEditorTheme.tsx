import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const KEY = "afterlog.editorTheme";
const LABEL: Record<Mode, string> = { system: "시스템", light: "라이트", dark: "다크" };

/** 편집기 화면 테마(출력 테마와 별개) */
export function useEditorTheme() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return (localStorage.getItem(KEY) as Mode) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* 무시 */
    }
  }, [mode]);
  const next: Mode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
  const toggle = (
    <button type="button" className="ui-btn" title={`편집기 테마: ${LABEL[mode]} (눌러서 ${LABEL[next]})`} aria-label={`편집기 테마 ${LABEL[mode]}`} onClick={() => setMode(next)}>
      화면 {LABEL[mode]}
    </button>
  );
  return { mode, toggle };
}
