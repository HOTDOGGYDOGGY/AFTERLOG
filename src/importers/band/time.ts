import type { TimeValue } from "../../domain/types";

const FULL_RE = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*(오전|오후)\s*(\d{1,2}):(\d{2}))?/;
const DOT_RE = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*(\d{1,2}):(\d{2}))?/;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 한국어 날짜 표기 해석.
 * - 연도가 없는 표기("2월 11일 오전 7:22"), 상대 시간("3시간 전")은 local=null로 둔다.
 * - 시각이 없으면 날짜만 ("YYYY-MM-DD").
 */
export function parseKoreanDateTime(raw: string, basis?: string): TimeValue {
  const s = raw.trim();
  let m = s.match(FULL_RE);
  if (m) {
    const [, y, mo, d, ampm, h, mi] = m;
    if (!ampm) return { raw: s, local: `${y}-${pad(+mo)}-${pad(+d)}`, basis };
    let hour = Number(h) % 12;
    if (ampm === "오후") hour += 12;
    return { raw: s, local: `${y}-${pad(+mo)}-${pad(+d)}T${pad(hour)}:${mi}`, basis };
  }
  m = s.match(DOT_RE);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    return { raw: s, local: h ? `${y}-${pad(+mo)}-${pad(+d)}T${pad(+h)}:${mi}` : `${y}-${pad(+mo)}-${pad(+d)}`, basis };
  }
  return { raw: s, local: null, basis };
}

/** 표시용: 원문 표기를 우선한다 */
export function formatTime(t: TimeValue | null): string {
  if (!t) return "";
  return t.raw;
}
