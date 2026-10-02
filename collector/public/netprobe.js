/* AFTERLOG Collector · 자료 구조 시험(밴드 페이지 안, MAIN world, document_start).
   - 저장 막대의 '자료 구조 시험'을 켠 탭(sessionStorage 표식)에서만 동작한다. 꺼져 있으면 아무것도 감싸지 않는다.
   - 밴드 페이지가 스스로 받아 오는 응답(fetch·XHR)을 복사본으로 읽어 **모양만** 남긴다: 주소 경로(숫자는 :n), 매개변수 이름, 상태,
     자료의 열쇠 이름·값 종류·배열 길이. 글 내용·이름·주소 값·토큰은 저장하지 않는다.
   - 요청을 새로 보내거나 바꾸지 않는다. 응답 원본은 페이지에 그대로 간다(clone만 읽음).
   - 결과는 이 탭의 sessionStorage에 모아 두고, 막대의 '시험 끝·저장'이 파일로 내려받은 뒤 지운다. */
(function () {
  "use strict";
  var FLAG = "afterlog.netprobe";
  var DATA = "afterlog.netprobe.data";
  var MAX_DEPTH = 10;
  var MAX_KEYS = 120;

  // ---------- 모양 요약(값 없이) ----------
  var KNOWN_HOST = /(^|\.)(band\.us|pstatic\.net|naver\.net|naver\.com|localhost|127\.0\.0\.1)(:\d+)?$/i;
  function hostClass(h) {
    if (!h) return "";
    return KNOWN_HOST.test(h) ? h.replace(/^[^.]*\d[^.]*\./, "*.") : "other";
  }
  function urlKind(s) {
    var u;
    try {
      u = new URL(s);
    } catch (e) {
      return "url:bad";
    }
    var keys = [];
    u.searchParams.forEach(function (_v, k) {
      if (keys.indexOf(k) < 0) keys.push(k);
    });
    var img = /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(u.pathname) || /phinf/i.test(u.host);
    var vid = /\.(mp4|mov|m3u8|webm)$/i.test(u.pathname);
    return "url:" + hostClass(u.host) + (img ? ":img" : vid ? ":video" : "") + (keys.length ? "?" + keys.sort().join("&") : "");
  }
  function stringKind(s) {
    if (s === "") return "str:empty";
    if (/^https?:\/\//i.test(s)) return urlKind(s);
    if (/^\d+$/.test(s)) return "str:digits" + s.length;
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(s)) return "str:date";
    if (/^[0-9a-f]{16,}$/i.test(s) || /^[A-Za-z0-9_-]{24,}={0,2}$/.test(s)) return "str:token";
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return "str:color";
    return "str:text" + (s.length <= 20 ? "S" : s.length <= 200 ? "M" : "L");
  }
  function numberKind(n) {
    if (!isFinite(n)) return "num:nan";
    if (n % 1 !== 0) return "num:float";
    if (n >= 1e12 && n < 4e12) return "num:epochMs";
    var d = String(Math.abs(n)).length;
    return "num:int" + (d <= 2 ? "S" : d <= 6 ? "M" : "L" + d);
  }
  function kindOf(v) {
    if (v === null) return "null";
    if (typeof v === "string") return stringKind(v);
    if (typeof v === "number") return numberKind(v);
    if (typeof v === "boolean") return "bool";
    return typeof v;
  }
  // 열쇠 이름이 값처럼 생겼으면(인물 번호를 열쇠로 쓴 표 등) 가린다
  function safeKey(k) {
    if (/^\d+$/.test(k)) return ":n";
    if (/^[0-9a-f]{12,}$/i.test(k) || /^[A-Za-z0-9_-]{24,}$/.test(k)) return ":id";
    if (/[^\x20-\x7e]/.test(k)) return ":text";
    return k.length > 60 ? k.slice(0, 60) + "…" : k;
  }
  function shapeOf(v, depth) {
    depth = depth || 0;
    if (Array.isArray(v)) {
      var s = { t: "arr", seen: 1, min: v.length, max: v.length, sum: v.length, e: null };
      if (depth < MAX_DEPTH) for (var i = 0; i < v.length; i++) s.e = merge(s.e, shapeOf(v[i], depth + 1));
      return s;
    }
    if (v && typeof v === "object") {
      var o = { t: "obj", seen: 1, k: {} };
      var keys = Object.keys(v);
      if (depth < MAX_DEPTH)
        for (var j = 0; j < keys.length && j < MAX_KEYS; j++) {
          var sk = safeKey(keys[j]);
          o.k[sk] = merge(o.k[sk], shapeOf(v[keys[j]], depth + 1));
        }
      if (keys.length > MAX_KEYS) o.more = keys.length - MAX_KEYS;
      return o;
    }
    var vs = { t: "val", seen: 1, kinds: {} };
    vs.kinds[kindOf(v)] = 1;
    return vs;
  }
  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.t !== b.t) {
      // 같은 자리에 다른 종류가 오면 둘 다 남긴다
      var alt = { t: "mixed", seen: (a.seen || 1) + (b.seen || 1), of: {} };
      [a, b].forEach(function (x) {
        if (x.t === "mixed") for (var key in x.of) alt.of[key] = merge(alt.of[key], x.of[key]);
        else alt.of[x.t] = merge(alt.of[x.t], x);
      });
      return alt;
    }
    var out = { t: a.t, seen: (a.seen || 1) + (b.seen || 1) };
    if (a.t === "arr") {
      out.min = Math.min(a.min, b.min);
      out.max = Math.max(a.max, b.max);
      out.sum = a.sum + b.sum;
      out.e = merge(a.e, b.e);
    } else if (a.t === "obj") {
      out.k = {};
      var ks = Object.keys(a.k).concat(Object.keys(b.k));
      for (var i = 0; i < ks.length; i++) if (!out.k[ks[i]]) out.k[ks[i]] = merge(a.k[ks[i]], b.k[ks[i]]);
      if (a.more || b.more) out.more = Math.max(a.more || 0, b.more || 0);
    } else if (a.t === "val") {
      out.kinds = {};
      [a.kinds, b.kinds].forEach(function (ks2) {
        for (var k in ks2) out.kinds[k] = (out.kinds[k] || 0) + ks2[k];
      });
    } else if (a.t === "mixed") {
      out.of = {};
      for (var k1 in a.of) out.of[k1] = a.of[k1];
      for (var k2 in b.of) out.of[k2] = merge(out.of[k2], b.of[k2]);
    }
    return out;
  }
  /** 주소 → 값 없는 모양: 호스트 종류 + 경로(숫자·긴 식별자는 가림) + 매개변수 이름 */
  function endpointOf(rawUrl, base) {
    var u;
    try {
      u = new URL(rawUrl, base);
    } catch (e) {
      return { host: "bad", path: "bad", query: [] };
    }
    var path = u.pathname
      .split("/")
      .map(function (seg) {
        if (/^\d{3,}$/.test(seg)) return ":n";
        if (/^[0-9a-f]{12,}$/i.test(seg) || /^[A-Za-z0-9_-]{24,}$/.test(seg)) return ":id";
        if (/%[0-9a-f]{2}/i.test(seg) || /[^\x20-\x7e]/.test(seg)) return ":text";
        return seg;
      })
      .join("/");
    var q = [];
    u.searchParams.forEach(function (_v, k) {
      var sk = safeKey(k);
      if (q.indexOf(sk) < 0) q.push(sk);
    });
    return { host: hostClass(u.host), path: path, query: q.sort() };
  }
  function sizeBucket(n) {
    return n < 1024 ? "<1KB" : n < 10240 ? "<10KB" : n < 102400 ? "<100KB" : n < 1048576 ? "<1MB" : ">=1MB";
  }
  /** 응답 본문을 JSON으로(JSONP 감싸기도 벗김). 못 읽으면 null */
  function parseBody(text) {
    var t = (text || "").trim();
    if (!t) return null;
    var c = t.charAt(0);
    try {
      if (c === "{" || c === "[") return { kind: "json", v: JSON.parse(t) };
      var m = /^[\w$.]+\(([\s\S]*)\)\s*;?$/.exec(t);
      if (m) return { kind: "jsonp", v: JSON.parse(m[1]) };
    } catch (e) {
      return null;
    }
    return null;
  }
  /** 한 응답 → 모음에 더하기(값은 남기지 않음) */
  function addResponse(store, info) {
    var ep = endpointOf(info.url, info.base);
    var key = (info.method || "GET").toUpperCase() + " " + ep.host + ep.path;
    var e = store.endpoints[key];
    if (!e) {
      e = store.endpoints[key] = { method: (info.method || "GET").toUpperCase(), host: ep.host, path: ep.path, query: [], via: {}, status: {}, ctype: {}, size: {}, body: {}, count: 0, shape: null };
      store.order.push(key);
    }
    e.count++;
    ep.query.forEach(function (k) {
      if (e.query.indexOf(k) < 0) e.query.push(k);
    });
    e.query.sort();
    e.via[info.via] = (e.via[info.via] || 0) + 1;
    e.status[info.status] = (e.status[info.status] || 0) + 1;
    var ct = String(info.ctype || "").split(";")[0].trim() || "none";
    e.ctype[ct] = (e.ctype[ct] || 0) + 1;
    var sb = sizeBucket((info.text || "").length);
    e.size[sb] = (e.size[sb] || 0) + 1;
    var p = parseBody(info.text);
    var bk = p ? p.kind : /html/i.test(ct) ? "html" : (info.text || "").length ? "text" : "empty";
    e.body[bk] = (e.body[bk] || 0) + 1;
    if (p) e.shape = merge(e.shape, shapeOf(p.v));
    store.responses++;
    return store;
  }

  var api = { shapeOf: shapeOf, merge: merge, endpointOf: endpointOf, addResponse: addResponse, kindOf: kindOf };
  if (typeof module === "object" && module && module.exports) module.exports = api;

  // ---------- 페이지 안 설치(시험을 켠 탭에서만) ----------
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  var on = false;
  try {
    on = sessionStorage.getItem(FLAG) === "1";
  } catch (e) {
    on = false;
  }
  if (!on || window.__afterlogNetprobeInstalled) return;
  window.__afterlogNetprobeInstalled = true;

  function load() {
    try {
      var s = JSON.parse(sessionStorage.getItem(DATA) || "null");
      if (s && s.endpoints && s.order) return s;
    } catch (e) {
      /* 새로 시작 */
    }
    return { schema: "afterlog.netprobe/1", startedAt: new Date().toISOString(), responses: 0, skipped: 0, endpoints: {}, order: [], pages: [] };
  }
  var pending = null;
  function record(info) {
    try {
      if (sessionStorage.getItem(FLAG) !== "1") return;
      var s = pending || load();
      // 너무 큰 응답은 모양만 보기에도 부담이라 크기만
      if ((info.text || "").length > 5 * 1048576) {
        info.text = "";
        s.skipped++;
      }
      addResponse(s, info);
      pending = s;
      // 잦은 쓰기를 모아서 한 번에
      setTimeout(flush, 300);
    } catch (e) {
      /* 시험 실패가 페이지를 막지 않게 */
    }
  }
  function flush() {
    if (!pending) return;
    try {
      sessionStorage.setItem(DATA, JSON.stringify(pending));
    } catch (e) {
      /* 저장 공간 부족: 이번 것은 버림 */
    }
    pending = null;
  }
  var base = location.href;

  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      var p = origFetch.apply(this, arguments);
      try {
        var method = (init && init.method) || (input && typeof input === "object" && input.method) || "GET";
        var url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
        p.then(
          function (res) {
            try {
              res
                .clone()
                .text()
                .then(
                  function (t) {
                    record({ via: "fetch", method: method, url: res.url || url, base: base, status: res.status, ctype: res.headers.get("content-type"), text: t });
                  },
                  function () {},
                );
            } catch (e) {
              /* 읽을 수 없는 응답 */
            }
          },
          function () {},
        );
      } catch (e) {
        /* 무시 */
      }
      return p;
    };
  }

  var XO = XMLHttpRequest.prototype.open;
  var XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__alProbe = { method: method, url: String(url) };
    } catch (e) {
      /* 무시 */
    }
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var x = this;
    try {
      if (x.__alProbe)
        x.addEventListener("loadend", function () {
          try {
            var t = "";
            if (x.responseType === "" || x.responseType === "text") t = x.responseText;
            else if (x.responseType === "json" && x.response != null) t = JSON.stringify(x.response);
            record({ via: "xhr", method: x.__alProbe.method, url: x.responseURL || x.__alProbe.url, base: base, status: x.status, ctype: x.getResponseHeader("content-type"), text: t });
          } catch (e) {
            /* 무시 */
          }
        });
    } catch (e) {
      /* 무시 */
    }
    return XS.apply(this, arguments);
  };
})();
