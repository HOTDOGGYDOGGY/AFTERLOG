// 수치 조절: 라벨 + 짧은 슬라이더 + 단위가 있는 숫자 입력 + 기본값 복귀(명세 6.2).
// 드래그 한 번은 같은 묶음 키로 기록돼 실행취소 한 단계가 된다.
import { useId } from "react";

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  onChange,
  defaultValue,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange(v: number): void;
  defaultValue?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="ui-slider">
      <label htmlFor={id}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="ui-slider-num">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
        />
        <span className="unit">{unit}</span>
      </span>
      {defaultValue !== undefined && defaultValue !== value ? (
        <button type="button" className="ui-link small" disabled={disabled} onClick={() => onChange(defaultValue)} title={`기본값 ${defaultValue}${unit}로`}>
          기본
        </button>
      ) : (
        <span className="ui-slider-pad" />
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange(v: T): void;
  disabled?: boolean;
}) {
  return (
    <div className="ui-seg-row">
      <span className="ui-seg-label">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} aria-pressed={value === v} disabled={disabled} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
