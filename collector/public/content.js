/* AFTERLOG Collector · 밴드 화면 안의 저장 버튼(콘텐츠 스크립트).
   - 화면 왼쪽 아래 작은 막대. 화면마다 버튼이 다르다(선택 수집 명세 6절):
     글 화면 '이 글 저장' · 밴드 화면 '이 밴드 글 전체 저장' · 인물 화면 '이 인물의 글 / 댓글만 / 댓글 단 글까지' ·
     인물 댓글 목록 '이 댓글 목록 저장 / 연결된 원글까지' · 공통 '골라서 저장…'(범위 정하기) · '수집 관리'
   - 누르면 확장의 수집 관리 창이 열려 작업을 만들고 바로 시작한다. 이 스크립트는 밴드에 글·댓글·표정을 쓰지 않고, 글 내용을 읽지 않는다.
   - '직접 열며 수집'을 켜면 사용자가 여는 화면(프로필·스토리·팝업·사진 탭)이 바뀔 때마다 알려 수집 관리 창이 그 화면을 읽게 한다.
     바뀜 판단에는 화면 구조 표시(열린 영역·항목 수·이름)만 쓰고 그 값은 어디에도 보내지 않는다. 누르거나 쓰지 않는다.
   - 밴드는 주소만 바뀌는 화면 전환을 하고, 프로필은 주소 변화 없이 팝업으로 열리기도 한다(실제 저장 표본).
     그래서 주소와 함께 '열린 프로필 팝업이 있는지'(화면 구조 표시만, 내용은 읽지 않음)를 주기적으로 확인해 버튼을 바꾼다. */
