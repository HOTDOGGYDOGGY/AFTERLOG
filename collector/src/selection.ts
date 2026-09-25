// 선택 수집(선택 수집 명세 v1.0) 도우미: 조건 요약, 댓글 관측과 저장된 원글의 대조.
import { blocksToPlainText, parseBandHtml } from "../../src/importers/band/html";
import type { Capture, CommentObservation, Selection } from "./db";

/** 비교용 정규화(NFC, 공백 제거). 원문은 바꾸지 않는다 */
export const normText = (s: string) => s.normalize("NFC").replace(/\s+/g, "");

/** 목록 글자가 말줄임으로 끝나면 앞부분만 비교한다 */
function sameText(list: string, full: string) {
  const a = normText(list);
  const b = normText(full);
  if (!a) return false;
  if (a === b) return true;
  const cut = a.replace(/(\.\.\.|…)+$/, "");
  return cut.length >= 8 && cut !== a && b.startsWith(cut);
}

/**
 * 댓글 목록에서 본 댓글이 이 원글 저장본 안에 같은 인물의 댓글로 있는가.
 * 인물은 목록 머리글의 이름으로 맞추고(같은 밴드·같은 원글 안), 글자와(둘 다 있으면) 작성 시각이 같아야 한다.
 */
export function commentInCapture(ob: Pick<CommentObservation, "text" | "local" | "memberName">, capture: Pick<Capture, "html">): boolean {
  const doc = parseBandHtml(capture.html).documents.find((d) => d.format === "band-post");
  if (!doc) return false;
  const nameOf = (key: string | null) => (key ? doc.identities.find((i) => i.key === key)?.name ?? null : null);
  return doc.entries.some((e) => {
    if (e.kind === "post") return false;
    if (ob.memberName && normText(nameOf(e.authorKey) ?? "") !== normText(ob.memberName)) return false;
    if (!sameText(ob.text, blocksToPlainText(e.blocks))) return false;
    const t = e.time?.local;
    if (ob.local && t && ob.local.length >= 16 && t.length >= 16 && ob.local.slice(0, 16) !== t.slice(0, 16)) return false;
    return true;
  });
}

/** 선택 내용을 한 문장으로(6절). 이름을 모르면 '선택한 인물' */
export function describeSelection(sel: Selection): string {
  const who = sel.members.map((m) => m.name).filter(Boolean).join("·") || (sel.members.length > 1 ? `인물 ${sel.members.length}명` : "선택한 인물");
  const modes = [sel.authored ? "쓴 글" : "", sel.commentsOnly ? "쓴 댓글" : "", sel.commentedPosts ? "댓글 단 글" : ""].filter(Boolean);
  const period = sel.periodFrom || sel.periodTo ? ` · ${sel.periodFrom ?? "처음"}~${sel.periodTo ?? "지금"}` : "";
  return `${who}의 ${modes.join("·") || "(모드 없음)"}${period}`;
}
