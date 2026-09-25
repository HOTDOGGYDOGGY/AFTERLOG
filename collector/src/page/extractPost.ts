// 밴드 탭 안에서 실행되는 함수(chrome.scripting.executeScript의 func).
// 주의: 직렬화되어 페이지에 주입되므로 바깥 변수·import를 쓰면 안 된다. 자체 완결형으로 유지할 것.
// 하는 일: 게시글 상세가 안정될 때까지 기다린 뒤 게시글 카드(cPostCard, 없으면 작성자 영역으로 찾은 게시글 범위)만 복제해서 돌려준다.
// 쓰기 동작(표정·댓글·클릭)은 하지 않는다. 로그인 정보·배경 화면은 복사하지 않는다.

export interface PostExtraction {
  ok: boolean;
  /** 실패 원인 분류 */
  reason?: "login" | "not-found" | "timeout" | "multiple";
  message?: string;
  pageUrl: string;
  /** 글 작성자 링크 등에서 찾은 게시글 주소 */
  postHref: string | null;
  bandName: string | null;
  html: string | null;
  commentsShown: number | null;
  commentsFound: number;
  imageUrls: string[];
  /** 로그인한 사용자 확인용(약한 근거: 내 프로필 사진 파일명) */
  accountMarker: string | null;
  waitedMs: number;
  /** 알려진 확인 위치별 발견 개수(진단용, 숫자만) */
  probeCounts: Record<string, number>;
  /** 접힌 댓글 펼치기: 누른 횟수 · 처음 찾은 버튼 수 */
  expandClicks?: number;
  expandCandidates?: number;
  /** 펼치기를 멈춘 이유: 다 받음 · 누를 버튼 없음 · 시간 한도 · 눌러도 새 댓글 없음 · 게시글 화면이 사라짐 */
  expandStop?: "done" | "noButton" | "timeout" | "noProgress" | "cardLost";
  /** 마지막 화면에 있던 댓글 수(누적한 고유 댓글 수는 commentsFound) */
  commentsInDom?: number;
  /** 화면에서 사라졌지만 앞서 읽어 둔 댓글 수(가상 목록 등) */
  commentsKeptFromEarlier?: number;
  /** 펼치는 중 게시글 카드가 다시 그려진 횟수 */
  cardReplaced?: number;
}