(function () {
  "use strict";
  if (window.top !== window || document.getElementById("afterlog-collector-bar")) return;
  var HIDE_KEY = "afterlog.collectorBar.hidden";

  function parse(href) {
    var u;
    try {
      u = new URL(href);
    } catch (e) {
      return null;
    }
    var m = u.pathname.match(/^\/band\/(\d+)\/post\/(\d+)\/?$/);
    if (m) return { kind: "post", bandNo: m[1] };
    m = u.pathname.match(/^\/band\/(\d+)\/member\/([^/]+)\/comment\/?$/);
    if (m) return { kind: "memberComment", bandNo: m[1] };
    m = u.pathname.match(/^\/band\/(\d+)\/member\/([^/]+)\/profile\/?$/);
    if (m) return { kind: "profile", bandNo: m[1] };
    m = u.pathname.match(/^\/band\/(\d+)\/member\/([^/]+)(\/.*)?$/);
    if (m) return { kind: "member", bandNo: m[1] };
    m = u.pathname.match(/^\/band\/(\d+)(\/.*)?$/);
    // 검색 결과 화면(주소 형식은 실제 화면으로 확인 전: 경로에 search가 있거나 검색어 매개변수가 있을 때)
    if (m && (/\/search/.test(u.pathname) || /[?&](keyword|query|q|searchKeyword)=/.test(u.search))) return { kind: "search", bandNo: m[1] };
    if (m) return { kind: "band", bandNo: m[1] };
    return null;
  }

  // 화면마다 보여 줄 버튼(선택 수집 명세 6절). [동작, 글자, 강조]
  var ACTIONS = {
    post: [["post", "이 글 저장", true], ["follow", "직접 열며 수집"], ["form", "골라서 저장…"]],
    band: [["list", "이 밴드 글 전체 저장", true], ["follow", "직접 열며 수집"], ["form", "골라서 저장…"]],
    member: [["sel:A", "이 인물의 글", true], ["sel:B", "댓글만"], ["sel:ABC", "댓글 단 글까지"], ["sel:P", "이 프로필 저장"], ["follow", "직접 열며 수집"], ["form", "골라서 저장…"]],
    // 프로필 화면: 주 버튼은 프로필 저장(스토리·스토리 댓글 포함). 글·댓글 목록은 따로 고른다
    profile: [["sel:P", "이 프로필 저장", true], ["sel:A", "이 인물의 글"], ["sel:B", "댓글만"], ["sel:ABC", "댓글 단 글까지"], ["follow", "직접 열며 수집"], ["form", "골라서 저장…"]],
    // 주소가 그대로인 프로필 팝업(멤버 목록 등 위에 열림)
    popup: [["popup", "이 프로필 저장", true], ["follow", "직접 열며 수집"], ["form", "골라서 저장…"]],
    memberComment: [["sel:B", "이 댓글 목록 저장", true], ["sel:BC", "연결된 원글까지"], ["follow", "직접 열며 수집"], ["form", "골라서 저장…"]],
    search: [["search", "이 검색 결과 저장", true], ["follow", "직접 열며 수집"], ["form", "검색 조건 수정…"]],
  };

  var host = document.createElement("div");
  host.id = "afterlog-collector-bar";
  host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483000;";
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    "<style>" +
    ":host{all:initial}[hidden]{display:none!important}" +
    ".acts{display:contents}" +
    ".bar{display:flex;align-items:center;gap:6px;padding:6px;border-radius:10px;background:#202329;color:#eceef2;box-shadow:0 6px 20px rgba(0,0,0,.35);font:13px/1.2 system-ui,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}" +
    ".brand{font-weight:800;letter-spacing:.06em;font-size:11px;padding:0 4px 0 6px;color:#aab2bf}" +
    "button{font:inherit;border:0;border-radius:7px;height:30px;padding:0 10px;cursor:pointer;background:#2d3139;color:#eceef2;white-space:nowrap}" +
    "button:hover{background:#383d46}button.primary{background:#b9cbe0;color:#16202c;font-weight:600}button.primary:hover{background:#c9d8ea}" +
    "button:disabled{opacity:.45;cursor:default}button.icon{width:26px;padding:0;background:transparent;color:#aab2bf}" +
    ".pill{height:30px;padding:0 12px;border-radius:15px;background:#202329;color:#eceef2;box-shadow:0 4px 14px rgba(0,0,0,.3)}" +
    ".note{font-size:11px;color:#aab2bf;padding:0 4px}" +
    "</style>" +
    '<div class="bar" part="bar">' +
    '<span class="brand">AFTERLOG</span>' +
    '<span class="acts"></span>' +
    '<button type="button" data-act="manager">수집 관리</button>' +
    '<span class="note" hidden></span>' +
    '<button type="button" class="icon" data-act="hide" title="숨기기(이 탭에서만)" aria-label="저장 막대 숨기기">×</button>' +
    "</div>" +
    '<button type="button" class="pill" data-act="show" hidden>AFTERLOG 저장</button>';

  var bar = root.querySelector(".bar");
  var pill = root.querySelector(".pill");
  var acts = root.querySelector(".acts");
  var note = root.querySelector(".note");

  function setHidden(h) {
    bar.hidden = h;
    pill.hidden = !h;
    try {
      sessionStorage.setItem(HIDE_KEY, h ? "1" : "");
    } catch (e) {
      /* 무시 */
    }
  }

  // 보이는 프로필 팝업이 하나 열려 있는가(구조 표시만 확인). 프로필 페이지 자체에서는 팝업으로 보지 않는다
  function popupOpen() {
    var els = document.querySelectorAll("[data-viewname='DProfileLayerView']");
    var n = 0;
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(els[i]).visibility !== "hidden") n++;
    }
    return n;
  }

  var last = "";
  function refresh() {
    var p = parse(location.href);
    var pop = p && p.kind !== "profile" ? popupOpen() : 0;
    var sig = location.href + "|" + pop;
    if (sig === last) return;
    last = sig;
    if (p && pop) p = { kind: "popup", bandNo: p.bandNo };
    host.style.display = p ? "" : "none";
    if (!p) return;
    acts.textContent = "";
    ACTIONS[p.kind].forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-act", a[0]);
      b.textContent = a[1];
      if (a[2]) b.className = "primary";
      acts.appendChild(b);
    });
    if (following) setFollow(true, "");
  }

  // ---- 직접 열며 수집 ----
  var following = false;
  var lastSig = "";
  var sigTimer = null;
  function screenSig() {
    var parts = [location.href];
    var vis = function (el) {
      return !!el && el.getClientRects().length > 0;
    };
    var pops = document.querySelectorAll("[data-viewname='DProfileLayerView']");
    for (var i = 0; i < pops.length; i++) if (vis(pops[i])) parts.push("pop:" + ((pops[i].querySelector(".userName") || {}).textContent || ""));
    parts.push("page:" + !!document.querySelector("[data-viewname='DProfileView']"));
    parts.push("stories:" + document.querySelectorAll("[data-viewname='DProfileStoryListItemView']").length);
    parts.push("empty:" + !!document.querySelector("[data-viewname='DProfileStoryListView'] .uEmpty"));
    var ds = document.querySelectorAll("[data-viewname='DProfileStoryDetailView']");
    for (var j = 0; j < ds.length; j++)
      if (vis(ds[j])) parts.push("detail:" + ((ds[j].querySelector("time") || {}).textContent || "") + ":" + ds[j].querySelectorAll(".cComment").length + ":" + ((ds[j].querySelector(".txtBody") || {}).textContent || "").length);
    parts.push("photos:" + document.querySelectorAll("[data-viewname='DBandMemberPhotoListItemView']").length);
    // 열린 레이어(해석 못 하는 화면 포함: 예 프로필 사진 보기)의 구조 이름과 이미지 수
    var ls = document.querySelectorAll("section.lyWrap, div.lyWrap, [role='dialog'], [aria-modal='true'], [data-viewname$='LayerView'], [data-viewname*='Viewer']");
    for (var k = 0; k < ls.length; k++)
      if (vis(ls[k]) && !host.contains(ls[k])) parts.push("layer:" + (ls[k].getAttribute("data-viewname") || ls[k].className) + ":" + ls[k].querySelectorAll("img").length);
    return parts.join("|");
  }
  function checkScreen() {
    if (!following) return;
    var sig = screenSig();
    if (sig === lastSig) return;
    lastSig = sig;
    try {
      chrome.runtime.sendMessage({ type: "afterlog-follow-change" }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      /* 무시 */
    }
  }
  // 화면이 바뀌면 잠깐 모았다가(0.8초 조용할 때) 한 번만 알린다. 하트 애니메이션 같은 변화는 표시 값이 같아 무시된다
  new MutationObserver(function (list) {
    if (!following) return;
    for (var i = 0; i < list.length; i++) if (host.contains(list[i].target)) return;
    clearTimeout(sigTimer);
    sigTimer = setTimeout(checkScreen, 800);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
  function setFollow(on, text) {
    following = on;
    var b = acts.querySelector('[data-act="follow"]');
    if (b) {
      b.textContent = on ? "직접 열며 수집 중 · 멈추기" : "직접 열며 수집";
      b.className = on ? "primary" : "";
    }
    if (text) flash(text, on ? 8000 : 4000);
    if (on) {
      lastSig = "";
      setTimeout(checkScreen, 300);
    }
  }
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === "afterlog-follow-state") setFollow(!!msg.on, msg.text || "");
  });

  function flash(text, ms) {
    note.textContent = text;
    note.hidden = false;
    setTimeout(function () {
      note.hidden = true;
    }, ms || 4000);
  }

  root.addEventListener("click", function (e) {
    var act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
    // 밴드 페이지 스크립트가 흉내 낸 클릭은 받지 않는다(사람이 누른 것만)
    if (!act || !e.isTrusted) return;
    if (act === "hide") return setHidden(true);
    if (act === "show") return setHidden(false);
    if (act === "follow" && following) {
      try {
        chrome.runtime.sendMessage({ type: "afterlog-follow-stop" }, function () {
          void chrome.runtime.lastError;
        });
      } catch (err) {
        /* 무시 */
      }
      return setFollow(false, "직접 열며 수집을 멈췄습니다");
    }
    try {
      chrome.runtime.sendMessage({ type: "afterlog-save", act: act, url: location.href }, function () {
        if (chrome.runtime.lastError) flash("확장을 다시 불러와 주세요(chrome://extensions)");
        else if (act === "follow") flash("수집 관리 창을 연 채로, 저장할 인물의 프로필·스토리·사진 화면을 차례로 여세요", 8000);
        else if (act !== "manager" && act !== "form") flash("수집 관리 창에서 시작합니다");
      });
    } catch (err) {
      flash("확장이 업데이트되었습니다. 이 페이지를 새로 고쳐 주세요.");
    }
  });

  var hidden = false;
  try {
    hidden = sessionStorage.getItem(HIDE_KEY) === "1";
  } catch (e) {
    /* 무시 */
  }
  setHidden(hidden);
  refresh();
  document.documentElement.appendChild(host);
  setInterval(refresh, 800);
  // 페이지가 새로 열려도(주소 이동) 직접 열며 수집 중이면 이어서
  try {
    chrome.runtime.sendMessage({ type: "afterlog-follow-query" }, function (r) {
      if (chrome.runtime.lastError) return;
      if (r && r.on) setFollow(true, r.text || "");
    });
  } catch (e) {
    /* 무시 */
  }
})();
