// '직접 열며 수집'(인물 전체 수집 명세 7절). 사용자가 연 화면을 읽어 한 인물 아래에 누적한다. 자동 수집과 같은 해석기·합치기 규칙.
// - 범위: 첫 화면의 인물(밴드+식별자, 팝업이면 이름)을 대상으로 정하고, 다른 인물·다른 밴드 화면은 저장하지 않는다.
// - 같은 내용을 다시 보면 늘리지 않는다(중복 스킵). 새 스토리·댓글·전문·사진·정보 변화만 보탠다.
// - 해석하지 못하는 화면은 저장하지 않고 그렇다고 알린다(구조화 완료로 세지 않음).
import { cdb, type FollowKind, type FollowState, type ProfileCapture } from "./db";
import { COLLECTOR_VERSION } from "./config";
import { bandProfileUrl, memberPhotosStatus, mergeProfileRecords, parseBandProfileDocument, photoHistoryStatus, profileImages, profileNeedsMore, storyStatus, type BandProfileRecord } from "../../src/importers/band/profile";
import type { ProfileScreenRead } from "./page/profileScreen";

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFC").replace(/\s+/g, "");
const RANK = { profilePage: 3, profilePopup: 2, memberPage: 1 } as const;

export interface FollowOutcome {
  kind: FollowKind;
  text: string;
  /** 새로 받을 이미지 주소 */
  images: string[];
}

/** 대상 인물 범위 확인. 식별자가 없으면 이름으로만 비교하고, 한쪽만 식별자가 있으면 이름이 같을 때만 */
export function inScope(target: FollowState["target"], r: BandProfileRecord): { ok: boolean; why?: string } {
  if (!target) return { ok: true };
  if (target.bandNo && r.bandNo && target.bandNo !== r.bandNo) return { ok: false, why: "다른 밴드 화면" };
  if (target.memberKey && r.memberKey) return target.memberKey === r.memberKey ? { ok: true } : { ok: false, why: `다른 인물(${r.name ?? "이름 모름"})` };
  if (target.memberKey && !r.memberKey) return { ok: false, why: "인물을 확인할 수 없는 팝업(이름만으로는 같은 사람이라 확정하지 않음)" };
  if (!target.name || !r.name) return { ok: false, why: "이름을 확인하지 못함" };
  return norm(target.name) === norm(r.name) ? { ok: true } : { ok: false, why: `다른 인물(${r.name})` };
}

