/** 파일 이름: 글자·숫자·일부 기호만 남긴다(브라우저가 이름을 버리지 않도록) */
export function safeName(s: string) {
  const cleaned = s
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ()\[\]_-]+/gu, " ")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 50)
    .replace(/_+$/, "");
  return cleaned || "afterlog";
}