export async function extractPostInPage(opts: {
  timeoutMs: number;
  stableMs: number;
  probes: [string, string][];
  /** 접힌 댓글 펼치기 전체 제한 시간 · 한 번 누른 뒤 변화를 기다리는 시간 */
  expandMs?: number;
  expandWaitMs?: number;
}): Promise<PostExtraction> {
  const t0 = Date.now();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const base = {
    pageUrl: location.href,
    postHref: null as string | null,
    bandName: null as string | null,
    html: null as string | null,
    commentsShown: null as number | null,
    commentsFound: 0,
    imageUrls: [] as string[],
    accountMarker: null as string | null,
    waitedMs: 0,
    probeCounts: {} as Record<string, number>,
  };
  const countProbes = (root: ParentNode) => {
    const out: Record<string, number> = {};
    for (const [id, sel] of opts.probes) {
      try {
        out[id] = root.querySelectorAll(sel).length;
      } catch {
        out[id] = 0;
      }
    }
    return out;
  };
  const loginLike = () => /(^|\.)auth\.band\.us$/.test(location.hostname) || /\/login/.test(location.pathname) || !!document.querySelector("input[type=password]");

  // 대상 글 번호(상세 주소에서). 배경 목록과 상세 레이어가 함께 있으면 이 번호로 고른다(C06)
  const targetNo = (location.pathname.match(/\/post\/(\d+)/) ?? [])[1] ?? null;
  const linksTo = (c: Element, sel: string) =>
    Array.from(c.querySelectorAll(sel)).some((a) => new RegExp(`/post/${targetNo}(?:[/?#]|$)`).test(a.getAttribute("href") || ""));
  // 게시글 범위 후보. 목록에서 레이어로 연 글은 .cPostCard 안에 있지만, 글 주소를 바로 연 화면에는 이 클래스가 없다(실사용 진단 0.1.2).
  // 그때는 글 작성자 영역에서 위로 올라가며, 작성자 영역을 하나만 품고 댓글 영역(없으면 본문)까지 품는 가장 가까운 요소를 게시글 범위로 쓴다.
  const WRITER = ".postWriterInfoWrap";
  const scopeFromWriter = (w: Element): Element | null => {
    let bodyHit: Element | null = null;
    for (let a = w.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (a.querySelectorAll(WRITER).length !== 1) break;
      if (a.querySelector(".dPostCommentMainView, .sCommentList")) return a;
      if (!bodyHit && a.querySelector(".postBody, .txtBody")) bodyHit = a;
    }
    return bodyHit;
  };
  const candidates = (): Element[] => {
    const cards = Array.from(document.querySelectorAll(".cPostCard"));
    if (cards.length) return cards;
    const out: Element[] = [];
    for (const w of Array.from(document.querySelectorAll(WRITER))) {
      const sc = scopeFromWriter(w);
      if (sc && !out.includes(sc)) out.push(sc);
    }
    return out;
  };
  const pick = (): { card: Element | null; count: number; ambiguous: boolean } => {
    const all = candidates();
    if (all.length <= 1) return { card: all[0] ?? null, count: all.length, ambiguous: false };
    if (targetNo) {
      // 작성자 영역의 글 주소가 가장 강한 근거, 없으면 카드 안 아무 글 주소
      for (const sel of ['.postWriterInfoWrap a[href*="/post/"]', 'a[href*="/post/"]']) {
        const hit = all.filter((c) => linksTo(c, sel));
        if (hit.length === 1) return { card: hit[0], count: all.length, ambiguous: false };
      }
    }
    const inLayer = all.filter((c) => c.closest('[role="dialog"], [aria-modal="true"], .lyPostViewer, .postViewer, .layerContainerView, .postDetailLayer, ._postDetailLayer'));
    if (inLayer.length === 1) return { card: inLayer[0], count: all.length, ambiguous: false };
    // 여러 후보 중 임의로 첫 항목을 고르지 않는다
    return { card: null, count: all.length, ambiguous: true };
  };

  let lastSig = "";
  let stableSince = 0;
  let card: Element | null = null;
  let cardCount = 0;
  let ambiguous = false;
  let hasWriter = false;
  // 준비 완료 = 작성자 영역이 보이고, 로딩 표시가 없고, 일정 시간 내용이 바뀌지 않음(C02). 카드가 있다는 것만으로는 완료가 아니다
  let ready = false;
  while (Date.now() - t0 < opts.timeoutMs) {
    if (loginLike()) return { ...base, ok: false, reason: "login", message: "로그인이 필요한 화면입니다.", waitedMs: Date.now() - t0, probeCounts: {} };
    const p = pick();
    card = p.card;
    cardCount = p.count;
    ambiguous = p.ambiguous;
    hasWriter = !!card?.querySelector(".postWriterInfoWrap, .postWriter");
    if (card && hasWriter) {
      const n = card.querySelectorAll(".cComment").length;
      const loading = Array.from(card.querySelectorAll(".uLoading, ._loading")).some((el) => (el as HTMLElement).offsetParent !== null);
      const sig = `${n}:${card.innerHTML.length}:${loading}`;
      if (sig !== lastSig) {
        lastSig = sig;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= (loading ? Math.max(opts.stableMs * 2, 3000) : opts.stableMs)) {
        // 로딩 표시가 계속 떠 있어도 내용이 3초 이상 그대로면 더 오지 않는 것으로 본다(댓글 수가 모자라면 '일부'로 남는다)
        ready = true;
        break;
      }
    }
    await sleep(250);
  }
  if (ambiguous)
    return {
      ...base,
      ok: false,
      reason: "multiple",
      message: `게시글 카드가 ${cardCount}개 보이는데 대상 글을 확실히 고르지 못했습니다. 대상 글 하나만 연 상태에서 다시 시도하세요.`,
      waitedMs: Date.now() - t0,
      probeCounts: countProbes(document),
    };
  if (!card) return { ...base, ok: false, reason: "not-found", message: "게시글을 찾지 못했습니다(삭제·권한 없음·화면 구조 변경 가능).", waitedMs: Date.now() - t0, probeCounts: countProbes(document) };
  if (!ready)
    return {
      ...base,
      ok: false,
      reason: "timeout",
      message: hasWriter ? "게시글 내용이 제한 시간 안에 안정되지 않았습니다(아직 불러오는 중일 수 있음)." : "게시글 카드는 보이지만 작성자 영역이 제한 시간 안에 나타나지 않았습니다.",
      waitedMs: Date.now() - t0,
      probeCounts: countProbes(card),
    };

  // ---- 접힌 댓글 펼치기 + 댓글 누적(명세 3.2) ----
  // 표시된 댓글 수보다 모은 댓글이 적거나 표시 수를 모르면, '이전 댓글·답글 더보기' 같은 버튼만 눌러 불러온다(읽기 전용).
  // 누르는 버튼: 댓글 영역 안, 글자나 클래스가 '이전 댓글/댓글 더보기/답글 N개 보기'류인 것. 답글쓰기·표정·번역·숨기기·신고·메뉴·입력칸은 제외
  // 매번 화면의 댓글을 읽어 고유 댓글로 누적한다. 화면이 일부만 남기거나(가상 목록) 카드가 다시 그려져도 앞서 읽은 댓글은 잃지 않는다.
  const shownOf = (c: Element) => {
    const raw = txt(c.querySelector(".dPostCountView .comment .count")).replace(/,/g, "");
    return /^\d+$/.test(raw) ? Number(raw) : null;
  };
  const TEXT_OK = /^(이전\s*댓글|이전\s*답글|지난\s*댓글|댓글\s*\d*\s*개?\s*더\s*보기|답글\s*\d*\s*개?\s*(더\s*)?보기|이전\s*댓글\s*\d*\s*개?\s*(더\s*)?보기)/;
  const CLASS_OK = /prevComment|PrevComment|moreComment|MoreComment|commentMore|CommentMore|prevReply|PrevReply|replyMore|ReplyMore|moreReply|MoreReply|previousComment|PreviousComment/;
  const CLASS_DENY = /mute|Mute|emotion|Emotion|translat|Translat|setting|Setting|submit|Submit|write|Write|delete|Delete|remove|Remove|report|Report|_replyBtn|share|Share|like|Like|menu|Menu|upload|Upload|edit|Edit|sticker|Sticker/;
  const tried = new WeakSet<Element>();
  const hiddenEl = (el: Element, root: Element) => {
    for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
      if ((n as HTMLElement).hidden) return true;
      const st = n.ownerDocument?.defaultView?.getComputedStyle(n);
      if (st && (st.display === "none" || st.visibility === "hidden")) return true;
    }
    return false;
  };
  const expanders = (c: Element) => {
    const area = c.querySelector(".dPostCommentMainView") ?? c;
    return Array.from(area.querySelectorAll('button, a, [role="button"]')).filter((el) => {
      if (tried.has(el) || hiddenEl(el, c)) return false;
      if (el.closest('form, textarea, [contenteditable="true"], .commentWrite, .dPostCommentWriteView, ._commentWriteArea, .mentions-input')) return false;
      const cls = (el.getAttribute("class") ?? "") + " " + (el.getAttribute("data-uiselector") ?? "");
      if (CLASS_DENY.test(cls)) return false;
      const t = txt(el);
      return TEXT_OK.test(t) || (CLASS_OK.test(cls) && t.length <= 40);
    });
  };

  // 누적 저장소. 원본 댓글 ID가 화면에 없어서(실제 저장본 확인) 임시 키 = 부모 키 + 이름·인장 파일·시각(title)·글·첨부 + 같은 화면 안 순번.
  // 같은 사람이 같은 분에 같은 글을 두 번 쓰면 순번으로 둘 다 남는다(C05). 이름+본문만으로 합치지 않는다.
  interface AccItem {
    key: string;
    parent: string;
    html: string;
    size: number;
  }
  const acc = new Map<string, AccItem>();
  const order = new Map<string, string[]>();
  const fileOf = (u: string | null | undefined) => (u ?? "").split(/[?#]/)[0].split("/").pop() ?? "";
  const topOf = (c: Element) => {
    const area = c.querySelector(".dPostCommentMainView");
    return area ? Array.from(area.querySelectorAll(".cComment")).filter((el) => !el.parentElement?.closest(".sReplyList")) : [];
  };
  const repliesOf = (cc: Element) => Array.from(cc.querySelectorAll(".cComment")).filter((el) => el.parentElement?.closest(".sReplyList")?.closest(".cComment") === cc);
  const baseKey = (cc: Element) => {
    const item = cc.querySelector(":scope > [data-viewname='DCommentView'] .itemWrap, :scope .itemWrap") ?? cc;
    const name = txt(item.querySelector(".writeInfo .name")) || item.querySelector(".writeInfo img")?.getAttribute("alt") || "";
    const face = fileOf(item.querySelector(".writeInfo img")?.getAttribute("src"));
    const time = item.querySelector("time")?.getAttribute("title") || txt(item.querySelector("time"));
    const body = item.querySelector(".commentBody") ?? item;
    const text = txt(body.querySelector(".txt, ._commentContent") ?? body).slice(0, 400);
    const media = Array.from(body.querySelectorAll("img"))
      .map((i) => fileOf(i.getAttribute("src")))
      .join(",");
    return `${name}|${face}|${time}|${text}|${media}`;
  };
  // 이미지 주소는 원본 요소에서 절대 주소로 읽어 둔다(나중에 다시 붙여도 깨지지 않게)
  const cloneItem = (cc: Element) => {
    const cl = cc.cloneNode(true) as Element;
    const oi = Array.from(cc.querySelectorAll("img"));
    Array.from(cl.querySelectorAll("img")).forEach((img, i) => {
      const abs = (oi[i] as HTMLImageElement | undefined)?.src || img.getAttribute("src") || "";
      img.setAttribute("src", abs);
      img.removeAttribute("srcset");
    });
    // 답글은 따로 모으므로 빈 답글 칸만 남긴다
    cl.querySelectorAll(".sReplyList .cComment").forEach((r) => {
      if (r.parentElement?.closest(".sReplyList")?.closest(".cComment") === cl) r.remove();
    });
    return cl.outerHTML;
  };
  // 새 관측 순서를 기존 순서에 끼워 넣는다(보이는 항목끼리의 순서를 따른다)
  const place = (parent: string, seen: string[]) => {
    const list = order.get(parent) ?? [];
    let at = -1;
    seen.forEach((k, i) => {
      const j = list.indexOf(k);
      if (j >= 0) {
        at = j;
        return;
      }
      let pos: number;
      if (at >= 0) pos = at + 1;
      else {
        const nextKnown = seen.slice(i + 1).find((x) => list.includes(x));
        pos = nextKnown ? list.indexOf(nextKnown) : list.length;
      }
      list.splice(pos, 0, k);
      at = pos;
    });
    order.set(parent, list);
  };
  /** 지금 화면의 댓글을 누적. 새 고유 댓글 수 + 내용이 늘어난(전문 보완) 수를 돌려준다 */
  const absorb = (c: Element) => {
    let added = 0;
    let grown = 0;
    const walk = (els: Element[], parent: string) => {
      const seenCount = new Map<string, number>();
      const seen: string[] = [];
      for (const cc of els) {
        const b = baseKey(cc);
        const n = (seenCount.get(b) ?? 0) + 1;
        seenCount.set(b, n);
        const key = `${parent}/${b}#${n}`;
        seen.push(key);
        const html = cloneItem(cc);
        const old = acc.get(key);
        if (!old) {
          acc.set(key, { key, parent, html, size: html.length });
          added++;
        } else if (html.length > old.size) {
          acc.set(key, { ...old, html, size: html.length });
          grown++;
        }
        walk(repliesOf(cc), key);
      }
      place(parent, seen);
    };
    walk(topOf(c), "");
    return { added, grown };
  };
  let lastSnapshotKeys = new Set<string>();
  const snapshotKeys = (c: Element) => {
    const out = new Set<string>();
    const walk = (els: Element[], parent: string) => {
      const seenCount = new Map<string, number>();
      for (const cc of els) {
        const b = baseKey(cc);
        const n = (seenCount.get(b) ?? 0) + 1;
        seenCount.set(b, n);
        const key = `${parent}/${b}#${n}`;
        out.add(key);
        walk(repliesOf(cc), key);
      }
    };
    walk(topOf(c), "");
    return out;
  };
  // 카드가 다시 그려지면(노드 교체) 같은 글의 카드를 다시 찾는다. 다른 글이면 쓰지 않는다(C04)
  const refind = (): Element | null => {
    if (card && card.isConnected) return card;
    const p = pick();
    return p.card && !p.ambiguous && p.card.querySelector(".postWriterInfoWrap, .postWriter") ? p.card : null;
  };

  const shown0 = shownOf(card);
  let expandClicks = 0;
  let expandStop: PostExtraction["expandStop"] = undefined;
  let cardReplaced = 0;
  const expandCandidates = expanders(card).length;
  absorb(card);
  const unique = () => acc.size;
  const sigOf = (c: Element) => `${c.querySelectorAll(".cComment").length}:${c.innerHTML.length}`;
  const needMore = () => (shown0 === null ? expanders(card!).length > 0 : unique() < shown0 || expanders(card!).some((b) => /답글/.test(txt(b))));
  if (needMore()) {
    // 댓글이 수백 개면 수십 번 눌러야 한다. 전체 시간 한도는 넉넉히 두고, 새 댓글이 없는 상태가 이어질 때 멈춘다
    const until = Date.now() + (opts.expandMs ?? 60_000);
    let stall = 0;
    for (;;) {
      const c = refind();
      if (!c) {
        expandStop = "cardLost";
        break;
      }
      if (c !== card) {
        card = c;
        cardReplaced++;
      }
      if (shown0 !== null && unique() >= shown0 && !expanders(c).length) {
        expandStop = "done";
        break;
      }
      if (Date.now() >= until || expandClicks >= 500) {
        expandStop = "timeout";
        break;
      }
      const btn = expanders(c)[0] as HTMLElement | undefined;
      if (!btn) {
        expandStop = shown0 !== null && unique() >= shown0 ? "done" : "noButton";
        break;
      }
      if (typeof btn.scrollIntoView === "function") btn.scrollIntoView({ block: "center" });
      const before = sigOf(c);
      btn.click();
      expandClicks++;
      let changed = false;
      for (const t1 = Date.now(); Date.now() - t1 < (opts.expandWaitMs ?? 8000); ) {
        await sleep(150);
        const cur = refind();
        if (!cur || cur !== c || sigOf(cur) !== before) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        // 눌러도 바뀌지 않는 버튼은 다시 누르지 않는다
        tried.add(btn);
      } else {
        // 불러오기가 끝날 때까지(내용이 0.45초 동안 그대로일 때까지, 최대 4초)
        let last = "";
        let same = 0;
        for (const t1 = Date.now(); same < 3 && Date.now() - t1 < 4000; ) {
          await sleep(150);
          const cur = refind();
          const now = cur ? sigOf(cur) : "";
          same = now === last ? same + 1 : 0;
          last = now;
        }
      }
      const cur = refind();
      const got = cur ? absorb(cur) : { added: 0, grown: 0 };
      // 진행 = 새 고유 댓글 또는 전문 보완. 화면의 개수가 그대로여도 다른 댓글로 바뀌었으면 진행이다(C02)
      if (got.added || got.grown) stall = 0;
      else if (++stall >= 6) {
        expandStop = "noProgress";
        break;
      }
    }
  }
  {
    const c = refind();
    if (c) {
      card = c;
      absorb(c);
      lastSnapshotKeys = snapshotKeys(c);
    }
  }
  if (!card || !card.isConnected)
    return { ...base, ok: false, reason: "not-found", message: "댓글을 펼치는 중 게시글 화면이 사라졌습니다(다른 글로 바뀌었거나 닫힘).", waitedMs: Date.now() - t0, probeCounts: {} };

  const clone = card.cloneNode(true) as Element;
  // 해석기는 .cPostCard를 게시글 범위로 찾으므로, 작성자 영역으로 찾은 범위에도 같은 표시를 붙인다
  clone.classList.add("cPostCard");
  // 이미지 주소는 절대 주소로(요소를 지우기 전에, 원본과 순서가 같을 때 맞춘다)
  const origImgs = Array.from(card.querySelectorAll("img"));
  Array.from(clone.querySelectorAll("img")).forEach((img, i) => {
    const abs = (origImgs[i] as HTMLImageElement | undefined)?.src || img.getAttribute("src") || "";
    img.setAttribute("src", abs);
    img.removeAttribute("srcset");
  });
  // 화면에서 사라진 댓글이 있으면 누적본으로 댓글 목록을 다시 짠다(마지막 화면이 아니라 누적 자료가 결과, 3.2-6)
  const lostFromDom = [...acc.keys()].filter((k) => !lastSnapshotKeys.has(k)).length;
  if (lostFromDom > 0) {
    const area = clone.querySelector(".dPostCommentMainView");
    const topList = area ? Array.from(area.querySelectorAll(".sCommentList")).find((l) => !l.parentElement?.closest(".sReplyList")) : null;
    if (topList) {
      const make = (html: string) => {
        const t = document.createElement("template");
        t.innerHTML = html;
        return t.content.firstElementChild as Element;
      };
      const build = (key: string): Element => {
        const el = make(acc.get(key)!.html);
        const kids = order.get(key) ?? [];
        if (kids.length) {
          let list = Array.from(el.querySelectorAll(".sReplyList .sCommentList")).find((l) => l.closest(".cComment") === el) ?? null;
          if (!list) {
            const wrap = document.createElement("div");
            wrap.className = "sReplyList";
            list = document.createElement("div");
            list.className = "sCommentList";
            wrap.appendChild(list);
            el.appendChild(wrap);
          }
          for (const k of kids) if (acc.has(k)) list.appendChild(build(k));
        }
        return el;
      };
      // 댓글 목록 안의 최상위 댓글은 감싼 요소 안에 있어도 모두 뺀 뒤 누적본으로 다시 넣는다
      topOf(clone).forEach((el) => el.remove());
      for (const k of order.get("") ?? []) if (acc.has(k)) topList.appendChild(build(k));
    }
  }
  // 저장본에서 스크립트와 입력칸(숨은 값 포함)은 뺀다(24.2)
  clone.querySelectorAll("script, noscript, iframe, style, input, textarea, select, form").forEach((el) => el.remove());
  // 이벤트 속성·값 속성·파서가 쓰지 않는 data-* 속성 제거(data-viewname은 댓글 구조 판별에 쓴다)
  for (const el of [clone, ...Array.from(clone.querySelectorAll("*"))])
    for (const a of Array.from(el.attributes))
      if (/^on/i.test(a.name) || a.name === "value" || (/^data-/i.test(a.name) && a.name !== "data-viewname")) el.removeAttribute(a.name);
  const imageUrls = Array.from(new Set(Array.from(clone.querySelectorAll("img")).map((i) => i.getAttribute("src") || "").filter((s) => /^https?:/.test(s))));
  const countEl = card.querySelector(".dPostCountView .comment .count");
  const shownRaw = txt(countEl).replace(/,/g, "");
  const face = document.querySelector("img._globalFaceImage, .btnMySetting img") as HTMLImageElement | null;
  const postLink = card.querySelector('.postWriterInfoWrap a[href*="/post/"]') as HTMLAnchorElement | null;
  return {
    ok: true,
    pageUrl: location.href,
    postHref: postLink?.href ?? null,
    bandName: txt(document.querySelector(".printInfo .name, .bandName .uriText")) || null,
    html: clone.outerHTML,
    commentsShown: /^\d+$/.test(shownRaw) ? Number(shownRaw) : null,
    commentsFound: acc.size,
    commentsInDom: card.querySelectorAll(".cComment").length,
    commentsKeptFromEarlier: lostFromDom,
    cardReplaced,
    imageUrls,
    accountMarker: face?.src ? face.src.split(/[?#]/)[0].split("/").pop() ?? null : null,
    waitedMs: Date.now() - t0,
    probeCounts: countProbes(card),
    expandClicks,
    expandCandidates,
    expandStop,
  };
}
