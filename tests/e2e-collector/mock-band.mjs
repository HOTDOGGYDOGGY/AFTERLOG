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
  return html;
}

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
    const items = (from, to) => Array.from({ length: to - from }, (_, i) => `<div class="feed-item" style="height:220px"><a href="/band/${BAND}/post/${TOTAL - from - i}">글 ${TOTAL - from - i}</a></div>`).join("");
    const script = `let shown=8;const all=${TOTAL};const feed=document.getElementById('feed');
      window.addEventListener('scroll',()=>{if(window.innerHeight+window.scrollY>=document.body.scrollHeight-50&&shown<all&&!window.__loading){window.__loading=true;setTimeout(()=>{const from=shown;shown=Math.min(all,shown+8);
      for(let i=from;i<shown;i++){const d=document.createElement('div');d.className='feed-item';d.style.height='220px';d.innerHTML='<a href="/band/${BAND}/post/'+(all-i)+'">글 '+(all-i)+'</a>';feed.append(d)}
      // 가상화: 오래된 항목은 화면에서 지운다
      while(feed.children.length>12)feed.firstElementChild.remove();window.__loading=false},400)}});`;
    return send(200, page(`<div id="feed">${items(0, 8)}</div>`, script));
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
