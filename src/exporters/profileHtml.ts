// 구조화 프로필을 혼자 열리는 HTML로(수집 확장 'HTML로 저장'과 앱이 함께 쓴다). 스크립트 없음, 확보한 이미지는 호출하는 쪽이 데이터 주소로 넘긴다.
// 확보하지 못한 이미지는 넣지 않고 '온라인 원본 링크'로만 표시한다(6.3). 원본 글·이름은 모두 이스케이프한다.
import { memberPhotosStatus, photoHistoryStatus, storyStatus, type BandImageRef, type BandProfileComment, type BandProfileRecord, type BandProfileStory, type SectionStatus } from "../importers/band/profile";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lines = (s: string) => esc(s).replace(/\n/g, "<br>");

export const COMMENT_STATE_TEXT: Record<BandProfileStory["commentsState"], string> = {
  complete: "",
  partial: "댓글 일부만 확보",
  none: "댓글 0개 확인",
  notCollected: "댓글 수집 안 함",
};

/** 화면에 보인 수 표기(null은 0이 아니라 '확인 못 함') */
export const shownText = (n: number | null) => (n === null ? "확인 못 함" : n.toLocaleString());

export function renderProfileHtml(
  r: BandProfileRecord,
  imageUrl: (img: BandImageRef) => string | null,
  opts: { theme?: "light" | "dark"; generator?: string; snapshotHref?: string | null } = {},
): string {
  const pic = (i: BandImageRef | null, cls: string, alt = "") => {
    if (!i) return "";
    const u = imageUrl(i);
    if (u) return `<img class="${cls}" src="${esc(u)}" alt="${esc(alt)}">`;
    return /^https?:/.test(i.src) ? `<a class="online" href="${esc(i.src)}" target="_blank" rel="noreferrer">사진(온라인 원본 링크, 미확보)</a>` : `<span class="missing">사진 미확보</span>`;
  };
  const comment = (c: BandProfileComment, all: BandProfileComment[]): string => {
    const kids = all.filter((x) => x.parentKey === c.key);
    return `<li class="c"><div class="c-head">${pic(c.authorAvatar, "c-face")}<b>${esc(c.author ?? "이름 확인 못 함")}</b> <time>${esc(c.timeText ?? "")}</time></div><div class="c-body">${lines(c.text)}${c.images.map((i) => pic(i, "c-img")).join("")}</div>${kids.length ? `<ul class="replies">${kids.map((k) => comment(k, all)).join("")}</ul>` : ""}</li>`;
  };
  const story = (s: BandProfileStory, i: number) => {
    const top = s.comments.filter((c) => !c.parentKey || !s.comments.some((x) => x.key === c.parentKey));
    const state = COMMENT_STATE_TEXT[s.commentsState];
    return `<article class="story" id="story-${i + 1}"><header><time>${esc(s.timeText ?? "시각 확인 못 함")}</time>${s.textSource === "list" ? ' <small class="muted">목록 글(줄 제한 표시라 전문인지 확인 못 함)</small>' : ""}</header>
<div class="s-body">${lines(s.text)}</div>${s.images.length ? `<div class="s-imgs">${s.images.map((x) => pic(x, "s-img")).join("")}</div>` : ""}${s.links.length ? `<ul class="links">${s.links.map((l) => `<li><a href="${esc(l)}" target="_blank" rel="noreferrer">${esc(l)}</a></li>`).join("")}</ul>` : ""}
<p class="counts">이 스토리의 표정 ${shownText(s.reactionsShown)} · 댓글 ${shownText(s.commentsShown)}${state ? ` · <span class="${s.commentsState === "none" ? "muted" : "warn"}">${state}</span>` : ""}</p>
${s.comments.length ? `<details open><summary>댓글 ${s.comments.length}개</summary><ul class="comments">${top.map((c) => comment(c, s.comments)).join("")}</ul></details>` : ""}</article>`;
  };
  // 상태 한 줄(앱·목차와 같은 계산)
  const statusLine = (st: SectionStatus) => `<p class="${st.tone === "warn" ? "warn" : "muted"}">${esc(st.text)}</p>`;
  // 사진첩: 받은 이미지를 크게 볼 수 있게(새 창). 못 받은 것은 온라인 링크
  const memberPhotosHtml = () => {
    const mp = r.memberPhotos;
    if (!mp || mp.state !== "collected") return statusLine(memberPhotosStatus(r));
    return `${statusLine(memberPhotosStatus(r))}<div class="grid">${mp.items
      .map((p) => {
        const full = imageUrl(p.image);
        const small = p.thumb ? imageUrl(p.thumb) : null;
        const u = full ?? small;
        return u ? `<a href="${esc(u)}" target="_blank"><img class="g-img" src="${esc(u)}" alt="">${!full && small ? '<small class="muted">축소본</small>' : ""}</a>` : pic(p.image, "g-img");
      })
      .join("")}</div>`;
  };
  const dark = opts.theme === "dark";
  const title = `${r.name ?? "인물"} 프로필`;
  const stStory = storyStatus(r);
  const stHistory = photoHistoryStatus(r);
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${esc(opts.generator ?? "AFTERLOG")}">
<title>${esc(title)}</title>
<style>
:root{color-scheme:${dark ? "dark" : "light"};--bg:${dark ? "#16181d" : "#fff"};--fg:${dark ? "#e8eaee" : "#1d1f23"};--muted:${dark ? "#9aa1ad" : "#6b7280"};--line:${dark ? "#2c3038" : "#e5e7eb"};--card:${dark ? "#1e2127" : "#f8f9fb"};--warn:#d97706}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
main{max-width:640px;margin:0 auto;padding:0 16px 48px}
.note{font-size:12px;color:var(--muted);padding:8px 0;border-bottom:1px solid var(--line)}
.cover{height:160px;border-radius:14px;background:var(--card);overflow:hidden;margin-top:12px}.cover img{width:100%;height:100%;object-fit:cover}
.head{display:flex;gap:14px;align-items:center;margin:-40px 0 8px 16px}.face{width:88px;height:88px;border-radius:50%;object-fit:cover;border:4px solid var(--bg);background:var(--card)}
.head .who{padding-top:40px}.head h1{font-size:22px;margin:0}.muted{color:var(--muted)}.warn{color:var(--warn)}
nav{display:flex;gap:14px;border-bottom:1px solid var(--line);margin:12px 0}nav a{color:inherit;text-decoration:none;padding:8px 0}
section{margin:18px 0}h2{font-size:17px;margin:0 0 8px}
.story{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0;background:var(--card)}.story time{color:var(--muted);font-size:13px}
.s-body{white-space:normal;margin:6px 0}.s-img,.c-img{max-width:100%;border-radius:8px;display:block;margin:6px 0}.counts{font-size:13px;color:var(--muted);margin:6px 0}
.comments,.replies{list-style:none;padding-left:0;margin:6px 0}.replies{padding-left:22px;border-left:2px solid var(--line)}.c{margin:8px 0}.c-head{font-size:13px}.c-head time{color:var(--muted)}
.c-face{width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:6px}.c-body{margin-left:28px}
.online,.missing{font-size:12px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px}.grid a{display:block;position:relative}.g-img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block}dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0}dt{color:var(--muted)}dd{margin:0}
</style></head><body><main>
<p class="note">AFTERLOG가 ${esc(r.observedAt ? new Date(r.observedAt).toLocaleString() : "")} 보관한 프로필입니다(보관 시점 기준).${r.profileUrl ? ` 원본: <a href="${esc(r.profileUrl)}" target="_blank" rel="noreferrer">밴드에서 열기 ↗</a>` : r.sourceUrl ? ` 들어온 화면: <a href="${esc(r.sourceUrl)}" target="_blank" rel="noreferrer">원래 화면 열기 ↗</a>(팝업은 인물을 다시 골라야 할 수 있음)` : ""}${r.identity === "unconfirmed" ? " · <span class=\"warn\">원본 인물 연결 미확인</span>" : ""}${opts.snapshotHref ? ` · <a href="${esc(opts.snapshotHref)}">보관 당시 화면</a>` : ""}</p>
${r.cover ? `<div class="cover">${pic(r.cover, "cover-img")}</div>` : ""}
<div class="head"${r.cover ? "" : ' style="margin-top:16px"'}>${pic(r.avatar, "face", "프로필 사진")}<div class="who"><h1>${esc(r.name ?? "이름 확인 못 함")}</h1>${r.description ? `<div>${esc(r.description)}</div>` : ""}</div></div>
<nav><a href="#profile">프로필</a><a href="#photos">사진 이력</a><a href="#member-photos">사진첩</a><a href="#stories">스토리 ${r.stories.items.length}</a></nav>
<section id="profile"><h2>프로필</h2><dl>
${r.info ? `<dt>추가 소개</dt><dd>${esc(r.info)}</dd>` : ""}${r.joinInfo ? `<dt>가입</dt><dd>${esc(r.joinInfo)}</dd>` : ""}
<dt>프로필 표정</dt><dd>${shownText(r.reactionsShown)}</dd><dt>프로필 댓글</dt><dd>${shownText(r.commentsShown)}</dd>
${r.storyCountShown !== null ? `<dt>표시된 스토리 수</dt><dd>${r.storyCountShown}</dd>` : ""}
</dl>${r.history?.length ? `<details><summary>앞선 관측 ${r.history.length}개</summary><ul>${r.history.map((h) => `<li>${esc(h.observedAt ? new Date(h.observedAt).toLocaleString() : "")}: ${esc(h.name ?? "")}${h.description ? ` · ${esc(h.description)}` : ""} · 표정 ${shownText(h.reactionsShown)}</li>`).join("")}</ul></details>` : ""}
${r.notes.length ? `<ul class="muted">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</section>
<section id="photos"><h2>사진 이력</h2>${r.photoHistory.state !== "collected" ? statusLine(stHistory) : r.photoHistory.items.map((p) => `<figure>${pic(p.image, "s-img")}<figcaption>${esc(p.timeText ?? "")}</figcaption></figure>`).join("")}</section>
<section id="member-photos"><h2>사진첩${r.memberPhotos?.items.length ? ` ${r.memberPhotos.items.length}` : ""}</h2>${memberPhotosHtml()}</section>
<section id="stories"><h2>스토리</h2>${statusLine(stStory)}${r.stories.items.map(story).join("\n")}</section>
</main></body></html>
`;
}
