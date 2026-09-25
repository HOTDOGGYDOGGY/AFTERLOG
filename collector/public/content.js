/* AFTERLOG Collector · 밴드 화면 안의 저장 버튼(콘텐츠 스크립트).
   - 화면 왼쪽 아래 작은 막대. 화면마다 버튼이 다르다(선택 수집 명세 6절):
     글 화면 '이 글 저장' · 밴드 화면 '이 밴드 글 전체 저장' · 인물 화면 '이 인물의 글 / 댓글만 / 댓글 단 글까지' ·
     인물 댓글 목록 '이 댓글 목록 저장 / 연결된 원글까지' · 공통 '골라서 저장…'(범위 정하기) · '수집 관리'
   - 누르면 확장의 수집 관리 창이 열려 작업을 만들고 바로 시작한다. 이 스크립트는 밴드에 글·댓글·표정을 쓰지 않고, 페이지 내용을 읽지도 않는다.
   - 밴드는 주소만 바뀌는 화면 전환을 하므로 주소를 주기적으로 확인해 버튼을 바꾼다. */
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
    m = u.pathname.match(/^\/band\/(\d+)\/member\/([^/]+)(\/.*)?$/);
    if (m) return { kind: "member", bandNo: m[1] };
    m = u.pathname.match(/^\/band\/(\d+)(\/.*)?$/);
    if (m) return { kind: "band", bandNo: m[1] };
    return null;
  }

  // 화면마다 보여 줄 버튼(선택 수집 명세 6절). [동작, 글자, 강조]
  var ACTIONS = {
    post: [["post", "이 글 저장", true], ["form", "골라서 저장…"]],
    band: [["list", "이 밴드 글 전체 저장", true], ["form", "골라서 저장…"]],
    member: [["sel:A", "이 인물의 글", true], ["sel:B", "댓글만"], ["sel:ABC", "댓글 단 글까지"], ["form", "골라서 저장…"]],
    memberComment: [["sel:B", "이 댓글 목록 저장", true], ["sel:BC", "연결된 원글까지"], ["form", "골라서 저장…"]],
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

  var last = "";
  function refresh() {
    if (location.href === last) return;
    last = location.href;
    var p = parse(location.href);
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
  }

  function flash(text) {
    note.textContent = text;
    note.hidden = false;
    setTimeout(function () {
      note.hidden = true;
    }, 4000);
  }

  root.addEventListener("click", function (e) {
    var act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
    // 밴드 페이지 스크립트가 흉내 낸 클릭은 받지 않는다(사람이 누른 것만)
    if (!act || !e.isTrusted) return;
    if (act === "hide") return setHidden(true);
    if (act === "show") return setHidden(false);
    try {
      chrome.runtime.sendMessage({ type: "afterlog-save", act: act, url: location.href }, function () {
        if (chrome.runtime.lastError) flash("확장을 다시 불러와 주세요(chrome://extensions)");
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
})();
