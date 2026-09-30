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
  // 크게 보기: 스크립트 없이 :target으로 같은 그림을 화면 가득(원본 비율). 데이터 주소를 새 창으로 여는 것은 브라우저가 막는다
  let zoomN = 0;
  const zoom = (i: BandImageRef | null, cls: string, alt = "") => {
    if (!i) return "";
    const u = imageUrl(i);
    if (!u) return pic(i, cls, alt);
    const id = `z${++zoomN}`;
    return `<figure class="zoom" id="${id}"><a class="zoom-open" href="#${id}" title="크게 보기"><img class="${cls}" src="${esc(u)}" alt="${esc(alt)}"></a><a class="zoom-close" href="#_" aria-label="닫기">닫기 ✕</a></figure>`;
  };
  const initial = (esc((r.name ?? "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?"));
  const comment = (c: BandProfileComment, all: BandProfileComment[]): string => {
    const kids = all.filter((x) => x.parentKey === c.key);
    return `<li class="c"><div class="c-head">${pic(c.authorAvatar, "c-face")}<b>${esc(c.author ?? "이름 확인 못 함")}</b> <time>${esc(c.timeText ?? "")}</time></div><div class="c-body">${lines(c.text)}${c.images.map((i) => zoom(i, "c-img")).join("")}</div>${kids.length ? `<ul class="replies">${kids.map((k) => comment(k, all)).join("")}</ul>` : ""}</li>`;
  };
  const story = (s: BandProfileStory, i: number) => {
    const top = s.comments.filter((c) => !c.parentKey || !s.comments.some((x) => x.key === c.parentKey));
    const state = COMMENT_STATE_TEXT[s.commentsState];
    return `<article class="story" id="story-${i + 1}"><header><time>${esc(s.timeText ?? "시각 확인 못 함")}</time>${s.textSource === "list" ? ' <small class="muted">목록 글(줄 제한 표시라 전문인지 확인 못 함)</small>' : ""}</header>
<div class="s-body">${lines(s.text)}</div>${s.images.length ? `<div class="s-imgs n-${Math.min(s.images.length, 3)}">${s.images.map((x) => zoom(x, "s-img")).join("")}</div>` : ""}${s.links.length ? `<ul class="links">${s.links.map((l) => `<li><a href="${esc(l)}" target="_blank" rel="noreferrer">${esc(l)}</a></li>`).join("")}</ul>` : ""}
<p class="counts">이 스토리의 표정 ${shownText(s.reactionsShown)} · 댓글 ${shownText(s.commentsShown)}${state ? ` · <span class="${s.commentsState === "none" ? "muted" : "warn"}">${state}</span>` : ""}</p>
${s.comments.length ? `<details open><summary>댓글 ${s.comments.length}개</summary><ul class="comments">${top.map((c) => comment(c, s.comments)).join("")}</ul></details>` : ""}</article>`;
  };
  // 상태 한 줄(앱·목차와 같은 계산)
  const MARK: Record<SectionStatus["tone"], string> = { ok: "확보", muted: "참고", warn: "확인 필요" };
  const statusLine = (st: SectionStatus) => `<p class="status is-${st.tone}"><span class="mark">${MARK[st.tone]}</span> ${esc(st.text)}</p>`;
  const chip = (label: string, st: SectionStatus, href: string) => `<a class="chip is-${st.tone}" href="${href}"><b>${label}</b><span class="mark">${MARK[st.tone]}</span><span class="chip-text">${esc(st.text)}</span></a>`;
  // 사진첩: 받은 이미지를 크게 볼 수 있게(새 창). 못 받은 것은 온라인 링크
  const memberPhotosHtml = () => {
    const mp = r.memberPhotos;
    if (!mp || mp.state !== "collected") return statusLine(memberPhotosStatus(r));
    return `${statusLine(memberPhotosStatus(r))}<div class="grid">${mp.items
      .map((p) => {
        const full = imageUrl(p.image);
        const small = p.thumb ? imageUrl(p.thumb) : null;
        if (!full && !small) return `<div class="g-missing">${pic(p.image, "g-img")}</div>`;
        return zoom(full ? p.image : p.thumb, "g-img") + (!full && small ? '<small class="muted">축소본</small>' : "");
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
:root{color-scheme:${dark ? "dark" : "light"};--bg:${dark ? "#16181d" : "#fff"};--fg:${dark ? "#e8eaee" : "#1d1f23"};--muted:${dark ? "#a3aab6" : "#5f6875"};--line:${dark ? "#2c3038" : "#e5e7eb"};--card:${dark ? "#1e2127" : "#f8f9fb"};--sel:${dark ? "#2d3b4d" : "#eaf0f7"};--warn:${dark ? "#f0b44c" : "#8a5a00"};--warn-bg:${dark ? "#3a3218" : "#fff6db"};--ok:${dark ? "#6fd49a" : "#17753f"};--ok-bg:${dark ? "#1d3027" : "#e7f5ec"}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;word-break:keep-all;overflow-wrap:anywhere}
main{max-width:680px;margin:0 auto;padding:0 16px 48px}a{color:inherit}
.note{font-size:12px;color:var(--muted);padding:8px 0;border-bottom:1px solid var(--line)}
.hero{margin-top:12px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card)}
.cover{height:180px;background:linear-gradient(135deg,var(--card),var(--bg));position:relative}.cover.is-empty{height:96px}.cover .zoom,.cover .zoom-open{height:100%}.cover img{width:100%;height:100%;object-fit:cover;display:block}.cover .missing,.cover .online{position:absolute;right:12px;top:10px}
.head{display:flex;gap:14px;align-items:flex-end;padding:0 16px 12px;margin-top:-40px;position:relative}.face{width:88px;height:88px;border-radius:50%;object-fit:cover;border:4px solid var(--card);background:var(--sel);flex:none;display:block}
.head .who{padding-top:46px;min-width:0}.initial{display:grid;place-items:center;font-size:32px;font-weight:700}.head h1{font-size:22px;margin:0;line-height:1.25}.muted{color:var(--muted)}.warn{color:var(--warn)}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px 14px;border-top:1px solid var(--line)}.chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;text-decoration:none}.chip-text{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mark{padding:0 5px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid var(--line);color:var(--muted);white-space:nowrap}.is-ok .mark{color:var(--ok);background:var(--ok-bg)}.is-warn .mark{color:var(--warn);background:var(--warn-bg)}.status{font-size:13px;margin:4px 0 10px}
nav{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:12px 0;overflow-x:auto}nav a{color:inherit;text-decoration:none;padding:8px 12px;white-space:nowrap}
section{margin:18px 0}h2{font-size:17px;margin:0 0 8px}
.story{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0;background:var(--card)}.story time{color:var(--muted);font-size:13px}
.s-body{white-space:normal;margin:6px 0;line-height:1.65}.s-img,.c-img{max-width:100%;max-height:420px;border-radius:8px;display:block;margin:6px 0}.counts{font-size:13px;color:var(--muted);margin:8px 0 0;padding-top:8px;border-top:1px solid var(--line)}
.s-imgs{display:grid;gap:4px}.s-imgs.n-2{grid-template-columns:1fr 1fr}.s-imgs.n-3{grid-template-columns:repeat(3,1fr)}.s-imgs.n-2 .s-img,.s-imgs.n-3 .s-img{width:100%;aspect-ratio:1;object-fit:cover;margin:0}
.comments,.replies{list-style:none;padding-left:0;margin:6px 0}.replies{padding-left:22px;border-left:2px solid var(--line)}.c{margin:8px 0}.c-head{font-size:13px}.c-head time{color:var(--muted)}
.c-face{width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:6px;object-fit:cover}.c-body{margin-left:28px}
.online,.missing{font-size:12px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px}.grid .zoom,.g-missing{aspect-ratio:1;background:var(--card);overflow:hidden;position:relative}.g-missing{display:grid;place-items:center;padding:6px;text-align:center}.g-img{width:100%;height:100%;aspect-ratio:1;object-fit:cover;display:block}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0}dt{color:var(--muted)}dd{margin:0}
.zoom{margin:0}.zoom-open{display:block;cursor:zoom-in}.zoom-close{display:none}
.zoom:target{position:fixed;inset:0;z-index:9;margin:0;background:rgba(0,0,0,.88);display:grid;place-items:center;padding:24px;aspect-ratio:auto}
.zoom:target .zoom-open{cursor:default;pointer-events:none}.zoom:target img{width:auto;height:auto;max-width:94vw;max-height:88vh;aspect-ratio:auto;object-fit:contain;border-radius:4px}
.zoom:target .zoom-close{display:block;position:fixed;top:14px;right:16px;color:#fff;background:#0008;border-radius:8px;padding:4px 10px;text-decoration:none}
</style></head><body><main>
<p class="note">AFTERLOG가 ${esc(r.observedAt ? new Date(r.observedAt).toLocaleString() : "")} 보관한 프로필입니다(보관 시점 기준).${r.profileUrl ? ` 원본: <a href="${esc(r.profileUrl)}" target="_blank" rel="noreferrer">밴드에서 열기 ↗</a>` : r.sourceUrl ? ` 들어온 화면: <a href="${esc(r.sourceUrl)}" target="_blank" rel="noreferrer">원래 화면 열기 ↗</a>(팝업은 인물을 다시 골라야 할 수 있음)` : ""}${r.identity === "unconfirmed" ? " · <span class=\"warn\">원본 인물 연결 미확인</span>" : ""}${opts.snapshotHref ? ` · <a href="${esc(opts.snapshotHref)}">보관 당시 화면</a>` : ""}</p>
<header class="hero">
<div class="cover${r.cover && imageUrl(r.cover) ? "" : " is-empty"}">${r.cover ? zoom(r.cover, "cover-img", "커버 사진") : ""}</div>
<div class="head">${r.avatar && imageUrl(r.avatar) ? zoom(r.avatar, "face", "프로필 사진") : `<span class="face initial" role="img" aria-label="${r.avatar ? "프로필 사진 미확보" : "프로필 사진 없음"}">${initial}</span>`}<div class="who"><h1>${esc(r.name ?? "이름 확인 못 함")}</h1>${r.description ? `<div>${esc(r.description)}</div>` : ""}${r.avatar && !imageUrl(r.avatar) ? `<div>${pic(r.avatar, "face")}</div>` : ""}</div></div>
<div class="chips">${chip("스토리", stStory, "#stories")}${chip("사진첩", memberPhotosStatus(r), "#member-photos")}${chip("사진 이력", stHistory, "#photos")}</div>
</header>
<nav><a href="#profile">프로필</a><a href="#stories">스토리 ${r.stories.items.length}</a><a href="#member-photos">사진첩</a><a href="#photos">사진 이력</a></nav>
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
