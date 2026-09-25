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
  html = html.replace('<span class="count">10</span>', `<span class="count">${n === 7 ? 14 : 8}</span>`);
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
    return send(200, page(`<div id="app"></div><template id="t">${postCard(n)}</template>`, `setTimeout(()=>{document.getElementById('app').append(document.getElementById('t').content.cloneNode(true))},600)`));
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
  // 인물(멤버) 화면: 프로필 · 작성글 목록 · 작성댓글 목록(실제 저장 샘플과 같은 구조)
  m = url.pathname.match(new RegExp(`^/band/${BAND}/member/(MK[A-Z]+)(?:/(post|comment))?$`));
  if (m) {
    const key = m[1];
    const tab = m[2] ?? "post";
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
