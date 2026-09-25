// 구조화 프로필을 프로젝트에 넣기(저장 HTML 가져오기용). 같은 인물(band+member)이 이미 있으면 새 관측으로 보태고, 식별자가 없으면 새로 둔다.
import { newId, nowIso } from "../../domain/ids";
import type { SourceImport } from "../../domain/types";
import { db } from "../../storage/db";
import { sha256Hex } from "../../storage/hash";
import { addAsset } from "../../storage/repo";
import { BAND_PROFILE_SCHEMA, BAND_PROFILE_SOURCE_KIND, bandMemberKey, isBandProfileRecord, mergeProfileRecords, profileImages, type BandProfileRecord } from "./profile";
import { safeName } from "../../exporters/fileName";

/** 저장 페이지의 이미지 파일(파일명 → 데이터)을 자산으로 넣고 참조에 해시를 적는다. 파일이 없으면 미확보로 둔다 */
export async function attachProfileImages(projectId: string, record: BandProfileRecord, images: Map<string, Blob>): Promise<BandProfileRecord> {
  const r: BandProfileRecord = structuredClone(record);
  for (const ref of profileImages(r)) {
    const blob = ref.ref ? images.get(ref.ref) : undefined;
    if (!blob) continue;
    try {
      ref.sha256 = (await addAsset(projectId, blob, ref.ref!)).sha256;
    } catch {
      /* 이미지가 아닌 파일은 연결하지 않음 */
    }
  }
  return r;
}

export async function storeProfileRecord(projectId: string, record: BandProfileRecord, sourceUrl?: string | null): Promise<"added" | "updated" | "same"> {
  const d = db();
  const key = bandMemberKey(record);
  if (key) {
    const olds = (await d.sources.where("projectId").equals(projectId).toArray()).filter((x) => String(x.kind ?? "") === BAND_PROFILE_SOURCE_KIND);
    for (const o of olds) {
      let rec: unknown = null;
      try {
        rec = JSON.parse(await o.blob.text());
      } catch {
        continue;
      }
      if (!isBandProfileRecord(rec) || bandMemberKey(rec) !== key) continue;
      const m = mergeProfileRecords(rec, record);
      if (!m.changed) return "same";
      const bytes = new TextEncoder().encode(JSON.stringify(m.record));
      await d.sources.put({ ...o, blob: new Blob([bytes], { type: "application/json" }), sha256: await sha256Hex(bytes) });
      return "updated";
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  const src: SourceImport = {
    id: newId(),
    projectId,
    fileName: `프로필_${safeName(record.name ?? "인물").slice(0, 40)}.json`,
    mime: "application/json",
    importedAt: nowIso(),
    parserVersion: BAND_PROFILE_SCHEMA,
    sha256: await sha256Hex(bytes),
    blob: new Blob([bytes], { type: "application/json" }),
    kind: BAND_PROFILE_SOURCE_KIND as SourceImport["kind"],
    sourceUrl: record.profileUrl ?? record.sourceUrl ?? sourceUrl ?? undefined,
  };
  await d.sources.add(src);
  return "added";
}
