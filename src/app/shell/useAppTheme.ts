import { useCallback, useEffect, useState } from "react";

/** 앱(편집기 화면) 테마. 기록 출력 테마와 별개로 저장한다(명세 27.4) */
export type AppThemeMode = "dark" | "light" | "system";
const KEY = "afterlog.appTheme";
const OLD_KEY = "afterlog.editorTheme";

function readMode(): AppThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
    // 예전 버전에서 명시적으로 고른 라이트/다크는 보존. 예전 기본값(system)은 선택으로 보지 않고 새 기본(다크)
    const old = localStorage.getItem(OLD_KEY);
    if (old === "light" || old === "dark") return old;
  } catch {
    /* 저장소를 못 쓰면 기본값 */
  }
  return "dark";
}

function systemDark() {
  return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
}

export function useAppTheme() {
  const [mode, setModeState] = useState<AppThemeMode>(readMode);
  const [sysDark, setSysDark] = useState(systemDark);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSysDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const resolved: "dark" | "light" = mode === "system" ? (sysDark ? "dark" : "light") : mode;
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);
  const setMode = useCallback((m: AppThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* 기억하지 못해도 동작에는 문제 없음 */
    }
  }, []);
  return { mode, resolved, setMode };
}
