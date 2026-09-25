import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bandMemberKey, mergeProfileRecords, parseBandMemberPath, parseBandProfileDocument, savedFromUrl } from "../../src/importers/band/profile";
import { parseBandHtml } from "../../src/importers/band/html";
import { FIXTURE_DIR } from "./helpers";

const load = (n: string) => readFileSync(FIXTURE_DIR + "profile/" + n, "utf8");
const parse = (html: string, observedAt = "2026-09-25T10:00:00.000Z") =>
  parseBandProfileDocument(new DOMParser().parseFromString(html, "text/html"), { pageUrl: savedFromUrl(html), observedAt });

describe("인물 주소(P01·P02)", () => {
  it("memberKey 끝의 '='·인코딩을 손상시키지 않고, band.us/www 차이는 같게 본다", () => {
    const a = parseBandMemberPath("https://www.band.us/band/100200300/member/AbCdEf%3D%3D%3D/profile")!;
    const b = parseBandMemberPath("https://band.us/band/100200300/member/AbCdEf===/profile")!;
    expect(a).toEqual({ bandNo: "100200300", memberKey: "AbCdEf===", profile: true });
    expect(bandMemberKey(a)).toBe(bandMemberKey(b));
    expect(parseBandMemberPath("https://band.us/band/1234/member/x%E0%A4/profile")).toBeNull();
    expect(parseBandMemberPath("https://band.us/band/1/member#")).toBeNull();
    // 이름이 같아도 다른 식별자·다른 밴드는 다른 인물
    expect(bandMemberKey({ bandNo: "1", memberKey: "K" })).not.toBe(bandMemberKey({ bandNo: "2", memberKey: "K" }));
  });
});

describe("프로필 페이지 + 스토리 상세 저장 페이지", () => {
  const [r] = parse(load("profile-page.html"));
  it("기본 정보와 인물 확인", () => {
    expect(r).toMatchObject({
      surface: "profilePage",
      bandNo: "100200300",
      memberKey: "AbCdEf===",
      identity: "confirmed",
      name: "가상인물",
      description: "가상 소개 한 줄",
      joinInfo: "2018년 12월 1일",
      reactionsShown: 3,
      commentsShown: 1,
    });
    expect(r.avatar?.ref).toBe("avatar_a.jpg");
    expect(r.cover?.ref).toBe("cover_a.jpg");
    // 머리글의 로그인한 사람 이름을 가져오지 않는다
    expect(r.name).not.toBe("로그인한 나");
    expect(r.photoHistory.state).toBe("unrecognized");
  });
  it("P03 스토리 목록과 열린 상세를 한 스토리로: 상세 전문·댓글·답글, 스토리 반응은 프로필 반응과 따로", () => {
    expect(r.stories.state).toBe("collected");
    expect(r.stories.items).toHaveLength(2);
    const [s1, s2] = r.stories.items;
    expect(s1.textSource).toBe("detail");
    expect(s1.text).toContain("좋아하는 것: 비 오는 날");
    expect(s1.local).toBe("2024-09-27T09:14");
    expect(s1.reactionsShown).toBe(2);
    expect(s1.commentsShown).toBe(3);
    expect(s1.comments.map((c) => [c.author, c.text, c.parentKey === null])).toEqual([
      ["다른인물", "반가워요", true],
      ["가상인물", "고마워요", false],
      ["다른인물", "반가워요", true],
    ]);
    // M04 같은 사람이 같은 시각에 같은 말을 두 번: 둘 다 남는다
    expect(new Set(s1.comments.map((c) => c.key)).size).toBe(3);
    expect(s1.commentsState).toBe("complete");
    expect(s2).toMatchObject({ textSource: "list", text: "두 번째 스토리 글", reactionsShown: 0, commentsShown: 0, commentsState: "none" });
    expect(s2.images.map((i) => i.ref)).toEqual(["story_b.jpg"]);
  });
  it("스토리 상세(.cPostCard)는 일반 게시글이 아니다", () => {
    expect(parseBandHtml(load("profile-page.html")).documents).toHaveLength(0);
  });
});

