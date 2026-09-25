// 가짜 밴드 서버(테스트 전용). 사용자가 준 저장 페이지의 구조를 흉내 낸 합성 자료만 쓴다(실제 로그 아님).
//  - 4588: 밴드 화면(localhost), 4589: 이미지 서버(127.0.0.1)
import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const FIX = resolve(process.cwd(), "tests/fixtures/band");
const TEMPLATE = readFileSync(resolve(FIX, "post-synthetic.html"), "utf8");
const IMG = Object.fromEntries(readdirSync(resolve(FIX, "page_files")).map((n) => [n, readFileSync(resolve(FIX, "page_files", n))]));
const BAND = "424242";
const TOTAL = 22;
const hits = new Map();

function postCard(n) {
  let html = TEMPLATE.slice(TEMPLATE.indexOf('<article class="cPostCard'), TEMPLATE.indexOf("</article>") + 10);
  html = html.replace(/\.\/page_files\//g, "http://127.0.0.1:4589/img/");
  html = html.replace("첫 줄 대사.", `${n}번 글의 첫 줄 대사.`);
  html = html.replace('href="https://band.us/band/1/post/1"', `href="http://localhost:4588/band/${BAND}/post/${n}"`);
  html = html.replace("2026년 3월 1일 오후 11:50", `2026년 3월 ${(n % 28) + 1}일 오후 11:50`);
  // 7번 글: 표시 14개 중 8개만 보이고 '이전 댓글 보기'로 6개를 더 불러온다. 9번 글: 표시 12개인데 펼칠 버튼 없음(일부 확보로 남음)
  html = html.replace('<span class="count">10</span>', `<span class="count">${n === 7 ? 14 : n === 9 ? 12 : 8}</span>`);
  if (n === 7)
    html = html.replace('class="sCommentList _heightDetectAreaForComment">', 'class="sCommentList _heightDetectAreaForComment"><button type="button" class="prevComment _prevCommentBtn">이전 댓글 보기</button><a href="#" class="_btnMuteMember">이 멤버 댓글 숨기기</a>');
  if (n === 5) html = html.replace("post_photo_2.png", "broken.png");
  // 인물 선택 수집 검사용: 5의 배수 글은 작성자가 '다온'
  if (n % 5 === 0) html = html.replace(/(class="text ">\s*)가람/, "$1다온");
  // 실제 밴드에서 글 주소를 바로 열면 .cPostCard가 없다(진단 0.1.2). 일부 글은 그 모양으로 준다
  if (n % 4 === 2)
    html = `<div class="postDetailWrap">${html.replace('<article class="cPostCard _postCard">', '<section class="detailPost">').replace(/<\/article>$/, "</section>")}</div><aside class="bandSide"><p class="txtBody">밴드 소개 요약</p></aside>`;
  return html;
}

// 목록 항목: 작성자 이름과 글 링크
const itemHtml = (n) => `<div class="postWriterInfoWrap"><a class="text" href="/band/${BAND}/post/${n}">${n % 5 === 0 ? "다온" : "가람"}</a></div><a href="/band/${BAND}/post/${n}">글 ${n}</a>`;

function page(body, script = "") {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>가짜 밴드</title></head><body>
<header><img class="_globalFaceImage" src="http://127.0.0.1:4589/img/me.png" width="30"></header>
<div class="printInfo"><span class="name">[합성] 테스트 밴드</span></div>
${body}<script>${script}</script></body></html>`;
}

const band = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost:4588");
  const send = (code, html) => {
    res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  };
  let m = url.pathname.match(new RegExp(`^/band/${BAND}/post/(\\d+)$`));
  if (m) {
    const n = Number(m[1]);
    const k = hits.get(n) ?? 0;
    hits.set(n, k + 1);
    if (n === 21 || n > TOTAL) return send(200, page(`<div class="deleted">삭제된 게시글입니다.</div>`));
    if (n === 13 && k === 0) return send(503, page(`<div>잠시 후 다시 시도</div>`));
    // SPA처럼 조금 늦게 그린다
    return send(
      200,
      page(
        `<div id="app"></div><template id="t">${postCard(n)}</template>`,
        `setTimeout(()=>{document.getElementById('app').append(document.getElementById('t').content.cloneNode(true))},600);
        window.__muted=0;
        document.addEventListener('click',(e)=>{
          if(e.target.closest('._btnMuteMember')){e.preventDefault();window.__muted++;document.body.dataset.muted='1';return;}
          const b=e.target.closest('._prevCommentBtn');if(!b)return;
          setTimeout(()=>{const leaf=[...document.querySelectorAll('.sCommentList .cComment')].find(c=>!c.querySelector('.cComment')&&c.querySelector('._commentContent'));
            for(let i=1;i<=6;i++){const c=leaf.cloneNode(true);c.querySelector('._commentContent').textContent='펼친 댓글 '+i;leaf.parentElement.insertBefore(c,leaf);}
            b.remove();},400)});`,
      ),
    );
  }
  if (url.pathname === `/band/${BAND}` || url.pathname === `/band/${BAND}/post`) {
    const items = (from, to) => Array.from({ length: to - from }, (_, i) => `<div class="feed-item" style="height:220px">${itemHtml(TOTAL - from - i)}</div>`).join("");
    const script = `let shown=8;const all=${TOTAL};const feed=document.getElementById('feed');
      window.addEventListener('scroll',()=>{if(window.innerHeight+window.scrollY>=document.body.scrollHeight-50&&shown<all&&!window.__loading){window.__loading=true;setTimeout(()=>{const from=shown;shown=Math.min(all,shown+8);
      for(let i=from;i<shown;i++){const d=document.createElement('div');d.className='feed-item';d.style.height='220px';const n=all-i;d.innerHTML='<div class="postWriterInfoWrap"><a class="text" href="/band/${BAND}/post/'+n+'">'+(n%5===0?'다온':'가람')+'</a></div><a href="/band/${BAND}/post/'+n+'">글 '+n+'</a>';feed.append(d)}
      // 가상화: 오래된 항목은 화면에서 지운다
      while(feed.children.length>12)feed.firstElementChild.remove();window.__loading=false},400)}});`;
    return send(200, page(`<div id="feed">${items(0, 8)}</div>`, script));
  }
  // 검색 결과(실제 주소 형식은 미확인. 검색어가 본문에 들어간 글 목록)
  if (url.pathname === `/band/${BAND}/search`) {
    const k = url.searchParams.get("keyword") ?? "";
    const hit = Array.from({ length: TOTAL }, (_, i) => TOTAL - i).filter((n) => n !== 21 && k && `${n}번 글의 첫 줄 대사.`.includes(k));
    return send(200, page(`<h2>'${k}' 검색 결과</h2><div id="feed">${hit.map((n) => `<div class="feed-item" style="height:220px">${itemHtml(n)}</div>`).join("")}</div>`));
  }
  // 멤버 목록: 이름을 누르면 주소 변화 없이 프로필 팝업(실제 저장 표본 구조, 링크는 모두 '#')
  if (url.pathname === `/band/${BAND}/member`) {
    const people = [["나래", "avatar_narae.png", 0], ["다온", "avatar_garam.png", 2]];
    const popup = (i) => `<div data-viewname="DProfileLayoutView" class="lyWrap layer_wrap" style="position:fixed;inset:0;background:#0008"><div class="lyContent -layerProfileCardStyle" style="background:#fff;width:355px;margin:60px auto;padding:16px"><div data-viewname="DProfileLayerView" class="_dProfileView">
      <div class="layerOptionBox"><div class="joinInfoBox"><p class="joinInfo">2020년 3월 1일 가입</p></div><button type="button" class="closeButton _btnClose">닫기</button></div>
      <div class="cProfileViewCard"><div class="infoBox"><a href="/band/${BAND}/member#" class="imgBox _imgAnchor"><img class="profileImage _profileImage" src="http://127.0.0.1:4589/img/${people[i][1]}" width="80"></a><strong class="userName">${people[i][0]}</strong>
        <div data-viewname="DProfileDescriptionView"><span class="userNickname _userDesc">팝업 소개 ${i + 1}</span><div class="optionInfo _userInfo"></div></div></div>
        <div class="sideBox"><button type="button" class="like _likeEmotionRegion trap"><div class="_emotionCount"></div></button><a href="/band/${BAND}/member#" class="comment _commentBtn"><div class="_commentCountRegion"></div></a></div></div>
      <div data-viewname="DProfileStoryCountView"><a class="profileStoryMoveButton _storyAnchor trap" href="/band/${BAND}/member#"><span class="title">스토리 보기</span><span class="subText">전체글 <em class="count">${people[i][2]}</em></span></a></div></div>
      <button type="button" class="btnNext _nextProfileBtn trap">다음 프로필</button></div></div>`;
    const script = `window.__traps=0;document.addEventListener('click',e=>{if(e.target.closest('.trap'))window.__traps++},true);
      const P=${JSON.stringify([popup(0), popup(1)])};
      document.querySelectorAll('.memberItem').forEach((b,i)=>b.addEventListener('click',()=>{document.querySelectorAll('[data-viewname=DProfileLayoutView]').forEach(x=>x.remove());document.body.insertAdjacentHTML('beforeend',P[i]);document.querySelector('[data-viewname=DProfileLayoutView] ._btnClose').addEventListener('click',()=>document.querySelector('[data-viewname=DProfileLayoutView]').remove())}));`;
    return send(200, page(`<ul class="memberList">${people.map((p) => `<li><button type="button" class="memberItem">${p[0]}</button></li>`).join("")}</ul>`, script));
  }
  // 인물(멤버) 화면: 프로필 · 작성글 목록 · 작성댓글 목록(실제 저장 샘플과 같은 구조)
  m = url.pathname.match(new RegExp(`^/band/${BAND}/member/(MK[A-Z]+)(?:/(post|comment|profile))?$`));
  if (m) {
    const key = m[1];
    const tab = m[2] ?? "post";
    if (tab === "profile") {
      // 실제 저장 표본과 같은 구조(익명 합성): [DProfileView] 카드 · 스토리 목록(스크롤하면 더 불러옴) · 스토리를 누르면 상세 레이어.
      // 함정: 하트(_likeEmotionRegion)·표정짓기·메뉴(차단·신고)·댓글 입력을 누르면 기록된다(수집기는 누르면 안 됨)
      const name = key === "MKDAON" ? "다온" : "나래";
      const D = ["2026년 2월 23일 오전 12:27", "2026년 1월 30일 오후 8:20", "2026년 1월 30일 오후 8:19", "2026년 1월 30일 오후 8:18"];
      const T = ["SPIN-OFF! 코인으로 비리 건 해결 후 복귀", "Coin", "Notice", "Profile"];
      const FULL = ["SPIN-OFF! 코인으로 비리 건 해결 후 복귀\n다음 이야기는 3월에.", "Coin", "Notice\n공지 전문 둘째 줄", "Profile"];
      const C = [0, 18, 2, 0];
      const R = [1, 4, 0, 0];
      const story = (i) => `<li data-viewname="DProfileStoryListItemView" class="storyItem"><div class="storyContent _storyDetail"><time class="time">${D[i]}</time>
        <div data-viewname="DProfileStoryTextView"><div class="txtBody -listType">${T[i]}</div></div>${i === 0 ? `<div class="_snippetRegion"><img src="http://127.0.0.1:4589/img/post_photo_2.png" width="80"></div>` : ""}
        <a href="/band/${BAND}/member/${key}" class="storyDetailLink _storyDetail" data-i="${i}"><span class="gSrOnly">스토리 상세</span></a>
        <div data-viewname="DProfileStoryMoreOptionsView" class="moreOptionBox"><button type="button" class="moreButton _btnPostMore">…</button><div class="menuModalLayer _lyMenu" style="display:none"><a href="#" class="_btnMuteMember trap">이 멤버의 글 차단하기</a></div></div>
        <div data-viewname="DProfileStoryListItemReactionCountView" class="reactionButton"><div class="reactionItem"><button type="button" class="uEmotionView -story trap"><span class="count ">${R[i]}</span></button></div><div class="reactionItem"><button type="button" class="comment _commentCountBtn"><span class="_commentCountSpan">${C[i]}</span></button></div></div></div></li>`;
      const comment = (i, j) => `<div data-viewname="DCommentLayoutView" class="cComment"><div data-viewname="DCommentView"><div class="itemWrap"><div class="writeInfo"><img src="http://127.0.0.1:4589/img/avatar_narae.png" alt="나래" width="20"><button type="button" class="nameWrap"><strong class="name">나래</strong></button></div><div class="commentBody"><p class="txt _commentContent">스토리${i + 1} 댓글 ${j + 1}</p><div class="func"><time class="time" title="2026년 2월 1일 오후 1:${String(j).padStart(2, "0")}">2월 1일</time><button type="button" class="reply _replyBtn trap">답글쓰기</button></div></div></div></div></div>`;
      const css = `.cardBox{position:relative}.backImage{display:block;width:100%;height:140px;border-radius:16px;border:0;background-image:url("http://127.0.0.1:4589/img/band_cover.png");background-size:cover}
        .userName{font-size:24px;font-weight:700}.storyList{list-style:none;padding:0}.storyItem{min-height:240px;border-left:2px solid #ddd;padding-left:16px}
        .lyWrap{position:fixed;inset:0;background:#0008;overflow:auto}.postViewer{background:#fff;max-width:600px;margin:40px auto;padding:16px}`;
      const script = `window.__traps=0;document.addEventListener('click',e=>{if(e.target.closest('.trap,._likeEmotionRegion,._emoteMainBtn,._sendMessageButton,textarea'))window.__traps++},true);
        const FULL=${JSON.stringify(FULL)},D=${JSON.stringify(D)},C=${JSON.stringify(C)},R=${JSON.stringify(R)};
        const comment=${comment.toString()};
        let more=true;window.addEventListener('scroll',()=>{if(more&&innerHeight+scrollY>=document.body.scrollHeight-50){more=false;setTimeout(()=>{document.querySelector('.storyList').insertAdjacentHTML('beforeend',document.getElementById('more').innerHTML)},300)}});
        document.addEventListener('click',e=>{const a=e.target.closest('a._storyDetail');if(!a)return;e.preventDefault();const i=+a.dataset.i;setTimeout(()=>{
          const shown=C[i]>10?10:C[i];let cs='';for(let j=C[i]-shown;j<C[i];j++)cs+=comment(i,j);
          document.body.insertAdjacentHTML('beforeend','<section data-viewname="DProfileStoryDetailLayerView" class="lyWrap layer_wrap" role="document"><div class="lyPostViewer"><div class="postViewer"><div data-viewname="DProfileStoryDetailView" class="cPostCard"><div class="postWriterInfoWrap"><span class="profileStoryDetailWriterBox"><em>${name}</em><span>의 스토리</span></span><div class="postListInfoWrap"><time class="time">'+D[i]+'</time></div></div><div class="postMain"><div data-viewname="DProfileStoryDetailCollectionView"><div class="postText"><div class="txtBody">'+FULL[i].replace(/\\n/g,'<br>')+'</div></div></div></div><div data-viewname="DBandProfileStoryReactionMainView"><div class="postCount"><button class="uEmotionView _emotionCountRegion trap"><span class="count">'+R[i]+'</span></button><button type="button" class="comment">댓글 <span class="count _commentCountSpan">'+C[i]+'</span></button></div><div class="addCol _emoteMainBtn"><a href="#" class="addStatus">표정짓기</a></div><div data-viewname="DBandProfileStoryCommentListView" class="commentList"><div data-viewname="DProfileCommentCollectionView" class="sCommentList">'+(C[i]>shown?'<button type="button" class="prevComment _prevCommentBtn">이전 댓글 '+(C[i]-shown)+'개 보기</button>':'')+cs+'</div></div><div class="cCommentWriteNew _commentInputRegion"><textarea class="commentWrite"></textarea><button type="submit" class="_sendMessageButton">보내기</button></div></div></div></div></div><button type="button" class="btnCloseLyPost _btnClose">닫기</button></section>');
          const lay=document.querySelector('[data-viewname=DProfileStoryDetailLayerView]:last-of-type');
          lay.querySelector('._btnClose').addEventListener('click',()=>setTimeout(()=>lay.remove(),150));
          const pb=lay.querySelector('._prevCommentBtn');if(pb)pb.addEventListener('click',()=>setTimeout(()=>{let add='';for(let j=0;j<C[i]-shown;j++)add+=comment(i,j);pb.insertAdjacentHTML('afterend',add);pb.remove()},200));
        },200)});`;
      return send(
        200,
        page(
          `<style>${css}</style><div data-viewname="DProfileMainLayoutView"><div data-viewname="DProfileView" class="_dProfileView"><article class="profileStaticPageSection">
          <div class="cardBox"><button type="button" class="backImage _imgAnchor"></button><p class="joinInfo">2020년 3월 1일</p>
            <div class="reactionBox"><button type="button" class="like _likeEmotionRegion"><div class="uLike"><span class="count _countBtn">7</span></div></button><a href="/band/${BAND}/member/${key}" class="comment _commentBtn"><span class="count _commentCountSpan">2</span></a></div></div>
          <button type="button" class="profileBox _imgAnchor"><span class="profileInner"><img class="profileImage" src="http://127.0.0.1:4589/img/avatar_garam.png" width="120" height="120" alt="프로필 사진"></span></button>
          <div class="profileInfoWrap"><div class="profileInfoBox"><strong class="userName">${name}</strong><span class="userNickname _userDesc">B 27 XX 168 배우</span></div></div></article>
          <section><h3>스토리</h3><ol data-viewname="DProfileStoryListView" class="storyList">${story(0)}${story(1)}</ol><template id="more">${story(2)}${story(3)}</template></section></div></div>`,
          script,
        ),
      );
    }
    const name = key === "MKDAON" ? "다온" : "나래";
    const head = `<div class="accountSectionHeader"><div class="uHeaderWrap"><header class="header"><h1 class="title"><span class="sf_color">${name}</span>님의 글</h1></header></div>
      <ul class="userPostNav"><li><a class="navItem" href="/band/${BAND}/member/${key}/post">글</a></li><li><a class="navItem" href="/band/${BAND}/member/${key}/comment">댓글</a></li></ul></div>`;
    if (tab === "post") {
      const mine = key === "MKDAON" ? [20, 15, 10, 5] : [];
      return send(200, page(`${head}<div id="feed">${mine.map((n) => `<div class="feed-item" style="height:220px">${itemHtml(n)}</div>`).join("")}</div>`));
    }
    // 나래의 댓글: 3번 글에 셋, 8번·13번 글에 하나씩. 항목에는 원글 주소가 없고, 누르면 원글이 레이어로 열린다
    const cs = key === "MKNARAE"
      ? [
          [3, "0", "2026년 3월 1일 오후 11:52"],
          [3, "안녕 @다온 반가워", "2026년 3월 2일 오전 12:20"],
          [3, "저는 다른 나래입니다.", "2026년 3월 2일 오전 1:00"],
          [8, "0", "2026년 3월 1일 오후 11:52"],
          [13, "안녕 @다온 반가워", "2026년 3월 2일 오전 12:20"],
        ]
      : [];
    const items = cs
      .map(([n, text, date], i) => `<a data-viewname="DBandMemberCommentListItemView" href="/band/${BAND}/member/${key}/comment#" class="cCommentOnly gBoxShadow" data-post="${n}">
<p class="comment">${text}</p><p class="body">${n}번 글의 첫 줄 대사.</p><p class="date">${date}</p>
<label for="check_view${i}" class="uCheck -checkbox"><input type="checkbox" id="check_view${i}" class="checkInput _checkInput"><span class="checkLabel"><span class="shape"></span></span></label></a>`)
      .join("");
    const cards = [...new Set(cs.map(([n]) => n))].map((n) => `<template id="post${n}">${postCard(n)}</template>`).join("");
    const script = `window.__layerOpens=0;
      document.addEventListener('click',(e)=>{const a=e.target.closest('a.cCommentOnly');if(!a||e.target.closest('label'))return;e.preventDefault();
        setTimeout(()=>{window.__layerOpens++;const n=a.dataset.post;const box=document.createElement('div');box.className='layerContainerView';
          box.innerHTML='<div role="dialog"><div class="postDetailView"><section class="lyWrap"><div class="lyPostViewer"><div class="postViewer"></div></div></section><button type="button" class="btnLyClose" aria-label="닫기">닫기</button></div></div>';
          box.querySelector('.postViewer').append(document.getElementById('post'+n).content.cloneNode(true));
          box.querySelector('.btnLyClose').addEventListener('click',()=>box.remove());document.body.append(box)},300)});`;
    return send(200, page(`${head}<div data-viewname="DBandMemberCommentListView">${items}</div>${cards}`, script));
  }
  if (url.pathname === "/stats") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(Object.fromEntries(hits)));
  }
  send(404, page("없음"));
});

const img = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://127.0.0.1:4589").pathname.replace("/img/", ""));
  if (name === "broken.png") {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end("<html>로그인이 필요합니다</html>");
  }
  const data = IMG[name] ?? (name === "me.png" ? IMG["avatar_garam.png"] : null);
  if (!data) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": "image/png" });
  res.end(data);
});

band.listen(4588, () => console.log("mock band on 4588"));
img.listen(4589, "127.0.0.1", () => console.log("mock images on 4589"));
