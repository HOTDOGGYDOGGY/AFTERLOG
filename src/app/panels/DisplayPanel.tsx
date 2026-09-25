import * as C from "../../editor/commands";
import { defaultViewSettings, type ViewSettings } from "../../domain/types";
import type { DocEditor } from "../useDocEditor";

const SIZE_LABELS: [keyof ViewSettings["sizes"], string, number, number][] = [
  ["base", "전체", 10, 24],
  ["name", "이름", 10, 24],
  ["desc", "프로필 설명", 8, 20],
  ["body", "본문", 10, 28],
  ["comment", "댓글", 10, 28],
];

const SHOW_LABELS: [keyof ViewSettings["show"], string][] = [
  ["date", "날짜"],
  ["readCount", "읽음 수"],
  ["reactions", "표정·댓글 수"],
  ["description", "프로필 설명"],
  ["excerpt", "원글 발췌 (댓글 모음)"],
];

export function DisplayPanel({ editor }: { editor: DocEditor }) {
  const v = editor.doc.view;
  const ro = !!editor.readOnly;
  const set = (fn: (v: ViewSettings) => void, key?: string) => editor.apply((d) => C.updateView(d, fn), key);
  return (
    <div className="display-panel">
      <fieldset className="field" disabled={ro}>
        <legend>출력 테마</legend>
        <div className="seg">
          {(["light", "dark"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={v.theme === t} onClick={() => set((x) => void (x.theme = t))}>
              {t === "light" ? "라이트" : "다크"}
            </button>
          ))}
        </div>
        <small className="muted">편집기 화면 테마와 별개입니다.</small>
      </fieldset>

      <label className="field">
        <span>글꼴</span>
        <select value={v.fontFamily} disabled={ro} onChange={(e) => set((x) => void (x.fontFamily = e.target.value as ViewSettings["fontFamily"]))}>
          <option value="system">기본 고딕</option>
          <option value="serif">명조</option>
          <option value="mono">고정폭</option>
        </select>
        <small className="muted">외부 글꼴을 쓰지 않아 오프라인 HTML에서도 같게 보입니다.</small>
      </label>

      <fieldset className="field" disabled={ro}>
        <legend>글자 크기</legend>
        <label className="check">
          <input type="checkbox" checked={v.linkedSizes} onChange={(e) => set((x) => void (x.linkedSizes = e.target.checked))} />
          전체 크기에 맞춰 함께 조절
        </label>
        {SIZE_LABELS.map(([k, label, min, max]) => (
          <div key={k} className="size-row">
            <span>{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              value={v.sizes[k]}
              aria-label={`${label} 크기`}
              onChange={(e) => {
                const n = Number(e.target.value);
                set((x) => {
                  if (k === "base" && x.linkedSizes) {
                    const diff = n - x.sizes.base;
                    for (const key of Object.keys(x.sizes) as (keyof ViewSettings["sizes"])[]) {
                      const [, , lo, hi] = SIZE_LABELS.find((s) => s[0] === key)!;
                      x.sizes[key] = Math.max(lo, Math.min(hi, x.sizes[key] + diff));
                    }
                    x.sizes.base = n;
                  } else x.sizes[k] = n;
                }, `size:${k}`);
              }}
            />
            <output>{v.sizes[k]}</output>
          </div>
        ))}
      </fieldset>

      <label className="field">
        <span>출력 너비 ({v.width}px)</span>
        <input type="range" min={360} max={960} step={10} value={v.width} disabled={ro} onChange={(e) => set((x) => void (x.width = Number(e.target.value)), "width")} />
      </label>

      <fieldset className="field" disabled={ro}>
        <legend>표시할 정보</legend>
        {SHOW_LABELS.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={v.show[k]} onChange={(e) => set((x) => void (x.show[k] = e.target.checked))} />
            {label}
          </label>
        ))}
        <small className="muted">끄면 화면에서만 빠지고 자료는 그대로 남습니다.</small>
      </fieldset>

      <label className="field">
        <span>확보되지 않은 이미지</span>
        <select value={v.missingImages} disabled={ro} onChange={(e) => set((x) => void (x.missingImages = e.target.value as ViewSettings["missingImages"]))}>
          <option value="placeholder">자리 표시 남기기 (기본)</option>
          <option value="omit">내보낼 때 빼기</option>
        </select>
      </label>

      <button
        type="button"
        className="ui-btn"
        disabled={ro}
        onClick={() =>
          set((x) => {
            Object.assign(x, defaultViewSettings());
          })
        }
      >
        표시 설정 초기화
      </button>
      <small className="muted">본문·인물·이미지는 바뀌지 않습니다.</small>
    </div>
  );
}