describe("멤버 목록 위 프로필 팝업(주소 변화 없음)", () => {
  const recs = parse(load("member-popup.html"));
  it("P04 열린 팝업 하나만. 배경 멤버·닫힌 예전 팝업은 읽지 않는다", () => {
    expect(recs).toHaveLength(1);
    expect(recs[0].name).toBe("가상인물");
  });
  it("P05 식별자 없는 팝업은 연결 미확인, P06 비어 있는 숫자는 0이 아니라 확인 못 함", () => {
    expect(recs[0]).toMatchObject({ surface: "profilePopup", bandNo: "100200300", memberKey: null, identity: "unconfirmed", reactionsShown: null, commentsShown: null, storyCountShown: 1 });
    expect(recs[0].stories.state).toBe("notCollected");
    expect(recs[0].avatar?.ref).toBe("avatar_a.jpg");
  });
  it("V03 스토리 0개 팝업도 기본 정보는 보관(스토리 0개 확인)", () => {
    const html = load("member-popup.html").replace('<em class="count">1</em>', '<em class="count">0</em>');
    expect(parse(html)[0].stories.state).toBe("none");
  });
});

describe("같은 인물의 새 관측 합치기(M03·P06)", () => {
  it("새 스토리·댓글은 더하고, 기본 정보가 바뀌면 앞 관측을 남기며, 반응 수는 더하지 않는다", () => {
    const [old] = parse(load("profile-page.html"), "2026-09-01T00:00:00.000Z");
    const html2 = load("profile-page.html")
      .replace("가상 소개 한 줄", "바뀐 소개")
      .replace('<span class="count _countBtn">3</span>', '<span class="count _countBtn">5</span>')
      .replace("<li data-viewname=\"DProfileStoryListItemView\" class=\"storyItem\">", '<li data-viewname="DProfileStoryListItemView" class="storyItem"><div class="storyContent"><time class="time">2025년 1월 1일 오전 9:00</time><div data-viewname="DProfileStoryTextView"><div class="txtBody -listType">새 스토리</div></div></div></li><li data-viewname="DProfileStoryListItemView" class="storyItem">');
    const [inc] = parse(html2, "2026-09-20T00:00:00.000Z");
    const m = mergeProfileRecords(old, inc);
    expect(m.storiesAdded).toBe(1);
    expect(m.record.stories.items).toHaveLength(3);
    expect(m.record.description).toBe("바뀐 소개");
    expect(m.record.reactionsShown).toBe(5);
    expect(m.record.history?.[0]).toMatchObject({ description: "가상 소개 한 줄", reactionsShown: 3 });
    // 같은 것을 다시 합치면 바뀌는 것이 없다(M01)
    const again = mergeProfileRecords(m.record, inc);
    expect(again.changed).toBe(false);
    expect(again.record.stories.items).toHaveLength(3);
  });
  it("새 관측에 없는 값으로 기존 값을 지우지 않는다", () => {
    const [old] = parse(load("profile-page.html"), "2026-09-01T00:00:00.000Z");
    const [inc] = parse(load("profile-page.html").replace('<span class="userNickname _userDesc">가상 소개 한 줄</span>', ""), "2026-09-20T00:00:00.000Z");
    expect(mergeProfileRecords(old, inc).record.description).toBe("가상 소개 한 줄");
  });
});

describe("프로필 HTML(스크립트 없음·이스케이프·미확보 표시)", () => {
  it("원본 글은 이스케이프하고, 확보 못 한 원격 사진은 온라인 링크로만, 팝업은 연결 미확인", async () => {
    const { renderProfileHtml } = await import("../../src/exporters/profileHtml");
    const [r] = parse(load("member-popup.html").replace("가상 소개 한 줄", "&lt;img src=x onerror=alert(1)&gt;소개"));
    r.avatar = { src: "https://img.test/a.jpg", ref: "a.jpg" };
    const html = renderProfileHtml(r, () => null);
    expect(r.description).toBe("<img src=x onerror=alert(1)>소개");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;소개");
    expect(html).toContain("온라인 원본 링크");
    expect(html).not.toContain('src="https://img.test');
    expect(html).toContain("원본 인물 연결 미확인");
    expect(html).toContain("프로필 표정</dt><dd>확인 못 함");
  });
});
