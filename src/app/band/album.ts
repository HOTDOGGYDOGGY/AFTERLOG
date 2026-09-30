// 밴드 사진첩(디자인 참고 05): 프로젝트에 보관한 글·댓글·프로필 사진을 한곳에 모은다.
// 같은 파일이 여러 곳에 쓰였으면 한 칸으로 합치고 등장 위치는 모두 남긴다. 확보하지 못한 사진은 칸을 만들지 않고 수만 센다.
// 작성자 아바타(댓글마다 반복되는 얼굴)는 사진첩에 넣지 않는다.
import { ROOT, type DocumentData, type Entry } from "../../domain/types";
import type { BandImageRef, BandProfileRecord } from "../../importers/band/profile";

export type AlbumPlaceKind = "post" | "comment" | "reply" | "profileAvatar" | "profileCover" | "story" | "memberPhoto" | "photoHistory";

export interface AlbumPlace {
  kind: AlbumPlaceKind;
  /** 누구의 사진인지(글·댓글 작성자 원래 이름, 프로필 인물 이름) */
  who: string | null;
  /** 어디의 사진인지 한 줄 */
  label: string;
  time: string | null;
  docId?: string;
  entryId?: string;
  profileId?: string;
}

export interface AlbumItem {
  assetId: string;
  places: AlbumPlace[];
}

export interface Album {
  items: AlbumItem[];
  /** 자리는 있는데 파일을 확보하지 못한 사진 수(글·댓글·프로필 합) */
  missing: number;
  /** 인물 필터(사진 수 많은 순) */
  people: { name: string; count: number }[];
}

export const PLACE_TEXT: Record<AlbumPlaceKind, string> = {
  post: "글",
  comment: "댓글",
  reply: "답글",
  profileAvatar: "프로필 사진",
  profileCover: "커버 사진",
  story: "스토리",
  memberPhoto: "인물 사진첩",
  photoHistory: "프로필 사진 이력",
};

function parentOf(doc: DocumentData): Map<string, string> {
  const m = new Map<string, string>();
  for (const [p, kids] of Object.entries(doc.children)) for (const k of kids) m.set(k, p);
  return m;
}

/** 문서 순서대로 항목을 부모 → 자식 순으로 */
function walk(doc: DocumentData): Entry[] {
  const out: Entry[] = [];
  const go = (id: string) => {
    for (const k of doc.children[id] ?? []) {
      const e = doc.entries[k];
      if (!e) continue;
      out.push(e);
      go(k);
    }
  };
  go(ROOT);
  return out;
}

export function buildAlbum(docs: DocumentData[], profiles: { id: string; record: BandProfileRecord | null }[], assetIdBySha: (sha: string) => string | undefined): Album {
  const byAsset = new Map<string, AlbumItem>();
  const order: AlbumItem[] = [];
  let missing = 0;
  const add = (assetId: string | null | undefined, place: AlbumPlace) => {
    if (!assetId) {
      missing++;
      return;
    }
    let it = byAsset.get(assetId);
    if (!it) {
      it = { assetId, places: [] };
      byAsset.set(assetId, it);
      order.push(it);
    }
    // 같은 자리를 두 번 세지 않는다(같은 글에 같은 그림을 두 번 넣은 경우는 두 자리)
    it.places.push(place);
  };
  for (const d of docs) {
    const parents = parentOf(d);
    for (const e of walk(d)) {
      const who = e.authorId ? d.identities[e.authorId]?.originalName ?? null : null;
      const parent = parents.get(e.id);
      const kind: AlbumPlaceKind = e.kind === "post" ? "post" : parent && parent !== ROOT && d.entries[parent]?.kind !== "post" ? "reply" : "comment";
      for (const b of e.blocks) {
        if (b.type !== "image") continue;
        add(b.assetId, { kind, who, label: `${d.title} · ${PLACE_TEXT[kind]}`, time: e.time?.raw ?? null, docId: d.id, entryId: e.id });
      }
    }
  }
  const sha = (i: BandImageRef | null | undefined) => (i?.sha256 ? assetIdBySha(i.sha256) ?? null : null);
  for (const p of profiles) {
    const r = p.record;
    if (!r) continue;
    const who = r.name;
    const base = { who, profileId: p.id };
    if (r.avatar) add(sha(r.avatar), { ...base, kind: "profileAvatar", label: `${who ?? "인물"} · 프로필 사진(보관 시점)`, time: null });
    if (r.cover) add(sha(r.cover), { ...base, kind: "profileCover", label: `${who ?? "인물"} · 커버 사진`, time: null });
    if (r.photoHistory.state === "collected")
      for (const h of r.photoHistory.items) add(sha(h.image), { ...base, kind: "photoHistory", label: `${who ?? "인물"} · 프로필 사진 이력`, time: h.timeText });
    for (const s of r.stories.items) for (const i of s.images) add(sha(i), { ...base, kind: "story", label: `${who ?? "인물"} · 스토리`, time: s.timeText });
    if (r.memberPhotos?.state === "collected") for (const m of r.memberPhotos.items) add(sha(m.image) ?? sha(m.thumb), { ...base, kind: "memberPhoto", label: `${who ?? "인물"} · 인물 사진첩`, time: null });
  }
  const counts = new Map<string, number>();
  for (const it of order) for (const n of new Set(it.places.map((x) => x.who).filter((x): x is string => !!x))) counts.set(n, (counts.get(n) ?? 0) + 1);
  const people = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { items: order, missing, people };
}

/** 인물로 거르기(그 인물이 등장하는 자리가 하나라도 있으면) */
export const filterAlbum = (items: AlbumItem[], who: string | null) => (who ? items.filter((it) => it.places.some((p) => p.who === who)) : items);