export async function applyFollowScreen(jobId: string, taskId: string, read: ProfileScreenRead, observedAt: string): Promise<FollowOutcome> {
  if (read.loginRequired) return { kind: "login", text: "로그인 화면입니다. 밴드에 로그인한 뒤 다시 여세요.", images: [] };
  const recs = read.html ? parseBandProfileDocument(new DOMParser().parseFromString(read.html, "text/html"), { pageUrl: read.pageUrl, observedAt }) : [];
  const rec = recs.sort((a, b) => RANK[b.surface] - RANK[a.surface])[0];
  if (!rec) {
    if (read.postOpen) return { kind: "post", text: "게시글 화면입니다. 글은 막대의 '이 글 저장'으로 저장하세요(이 모드는 프로필·스토리·사진첩).", images: [] };
    return { kind: "notProfile", text: "프로필·스토리·사진첩 화면이 아니라 저장하지 않았습니다.", images: [] };
  }
  const job = await cdb().jobs.get(jobId);
  const follow = job?.options.follow;
  if (!job || !follow) return { kind: "error", text: "작업을 찾지 못했습니다.", images: [] };
  const scope = inScope(follow.target, rec);
  if (!scope.ok) return { kind: "outOfScope", text: `범위 밖이라 저장하지 않음: ${scope.why}. 대상: ${follow.target?.name ?? "?"}`, images: [] };

  const old = await cdb().profiles.where("taskId").equals(taskId).first();
  let record: BandProfileRecord;
  let text: string;
  let changed = true;
  if (!old?.record) {
    record = rec;
    text = `저장: ${rec.name ?? "인물"} · ${storyStatus(rec).text}${rec.memberPhotos ? ` · ${memberPhotosStatus(rec).text}` : ""}`;
  } else {
    const m = mergeProfileRecords(old.record, rec);
    record = m.record;
    // 팝업(식별자 없음)으로 시작했다가 같은 이름의 프로필 화면에서 식별자를 얻으면 확인된 인물로
    if (!record.memberKey && rec.memberKey) {
      record = { ...record, bandNo: rec.bandNo, memberKey: rec.memberKey, identity: "confirmed", profileUrl: rec.profileUrl ?? bandProfileUrl(rec.bandNo!, rec.memberKey), notes: record.notes.filter((n) => !/연결 미확인/.test(n)) };
      changed = true;
    } else changed = m.changed;
    const parts = [
      m.storiesAdded ? `스토리 +${m.storiesAdded}` : "",
      m.textsCompleted ? `전문 보완 ${m.textsCompleted}` : "",
      m.commentsAdded ? `댓글 +${m.commentsAdded}` : "",
      m.photosAdded ? `사진첩 +${m.photosAdded}` : "",
      m.basicsChanged ? "기본 정보 변화" : "",
    ].filter(Boolean);
    text = changed ? `보탬: ${parts.join(" · ") || "상태 갱신"}` : "변화 없음(이미 저장한 내용, 중복 건너뜀)";
  }
  const target = follow.target ?? { bandNo: rec.bandNo, memberKey: rec.memberKey, name: rec.name };
  if (!target.memberKey && record.memberKey) Object.assign(target, { bandNo: record.bandNo, memberKey: record.memberKey });
  if (!changed) {
    await cdb().jobs.update(jobId, { options: { ...job.options, follow: { ...follow, target } } });
    return { kind: "same", text, images: [] };
  }
  const cap: ProfileCapture = {
    id: old?.id ?? crypto.randomUUID(),
    jobId,
    taskId,
    bandNo: record.bandNo ?? "",
    memberKey: record.memberKey ?? "",
    url: record.profileUrl ?? read.pageUrl,
    name: record.name,
    description: record.description,
    html: old?.html ?? "",
    css: "",
    cssTruncated: false,
    imageUrls: [...new Set([...(old?.imageUrls ?? []), ...read.imageUrls])],
    stories: [],
    capturedAt: observedAt,
    collectorVersion: COLLECTOR_VERSION,
    record,
    surface: RANK[record.surface] >= 2 ? (record.surface as "profilePage" | "profilePopup") : "profilePopup",
  };
  const images = [...new Set(profileImages(record).map((i) => i.src).filter((u) => /^https?:/.test(u)))];
  await cdb().transaction("rw", [cdb().profiles, cdb().tasks, cdb().jobs], async () => {
    await cdb().profiles.put(cap);
    const more = profileNeedsMore(record);
    await cdb().tasks.update(taskId, {
      // 보완이 필요하면(스토리 상세·댓글 모자람, 개수 불일치 등) '일부'로: 종합 결과가 '확인 완료'로 잘못 나오지 않게
      status: more ? "partial" : "succeeded",
      errorCode: more ? "profilePartial" : null,
      errorText: more ? storyStatus(record).text : null,
      result: {
        title: `프로필${record.name ? ` · ${record.name}` : ""}`,
        stories: record.stories.items.length,
        images: images.length,
        memberName: record.name,
        profileStatus: [storyStatus(record).text, memberPhotosStatus(record).text, photoHistoryStatus(record).text].join(" · "),
        hasSnapshot: false,
      },
    });
    await cdb().jobs.update(jobId, { options: { ...job.options, follow: { ...follow, target } } });
  });
  return { kind: "saved", text, images };
}

/** 최근 기록 한 줄 더하기(최대 30개) */
export async function logFollow(jobId: string, kind: FollowKind, text: string, at: string) {
  const job = await cdb().jobs.get(jobId);
  const f = job?.options.follow;
  if (!job || !f) return;
  // 같은 내용이 이어지면 한 줄로 묶는다(예: '변화 없음 ×4')
  const [first, ...rest] = f.log;
  const base = (t: string) => t.replace(/ ×\d+$/, "");
  const log =
    first && first.kind === kind && base(first.text) === text
      ? [{ at, kind, text: `${text} ×${(Number(first.text.match(/ ×(\d+)$/)?.[1]) || 1) + 1}` }, ...rest]
      : [{ at, text, kind }, ...f.log].slice(0, 30);
  await cdb().jobs.update(jobId, { options: { ...job.options, follow: { ...f, log } } });
}
