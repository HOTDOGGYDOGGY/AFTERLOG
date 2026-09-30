// 밴드 사진첩: 같은 파일은 한 칸, 등장 위치는 모두, 미확보는 수만, 아바타 제외, 인물 필터
import { describe, expect, it } from "vitest";
import { buildAlbum, filterAlbum } from "../../src/app/band/album";
import type { BandProfileRecord } from "../../src/importers/band/profile";
import { syntheticDoc } from "./helpers";

function withImages() {
  const doc = syntheticDoc();
  const entries = Object.values(doc.entries);
  const post = entries.find((e) => e.kind === "post")!;
  const comment = entries.find((e) => e.kind === "comment")!;
  post.blocks = [...post.blocks.filter((b) => b.type !== "image"), { type: "image", assetId: "A1" }, { type: "image", assetId: null, sourceRef: "x.jpg" }];
  comment.blocks = [...comment.blocks, { type: "image", assetId: "A1" }, { type: "image", assetId: "A2" }];
  // 아바타는 사진첩에 넣지 않는다
  for (const i of Object.values(doc.identities)) i.avatarAssetId = "AV";
  return { doc, post, comment };
}

const profile = (over: Partial<BandProfileRecord>): BandProfileRecord =>
  ({
    schema: "afterlog.band-profile/1",
    platform: "band",
    surface: "profilePage",
    bandNo: "1",
    memberKey: "M",
    identity: "confirmed",
    sourceUrl: null,
    profileUrl: null,
    storyCountShown: null,
    observedAt: null,
    name: "가상인물",
    description: null,
    avatar: { src: "a.jpg", ref: null, sha256: "sa" },
    cover: { src: "c.jpg", ref: null, sha256: null },
    info: null,
    joinInfo: null,
    reactionsShown: null,
    commentsShown: null,
    photoHistory: { state: "unrecognized", items: [] },
    stories: { state: "collected", items: [] },
    memberPhotos: { state: "collected", items: [{ image: { src: "m.jpg", ref: null, sha256: "sm" }, thumb: null }] },
    notes: [],
    ...over,
  }) as BandProfileRecord;

describe("밴드 사진첩", () => {
  it("같은 파일은 한 칸으로 모으고 쓰인 곳을 모두 남기며, 미확보는 수만 센다", () => {
    const { doc, post, comment } = withImages();
    const byId: Record<string, string> = { sa: "P1", sm: "A2" };
    const a = buildAlbum([doc], [{ id: "prof", record: profile({}) }], (s) => byId[s]);
    expect(a.items.map((x) => x.assetId)).toEqual(["A1", "A2", "P1"]);
    const a1 = a.items[0];
    expect(a1.places.map((p) => [p.kind, p.entryId])).toEqual([
      ["post", post.id],
      ["comment", comment.id],
    ]);
    // 댓글 사진과 인물 사진첩이 같은 파일 → 한 칸, 두 곳
    expect(a.items[1].places.map((p) => p.kind)).toEqual(["comment", "memberPhoto"]);
    expect(a.items[1].places[1].profileId).toBe("prof");
    // 글의 미확보 1 + 커버(해시 없음) 1
    expect(a.missing).toBe(2);
    expect(a.items.some((x) => x.assetId === "AV")).toBe(false);
  });

  it("인물로 거르면 그 인물이 나오는 자리가 있는 사진만", () => {
    const { doc, post } = withImages();
    const author = doc.identities[post.authorId!].originalName;
    const a = buildAlbum([doc], [{ id: "prof", record: profile({}) }], (s) => ({ sa: "P1" })[s]);
    expect(a.people.map((p) => p.name)).toContain("가상인물");
    expect(filterAlbum(a.items, "가상인물").map((x) => x.assetId)).toEqual(["P1"]);
    expect(filterAlbum(a.items, author).map((x) => x.assetId)).toContain("A1");
    expect(filterAlbum(a.items, null)).toHaveLength(a.items.length);
  });
});
