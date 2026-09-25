/* AFTERLOG ↔ 기존 RPBA 도구 연결(자식 쪽). 명세 v1.2 15.3.
   - 부모(같은 출처)의 명령만 받는다: origin·source·protocol·moduleId 확인.
   - 모듈은 window.__rpbaModule 에 snapshot/load/export 함수를 등록한다(각 도구 스크립트 끝).
   - postMessage('*')를 쓰지 않는다. 대상 출처를 항상 지정한다.
   - 이미지 저장은 CDN이 아니라 ./vendor/html2canvas.min.js(앱에 번들)를 쓴다. */
(function () {
  "use strict";
  var PROTOCOL = "afterlog-legacy";
  var V = 1;
  var params = new URLSearchParams(location.search);
  var moduleId = params.get("moduleId") || "";
  var origin = location.origin;
  var loading = false;
  var dirtyTimer = null;

  function send(msg) {
    if (window.parent === window) return;
    msg.protocol = PROTOCOL;
    msg.v = V;
    msg.moduleId = moduleId;
    window.parent.postMessage(msg, origin);
  }

  function markDirty() {
    if (loading) return;
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(function () {
      send({ type: "dirty" });
    }, 200);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.html2canvas) return resolve();
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error("이미지 저장 도구(html2canvas)를 불러오지 못했습니다."));
      };
      document.head.appendChild(s);
    });
  }

  function canvasToBlob(canvas, type) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        b ? resolve(b) : reject(new Error("이미지를 만들지 못했습니다(캔버스 크기 제한일 수 있음)."));
      }, type || "image/png");
    });
  }

  /** 대상 요소를 그려 최대 높이마다 나눈 PNG들(부모가 파일로 받는다) */
  async function renderPng(m) {
    await loadScript("./vendor/html2canvas.min.js");
    var t = m.pngTarget();
    var scale = 2;
    var maxCss = 3000;
    try {
      var canvas = await window.html2canvas(t.el, { backgroundColor: t.bg || null, scale: scale, useCORS: true, logging: false });
      var files = [];
      var maxPx = maxCss * scale;
      var parts = Math.max(1, Math.ceil(canvas.height / maxPx));
      for (var i = 0; i < parts; i++) {
        var part = document.createElement("canvas");
        part.width = canvas.width;
        part.height = Math.min(maxPx, canvas.height - i * maxPx);
        part.getContext("2d").drawImage(canvas, 0, -i * maxPx);
        var num = parts > 1 ? "_" + String(i + 1).padStart(2, "0") : "";
        files.push({ name: m.fileBase + num + ".png", blob: await canvasToBlob(part) });
        part.width = part.height = 0;
      }
      canvas.width = canvas.height = 0;
      return files;
    } finally {
      if (t.cleanup) t.cleanup();
    }
  }

  window.addEventListener("message", async function (e) {
    if (e.origin !== origin || e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.protocol !== PROTOCOL || d.moduleId !== moduleId || !d.requestId) return;
    var m = window.__rpbaModule;
    function reply(ok, result, error) {
      send({ type: "response", requestId: d.requestId, ok: ok, result: result, error: error });
    }
    if (!m) return reply(false, undefined, "도구가 아직 준비되지 않았습니다.");
    try {
      switch (d.type) {
        case "snapshot":
          // 편집 중인 칸의 변경을 먼저 확정한다
          if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
          reply(true, m.snapshot());
          break;
        case "load":
          loading = true;
          try {
            m.load(d.payload || null);
          } finally {
            setTimeout(function () {
              loading = false;
            }, 400);
          }
          reply(true);
          break;
        case "undo":
          if (m.undo) m.undo();
          reply(true);
          break;
        case "redo":
          if (m.redo) m.redo();
          reply(true);
          break;
        case "setTheme":
          document.documentElement.setAttribute("data-afterlog-theme", String(d.payload));
          reply(true);
          break;
        case "importText":
          m.importText(String(d.payload || ""));
          markDirty();
          reply(true);
          break;
        case "export": {
          var f = d.payload && d.payload.format;
          if (f === "html") reply(true, { files: [{ name: m.fileBase + ".html", blob: new Blob([m.exportHtml()], { type: "text/html;charset=utf-8" }) }] });
          else if (f === "copy") reply(true, { text: m.copyHtml() });
          else if (f === "png") reply(true, { files: await renderPng(m) });
          else reply(false, undefined, "지원하지 않는 형식입니다.");
          break;
        }
        default:
          reply(false, undefined, "알 수 없는 명령입니다.");
      }
    } catch (err) {
      reply(false, undefined, String((err && err.message) || err));
    }
  });

  function start() {
    var m = window.__rpbaModule;
    if (!m) return setTimeout(start, 50);
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("focusout", markDirty, true);
    var root = m.watchRoot ? m.watchRoot() : document.body;
    new MutationObserver(markDirty).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["src", "class", "style"] });
    send({ type: "ready", capabilities: m.capabilities, stateVersion: m.stateVersion });
  }
  start();
})();
