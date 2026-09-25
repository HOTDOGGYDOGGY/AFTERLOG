// AFTERLOG Collector 백그라운드. 수집은 '수집 관리' 페이지에서 돈다(브라우저가 이 스크립트를 수시로 끌 수 있으므로
// 여기에 작업 상태를 두지 않는다). 확장 아이콘 클릭은 팝업이 처리한다.
chrome.runtime.onInstalled.addListener(() => {});

// 밴드 화면 안의 저장 막대(content.js)에서 온 요청: 수집 관리 창을 열어 작업을 만들고 시작하게 한다.
// 보낸 탭 정보는 브라우저가 붙여 주는 sender.tab만 믿는다.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "afterlog-save" || !sender.tab || sender.id !== chrome.runtime.id) return;
  const q = new URLSearchParams();
  if (msg.act === "post") {
    q.set("new", "post");
    q.set("tabId", String(sender.tab.id));
    q.set("url", sender.tab.url || "");
  } else if (msg.act === "list") {
    q.set("new", "list");
    q.set("url", sender.tab.url || "");
  } else if (typeof msg.act === "string" && /^sel:[ABC]+$/.test(msg.act)) {
    // 인물 선택 수집: A 쓴 글 · B 쓴 댓글만 · C 댓글 단 글
    q.set("new", "sel");
    q.set("modes", msg.act.slice(4));
    q.set("url", sender.tab.url || "");
  } else if (msg.act === "search") {
    // 사용자가 연 검색 결과(주소를 그대로 넘긴다)
    q.set("new", "search");
    q.set("url", sender.tab.url || "");
  } else if (msg.act === "form") {
    // 조건을 정하는 새 수집 화면(이 밴드 주소를 채워 둠). 바로 시작하지 않는다
    q.set("new", "form");
    q.set("url", sender.tab.url || "");
  }
  chrome.tabs.create({ url: chrome.runtime.getURL(`manager.html${q.toString() ? `?${q}` : ""}`) }).then(() => reply({ ok: true }));
  return true;
});
