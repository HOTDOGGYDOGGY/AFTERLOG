/* AFTERLOG 연결판(원본: rpbackup/app.js). 바꾼 곳은 "AFTERLOG:" 주석으로 표시했다.
   - 예시 대화를 자동으로 넣지 않음(실제 프로젝트에 가짜 자료를 넣지 않는다)
   - 인물·설정을 브라우저 localStorage가 아니라 AFTERLOG 프로젝트에 저장(bridge.js의 snapshot/load)
   - 원문을 고쳐도 인물 설정(이름·사진·색)이 초기화되지 않게 이전 설정을 이어받음
   - HTML 저장을 함수로 분리하고 편집 조작 요소를 뺀 결과를 돌려줌
   - 끝에 window.__rpbaModule 등록
*/
/* RP 백업 - Stage3 Split: app.js
   추가/수정:
   - "설정" 패널: 탭을 인물/카톡으로
   - 문구 변경: 자동 반영 안내
   - 배경 이미지 옵션(윈도우11 느낌): 채우기/맞춤/확대/바둑판/가운데
   - 작은 이미지가 '안 올라가는' 문제: FileReader 오류/용량 제한/저장 실패를 UI로 표시
   - 카톡 로그(내보내기) 파싱 지원:
       * "OO 님과 카카오톡 대화"
       * "저장한 날짜 : ..."
       * "--------------- 2025년 4월 25일 금요일 ---------------" 날짜 구분선
       * 그 다음의 안내문(대괄호 없는 줄) -> 시스템 메시지
   - 중간구분 추가 버튼: [[구분:텍스트]] 마커 삽입
   - 저장 기능: HTML 저장, PNG/JPG 저장(3000px 초과 자동 분할)
   - 메시지 묶기 토글 + 인물별 색상 토글(그룹채팅 느낌)
*/

(() => {
  // ===== DOM =====
  const app = document.getElementById("app");
  const cafeWrap = document.getElementById("cafeWrap");

  const btnPlatformKakao = document.getElementById("btnPlatformKakao");
  const btnPlatformCafe  = document.getElementById("btnPlatformCafe");

  const btnLayoutA = document.getElementById("btnLayoutA");
  const btnLayoutB = document.getElementById("btnLayoutB");

  const btnSaveHtml = document.getElementById("btnSaveHtml");
  const btnSavePng  = document.getElementById("btnSavePng");
  const btnSaveJpg  = document.getElementById("btnSaveJpg");

  const elInput = document.getElementById("input");
  const elChat = document.getElementById("chat");
  const elPeoplePanel = document.getElementById("peoplePanel");
  const elKakaoPanel = document.getElementById("kakaoPanel");
  const statsChip = document.getElementById("statsChip");
  const storageChip = document.getElementById("storageChip");
  const previewSub = document.getElementById("previewSub");

  const btnClear = document.getElementById("btnClear");
  const btnInsertSep = document.getElementById("btnInsertSep");

  const tabPeople = document.getElementById("tabPeople");
  const tabKakao = document.getElementById("tabKakao");
  const tabMedia = document.getElementById("tabMedia");
  const elMediaPanel = document.getElementById("mediaPanel");

  // Resizers
  const rzA1 = document.getElementById("rzA1");
  const rzA2 = document.getElementById("rzA2");
  const rzBCol = document.getElementById("rzBCol");
  const rzBRow = document.getElementById("rzBRow");

  // Cards
  const cardInput = document.getElementById("cardInput");
  const cardMid   = document.getElementById("cardMid");
  const cardPreview = document.getElementById("cardPreview");

  // ===== Platform switch (Kakao / Cafe) =====
  const PLATFORM_KEY = "rpbackup_platform";
  let currentPlatform = "kakao";

  function setPlatform(platform){
    currentPlatform = (platform === "cafe") ? "cafe" : "kakao";

    // left pills
    if (btnPlatformKakao) btnPlatformKakao.classList.toggle("active", currentPlatform === "kakao");
    if (btnPlatformCafe)  btnPlatformCafe.classList.toggle("active",  currentPlatform === "cafe");

    // main areas
    if (app) app.style.display = (currentPlatform === "kakao") ? "" : "none";
    if (cafeWrap) cafeWrap.style.display = (currentPlatform === "cafe") ? "" : "none";

    // disable Kakao-only controls when in Cafe
    const kakaoOnly = [btnLayoutA, btnLayoutB, btnSaveHtml, btnSavePng, btnSaveJpg];
    for (const el of kakaoOnly){
      if (!el) continue;
      el.disabled = (currentPlatform !== "kakao");
      el.style.opacity = el.disabled ? "0.55" : "";
      el.style.cursor  = el.disabled ? "not-allowed" : "";
    }

    try{ localStorage.setItem(PLATFORM_KEY, currentPlatform); }catch(_e){}
  }

  if (btnPlatformKakao){
    btnPlatformKakao.addEventListener("click", () => setPlatform("kakao"));
  }
  if (btnPlatformCafe){
    btnPlatformCafe.addEventListener("click", () => setPlatform("cafe"));
  }

  // ===== Sample =====
  const SAMPLE = `예시 님과 카카오톡 대화
[예시 A] [오전 1:23] 안녕하세요
[예시 B] [오전 1:23] 반갑습니다
[예시 C] [오전 1:24] 안녕안녕`;
  // AFTERLOG: 예시 대화는 넣지 않는다(입력칸 안내문으로 대신)
  void SAMPLE;

  // ===== Utils =====
  function hashText(s){
    let h = 2166136261;
    for (let i=0;i<s.length;i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h>>>0).toString(16);
  }
  function safeInitial(name){
    const t = (name || "").trim();
    if (!t) return "?";
    // 항상 첫 글자 반환
    return t[0];
  }
  function readFileAsDataURL(file){
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error("FileReader error"));
      fr.readAsDataURL(file);
    });
  }
  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
  function px(n){ return `${Math.round(n)}px`; }
  function setRootVar(name, value){ document.documentElement.style.setProperty(name, value); }

  function downloadBlob(filename, blob){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadDataUrl(filename, dataUrl){
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ===== Parsing =====
  // Normal chat line: [이름] [오후 1:09] 내용
  const LINE_RE = /^\[(.+?)\]\s+\[(.+?)\]\s+([\s\S]+)$/;
  // Date separator line in export: --------------- 2025년 4월 25일 금요일 ---------------
  const DATE_SEP_RE = /^-+\s*(.+?)\s*-+$/;
  // Manual separator marker
  const MANUAL_SEP_RE = /^\[\[\s*구분\s*:(.*?)\s*\]\]$/;
  // Reply marker: [[답장:원본내용]] 또는 메시지 시작에 > 
  const REPLY_RE = /^\[\[\s*답장\s*:(.*?)\s*\]\]\s*/;
  // 이미지/이모티콘 패턴
  const MEDIA_RE = /^(사진\s*\d*장?|이모티콘|동영상)$/;
  // 공지/게시글 패턴
  const NOTICE_RE = /^톡게시판\s*'([^']+)':\s*/;

  function parseKakaoExport(raw){
    const lines = raw.split(/\r?\n/);
    const out = [];
    let lineCount = 0;
    let lastMsgIndex = -1;  // 긴 메시지 이어붙이기용

    for (let i=0;i<lines.length;i++){
      const line = lines[i].replace(/\uFEFF/g, ""); // remove BOM if any
      const trimmed = line.trimEnd();
      if (!trimmed.trim()){
        continue;
      }
      lineCount++;

      // skip header lines but store as sys maybe
      if (/님과\s+카카오톡\s+대화$/.test(trimmed)){
        out.push({ type: "sys", text: trimmed });
        lastMsgIndex = -1;
        continue;
      }
      if (/^저장한\s+날짜\s*:\s*/.test(trimmed)){
        out.push({ type: "sys", text: trimmed });
        lastMsgIndex = -1;
        continue;
      }

      // manual separator
      const ms = trimmed.match(MANUAL_SEP_RE);
      if (ms){
        const label = (ms[1] || "").trim() || "구분";
        out.push({ type: "sep", label });
        lastMsgIndex = -1;
        continue;
      }

      // date separator
      const ds = trimmed.match(DATE_SEP_RE);
      if (ds && ds[1] && /년\s*\d+월\s*\d+일/.test(ds[1])){
        out.push({ type: "sep", label: ds[1].trim() });
        lastMsgIndex = -1;
        continue;
      }

      // normal message (check for reply marker)
      const m = trimmed.match(LINE_RE);
      if (m){
        let text = m[3];
        let replyTo = null;
        
        // 답장 마커 체크: [[답장:내용]]
        const replyMatch = text.match(REPLY_RE);
        if (replyMatch) {
          replyTo = replyMatch[1].trim();
          text = text.replace(REPLY_RE, '').trim();
        }
        
        const msgObj = { type: "msg", originalName: m[1], time: m[2], text: text, replyTo: replyTo };
        
        // 이미지/이모티콘 체크
        if (MEDIA_RE.test(text.trim())) {
          msgObj.mediaType = text.includes('이모티콘') ? 'emoticon' : 
                            text.includes('동영상') ? 'video' : 'photo';
          msgObj.needsUpload = true;
        }
        
        // 공지/게시글 체크
        const noticeMatch = text.match(NOTICE_RE);
        if (noticeMatch) {
          msgObj.isNotice = true;
          msgObj.noticeType = noticeMatch[1];
        }
        
        out.push(msgObj);
        lastMsgIndex = out.length - 1;
        continue;
      }

      // 형식에 맞지 않는 줄 - 이전 메시지에 이어붙이기
      if (lastMsgIndex >= 0 && out[lastMsgIndex] && out[lastMsgIndex].type === "msg") {
        out[lastMsgIndex].text += "\n" + trimmed;
        continue;
      }

      // otherwise system notice line
      out.push({ type: "sys", text: trimmed });
      lastMsgIndex = -1;
    }

    return { items: out, lineCount };
  }

  // ===== Profiles store =====
  function storageKeyForInput(raw){
    return "rpbackup_profiles_" + hashText(raw.trim());
  }
  function loadProfilesFromStorage(key){
    // AFTERLOG: 인물은 프로젝트에 저장한다. 원문 해시별 localStorage는 쓰지 않는다(용량 초과·프로젝트 간 섞임 방지)
    if (window.__rpbaNoLocalStorage !== false) return { people: {}, meId: "" };
    try{
      const j = localStorage.getItem(key);
      if (!j) return { people: {}, meId: "" };
      const parsed = JSON.parse(j);
      if (!parsed || typeof parsed !== "object") throw new Error("bad json");
      if (!parsed.people) parsed.people = {};
      if (!("meId" in parsed)) parsed.meId = "";
      return parsed;
    }catch(_e){
      return { people: {}, meId: "" };
    }
  }
  function saveProfilesToStorage(key, data){
    if (window.__rpbaNoLocalStorage !== false) return { ok: true };
    try{
      localStorage.setItem(key, JSON.stringify(data));
      return { ok: true };
    }catch(e){
      return { ok: false, reason: (e && e.name) ? e.name : "SAVE_FAILED" };
    }
  }
  function ensurePerson(profileData, originalName){
    const id = (originalName || "").trim();
    if (!id) return null;
    if (!profileData.people[id]){
      profileData.people[id] = {
        id,
        originalName: id,
        displayName: id,
        avatarDataUrl: "",
        color: "" // optional
      };
    }
    return profileData.people[id];
  }

  // Deterministic nice-ish colors
  const COLOR_POOL = [
    "#ef4444","#f97316","#f59e0b","#eab308","#22c55e","#10b981","#14b8a6",
    "#06b6d4","#3b82f6","#6366f1","#8b5cf6","#a855f7","#ec4899"
  ];
  function pickColorFor(name){
    const h = parseInt(hashText(name), 16);
    return COLOR_POOL[h % COLOR_POOL.length];
  }

  // ===== Session (prevents avatar loss) =====
  let session = {
    key: "",
    data: { people: {}, meId: "" },
    storageWritable: true
  };
  function setStorageWarning(on){
    if (!on){
      storageChip.style.display = "none";
      storageChip.textContent = "";
      return;
    }
    storageChip.style.display = "inline-flex";
    storageChip.textContent = "저장공간 제한으로 '프로필 사진/배경 이미지'가 브라우저에 영구 저장되지 않을 수 있어. (화면에서는 유지됨)";
  }
  function getProfileStateFor(raw){
    const key = storageKeyForInput(raw);
    if (session.key === key) return;
    // AFTERLOG: 원문을 고쳐도 기존 인물 설정을 이어받는다
    const prevData = session.data;
    session.key = key;
    session.data = loadProfilesFromStorage(key);
    for (const [pid, person] of Object.entries((prevData && prevData.people) || {})){
      if (!session.data.people[pid]) session.data.people[pid] = person;
    }
    if (!session.data.meId && prevData && prevData.meId) session.data.meId = prevData.meId;
    session.storageWritable = true;
    setStorageWarning(false);
  }
  function persistProfileState(){
    const res = saveProfilesToStorage(session.key, session.data);
    if (!res.ok){
      session.storageWritable = false;
      setStorageWarning(true);
    }else{
      if (!session.storageWritable){
        session.storageWritable = true;
        setStorageWarning(false);
      }
    }
  }

  // ===== Kakao settings =====
  const SETTINGS_KEY = "rpbackup_kakao_settings_v2";
  let kakaoSettings = {
    bgColor: "#b2c7da",
    bgImageDataUrl: "",
    bgMode: "fill",          // fill | fit | stretch | tile | center
    groupColors: false,       // 기본값: 비활성화
    groupMessages: true,
    showTopSep: true,         // 상단 구분 표시 여부
    topSepText: "대화"
  };
  let lastBgError = "";

  function loadKakaoSettings(){
    // AFTERLOG: 설정은 프로젝트에서 불러온다(다른 프로젝트의 배경 이미지가 섞이지 않게)
    if (window.__rpbaNoLocalStorage !== false) return;
    try{
      const j = localStorage.getItem(SETTINGS_KEY);
      if (!j) return;
      const p = JSON.parse(j);
      if (!p || typeof p !== "object") return;
      Object.assign(kakaoSettings, p);
    }catch(_e){ /* ignore */ }
  }
  function saveKakaoSettings(){
    if (window.__rpbaNoLocalStorage !== false) return;
    try{
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(kakaoSettings));
    }catch(_e){
      // quota could be exceeded; warn
      setStorageWarning(true);
    }
  }

  function modeToCss(mode){
    switch(mode){
      case "fill":    return { size:"cover",  repeat:"no-repeat", position:"center" }; // 채우기(cover)
      case "fit":     return { size:"contain",repeat:"no-repeat", position:"center" }; // 맞춤(contain)
      case "stretch": return { size:"100% 100%",repeat:"no-repeat", position:"center" }; // 확대/늘림
      case "tile":    return { size:"auto",   repeat:"repeat",    position:"center" }; // 바둑판
      case "center":  return { size:"auto",   repeat:"no-repeat", position:"center" }; // 가운데
      default:        return { size:"cover",  repeat:"no-repeat", position:"center" };
    }
  }

  function applyKakaoSettings(){
    setRootVar("--bg-chat", kakaoSettings.bgColor || "#b2c7da");

    if (kakaoSettings.bgImageDataUrl){
      document.documentElement.style.setProperty("--bg-chat-img", `url('${kakaoSettings.bgImageDataUrl}')`);
    }else{
      document.documentElement.style.setProperty("--bg-chat-img", "none");
    }

    const css = modeToCss(kakaoSettings.bgMode || "fill");
    setRootVar("--bg-size", css.size);
    setRootVar("--bg-repeat", css.repeat);
    setRootVar("--bg-position", css.position);
  }

  function setBgError(msg){
    lastBgError = msg || "";
    const err = document.getElementById("bgErrorBox");
    if (err){
      if (!lastBgError){
        err.style.display = "none";
        err.textContent = "";
      }else{
        err.style.display = "block";
        err.textContent = lastBgError;
      }
    }
  }

  function renderKakaoSettingsUI(){
    elKakaoPanel.innerHTML = "";

    // Card: background
    const card = document.createElement("div");
    card.className = "settingCard";
    const h = document.createElement("div");
    h.className = "settingTitle";
    h.textContent = "채팅 배경";
    card.appendChild(h);

    // row: bg color
    const row1 = document.createElement("div");
    row1.className = "settingRow";
    row1.innerHTML = `<div class="label">배경색</div>`;
    const color = document.createElement("input");
    color.type = "color";
    color.value = kakaoSettings.bgColor || "#b2c7da";
    color.addEventListener("input", () => {
      kakaoSettings.bgColor = color.value;
      applyKakaoSettings();
      saveKakaoSettings();
    });
    const help1 = document.createElement("div");
    help1.className = "help";
    help1.textContent = "카톡 채팅방 배경색";
    row1.appendChild(color);
    row1.appendChild(help1);

    // row: bg mode
    const rowMode = document.createElement("div");
    rowMode.className = "settingRow";
    const labelMode = document.createElement("div");
    labelMode.className = "label";
    labelMode.textContent = "표시 방식";
    const modeSel = document.createElement("select");
    modeSel.innerHTML = `
      <option value="fill">채우기</option>
      <option value="fit">맞춤</option>
      <option value="stretch">확대</option>
      <option value="tile">바둑판</option>
      <option value="center">가운데</option>
    `;
    modeSel.value = kakaoSettings.bgMode || "fill";
    modeSel.addEventListener("change", () => {
      kakaoSettings.bgMode = modeSel.value;
      applyKakaoSettings();
      saveKakaoSettings();
    });
    const helpMode = document.createElement("div");
    helpMode.className = "help";
    helpMode.textContent = "윈도우11 배경 옵션 느낌";
    rowMode.appendChild(labelMode);
    rowMode.appendChild(modeSel);
    rowMode.appendChild(helpMode);

    // row: bg image
    const row2 = document.createElement("div");
    row2.className = "settingRow";
    const label2 = document.createElement("div");
    label2.className = "label";
    label2.textContent = "배경이미지";
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      setBgError("");

      // common reasons: corrupted file, blocked by browser, or too big for localStorage
      try{
        // read always works even for small; if it fails, show error
        const dataUrl = await readFileAsDataURL(f);

        // store in memory first (always works)
        kakaoSettings.bgImageDataUrl = dataUrl;
        applyKakaoSettings();

        // try persist
        try{
          saveKakaoSettings();
        }catch(_e){ /* handled */ }

      }catch(e){
        const reason = (e && e.message) ? e.message : "알 수 없는 오류";
        setBgError("배경 이미지 적용 실패: " + reason + " (파일이 손상되었거나, 브라우저가 읽기를 차단했을 수 있음)");
      }finally{
        file.value = "";
      }
    });

    const btnClearImg = document.createElement("button");
    btnClearImg.className = "btn";
    btnClearImg.type = "button";
    btnClearImg.textContent = "이미지 삭제";
    btnClearImg.addEventListener("click", () => {
      setBgError("");
      kakaoSettings.bgImageDataUrl = "";
      applyKakaoSettings();
      saveKakaoSettings();
    });

    row2.appendChild(label2);
    row2.appendChild(file);
    row2.appendChild(btnClearImg);

    // toggles
    const card2 = document.createElement("div");
    card2.className = "settingCard";
    const h2 = document.createElement("div");
    h2.className = "settingTitle";
    h2.textContent = "표시 옵션";
    card2.appendChild(h2);

    const rowGroup = document.createElement("div");
    rowGroup.className = "settingRow";
    rowGroup.innerHTML = `<div class="label">메시지 묶기</div>`;
    const chkGroup = document.createElement("input");
    chkGroup.type = "checkbox";
    chkGroup.checked = !!kakaoSettings.groupMessages;
    chkGroup.addEventListener("change", () => {
      kakaoSettings.groupMessages = chkGroup.checked;
      saveKakaoSettings();
      renderAll();
    });
    const helpGroup = document.createElement("div");
    helpGroup.className = "help";
    helpGroup.textContent = "같은 인물 연속 메시지를 카톡처럼 묶기";
    rowGroup.appendChild(chkGroup);
    rowGroup.appendChild(helpGroup);

    const rowColors = document.createElement("div");
    rowColors.className = "settingRow";
    rowColors.innerHTML = `<div class="label">인물 색상</div>`;
    const chkColors = document.createElement("input");
    chkColors.type = "checkbox";
    chkColors.checked = !!kakaoSettings.groupColors;
    chkColors.addEventListener("change", () => {
      kakaoSettings.groupColors = chkColors.checked;
      saveKakaoSettings();
      // 인물 패널의 색상 필드 표시/숨김
      document.querySelectorAll('.color-field').forEach(el => {
        el.style.display = chkColors.checked ? 'flex' : 'none';
      });
      renderAll();
    });
    const helpColors = document.createElement("div");
    helpColors.className = "help";
    helpColors.textContent = "그룹채팅 느낌으로 이름/강조색 적용";
    rowColors.appendChild(chkColors);
    rowColors.appendChild(helpColors);

    // 상단 구분 표시 체크박스
    const rowTopSepShow = document.createElement("div");
    rowTopSepShow.className = "settingRow";
    rowTopSepShow.innerHTML = `<div class="label">상단 구분 표시</div>`;
    const chkTopSep = document.createElement("input");
    chkTopSep.type = "checkbox";
    chkTopSep.checked = kakaoSettings.showTopSep !== false;
    const helpTopSep = document.createElement("div");
    helpTopSep.className = "help";
    helpTopSep.textContent = "미리보기 맨 위 구분선";
    rowTopSepShow.appendChild(chkTopSep);
    rowTopSepShow.appendChild(helpTopSep);

    // top separator text
    const rowTopSep = document.createElement("div");
    rowTopSep.className = "settingRow";
    rowTopSep.id = "topSepTextRow";
    rowTopSep.style.display = chkTopSep.checked ? "flex" : "none";
    const lblTop = document.createElement("div");
    lblTop.className = "label";
    lblTop.textContent = "구분 텍스트";
    const inpTop = document.createElement("input");
    inpTop.type = "text";
    inpTop.value = kakaoSettings.topSepText || "대화";
    inpTop.placeholder = "예: 대화 / 2025년 4월 25일";
    inpTop.addEventListener("input", () => {
      kakaoSettings.topSepText = inpTop.value.trim() || "대화";
      saveKakaoSettings();
      renderAll();
    });
    rowTopSep.appendChild(lblTop);
    rowTopSep.appendChild(inpTop);

    chkTopSep.addEventListener("change", () => {
      kakaoSettings.showTopSep = chkTopSep.checked;
      rowTopSep.style.display = chkTopSep.checked ? "flex" : "none";
      saveKakaoSettings();
      renderAll();
    });

    // error box
    const err = document.createElement("div");
    err.id = "bgErrorBox";
    err.className = "error";
    err.style.display = lastBgError ? "block" : "none";
    err.textContent = lastBgError;

    card.appendChild(row1);
    card.appendChild(rowMode);
    card.appendChild(row2);
    card.appendChild(err);

    card2.appendChild(rowGroup);
    card2.appendChild(rowColors);
    card2.appendChild(rowTopSepShow);
    card2.appendChild(rowTopSep);

    elKakaoPanel.appendChild(card);
    elKakaoPanel.appendChild(card2);

    const tip = document.createElement("div");
    tip.className = "help";
    tip.textContent = "배경 이미지/프로필 사진은 브라우저 저장공간(localStorage) 제한으로 저장이 실패할 수 있음. 실패해도 화면에는 적용됨.";
    elKakaoPanel.appendChild(tip);
  }

  // ===== People rendering =====
  function makeAvatarEl(person, small=false){
    const av = document.createElement("div");
    av.className = "avatar";
    if (small){
      av.style.width = "38px";
      av.style.height = "38px";
      av.style.borderRadius = "14px";
    }
    if (person && person.avatarDataUrl){
      const img = document.createElement("img");
      img.src = person.avatarDataUrl;
      img.alt = person.displayName || person.originalName || "";
      av.appendChild(img);
    }else{
      av.textContent = safeInitial(person ? (person.displayName || person.originalName) : "?");
    }
    return av;
  }

  function renderPeople(uniqueNames){
    elPeoplePanel.innerHTML = "";
    const profileData = session.data;

    for (const name of uniqueNames){
      const person = ensurePerson(profileData, name);
      if (!person) continue;

      if (!person.color) person.color = pickColorFor(person.id);

      const card = document.createElement("div");
      card.className = "person";

      const av = makeAvatarEl(person, false);
      const right = document.createElement("div");

      const topRow = document.createElement("div");
      topRow.className = "row";

      const nameWrap = document.createElement("div");
      const dn = document.createElement("div");
      dn.className = "pname";
      dn.textContent = person.displayName || person.originalName;

      const orig = document.createElement("div");
      orig.className = "orig";
      orig.textContent = `원본: ${person.originalName}`;

      nameWrap.appendChild(dn);
      nameWrap.appendChild(orig);

      const chkLabel = document.createElement("label");
      chkLabel.className = "radio";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.name = "meId";
      chk.value = person.id;
      chk.checked = (profileData.meId === person.id);
      chk.addEventListener("change", () => {
        if (chk.checked) {
          // 다른 체크박스 해제
          document.querySelectorAll('input[name="meId"]').forEach(c => {
            if (c !== chk) c.checked = false;
          });
          profileData.meId = person.id;
        } else {
          profileData.meId = "";
        }
        persistProfileState();
        renderChat(currentState.items);
      });
      chkLabel.appendChild(chk);
      chkLabel.appendChild(document.createTextNode("내 계정"));
      topRow.appendChild(nameWrap);
      topRow.appendChild(chkLabel);

      const controls = document.createElement("div");
      controls.className = "controls";

      // Display name
      const fieldName = document.createElement("div");
      fieldName.className = "field";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = person.displayName || "";
      inp.placeholder = "표시 이름 바꾸기";
      inp.addEventListener("input", () => {
        person.displayName = inp.value.trim() || person.originalName;
        dn.textContent = person.displayName;

        av.innerHTML = "";
        if (person.avatarDataUrl){
          const img = document.createElement("img");
          img.src = person.avatarDataUrl;
          img.alt = person.displayName;
          av.appendChild(img);
        }else{
          av.textContent = safeInitial(person.displayName);
        }

        persistProfileState();
        renderChat(currentState.items);
      });
      fieldName.appendChild(inp);

      // Avatar upload
      const fieldAvatar = document.createElement("div");
      fieldAvatar.className = "field";
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/*";
      file.addEventListener("change", async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        try{
          const dataUrl = await readFileAsDataURL(f);
          person.avatarDataUrl = dataUrl;

          av.innerHTML = "";
          const img = document.createElement("img");
          img.src = dataUrl;
          img.alt = person.displayName;
          av.appendChild(img);

          persistProfileState(); // may fail -> warning, but keep in session
          renderChat(currentState.items);
        }catch(e){
          alert("이미지 읽기 실패: " + ((e && e.message) ? e.message : "알 수 없는 오류"));
        }finally{
          file.value = "";
        }
      });
      fieldAvatar.appendChild(file);

      // Clear avatar
      const btnRow = document.createElement("div");
      btnRow.className = "field";
      const btnClearAv = document.createElement("button");
      btnClearAv.className = "btn";
      btnClearAv.type = "button";
      btnClearAv.textContent = "프로필 사진 삭제";
      btnClearAv.addEventListener("click", () => {
        person.avatarDataUrl = "";
        av.innerHTML = "";
        av.textContent = safeInitial(person.displayName);
        persistProfileState();
        renderChat(currentState.items);
      });
      btnRow.appendChild(btnClearAv);

      // 숨기기 버튼
      const btnHide = document.createElement("button");
      btnHide.className = "btn" + (person.hidden ? " active" : "");
      btnHide.type = "button";
      btnHide.textContent = person.hidden ? "표시하기" : "숨기기";
      btnHide.addEventListener("click", () => {
        person.hidden = !person.hidden;
        btnHide.textContent = person.hidden ? "표시하기" : "숨기기";
        btnHide.classList.toggle("active", person.hidden);
        card.classList.toggle("hidden-person", person.hidden);
        persistProfileState();
        renderChat(currentState.items);
      });
      btnRow.appendChild(btnHide);

      // 인물별 이름색 (groupColors가 켜져 있을 때만 표시)
      const colorRow = document.createElement("div");
      colorRow.className = "field color-field";
      colorRow.style.display = kakaoSettings.groupColors ? "flex" : "none";
      const colorLabel = document.createElement("span");
      colorLabel.textContent = "이름색: ";
      colorLabel.style.fontSize = "12px";
      const colorPicker = document.createElement("input");
      colorPicker.type = "color";
      colorPicker.value = person.color || pickColorFor(person.id);
      colorPicker.addEventListener("input", () => {
        person.color = colorPicker.value;
        persistProfileState();
        renderChat(currentState.items);
      });
      colorRow.appendChild(colorLabel);
      colorRow.appendChild(colorPicker);

      controls.appendChild(fieldName);
      controls.appendChild(fieldAvatar);
      controls.appendChild(btnRow);
      controls.appendChild(colorRow);

      right.appendChild(topRow);
      right.appendChild(controls);

      card.appendChild(av);
      card.appendChild(right);
      if (person.hidden) card.classList.add("hidden-person");
      elPeoplePanel.appendChild(card);
    }

    persistProfileState();
  }

  // ===== Chat rendering (with system/separators) =====
  function renderChat(items){
    elChat.innerHTML = "";
    const frag = document.createDocumentFragment();

    // 메시지가 없으면 빈 상태 표시
    const hasMessages = items.some(x => x.type === "msg");
    if (!hasMessages) {
      const empty = document.createElement("div");
      empty.className = "chat-empty-state";
      empty.innerHTML = '<div class="empty-icon">📝</div><div class="empty-text">왼쪽 대화 붙여넣기에 카카오톡 로그를 붙여넣으면<br>여기에 미리보기가 표시됩니다.</div>';
      frag.appendChild(empty);
      elChat.appendChild(frag);
      return;
    }

    // top separator (표시 설정 체크)
    if (kakaoSettings.showTopSep !== false) {
      const topSep = document.createElement("div");
      topSep.className = "sep";
      topSep.textContent = kakaoSettings.topSepText || "대화";
      frag.appendChild(topSep);
    }

    const profileData = session.data;

    // 숨김 인물 체크
    function isHiddenPerson(name) {
      const p = profileData.people && profileData.people[name];
      return p && p.hidden;
    }

    // helper to decide grouping
    function isSameSpeaker(a, b){
      return a && b && a.type==="msg" && b.type==="msg" && (a.originalName || "").trim() === (b.originalName || "").trim();
    }

    for (let i=0;i<items.length;i++){
      const it = items[i];

      if (it.type === "sep"){
        const sep = document.createElement("div");
        sep.className = "sep";
        sep.textContent = it.label || "구분";
        frag.appendChild(sep);
        continue;
      }

      if (it.type === "sys"){
        const sys = document.createElement("div");
        sys.className = "sys";
        sys.textContent = it.text || "";
        frag.appendChild(sys);
        continue;
      }

      if (it.type !== "msg") continue;

      // 숨김 인물 건너뛰기
      if (isHiddenPerson(it.originalName)) continue;

      const person = ensurePerson(profileData, it.originalName);
      const isMe = profileData.meId && person && (person.id === profileData.meId);

      const prev = items[i-1] || null;
      const next = items[i+1] || null;

      const grouping = !!kakaoSettings.groupMessages;

      const prevSame = grouping && isSameSpeaker(prev, it);
      const nextSame = grouping && isSameSpeaker(it, next);

      const showMeta = !prevSame;
      const showTime = !nextSame;

      const row = document.createElement("div");
      row.className = "msg-row " + (isMe ? "me" : "other");
      if (it.isNotice) row.classList.add("notice-msg");
      row.dataset.index = i;

      if (!isMe){
        const metaLeft = document.createElement("div");
        metaLeft.className = "meta-left";
        if (showMeta){
          metaLeft.appendChild(makeAvatarEl(person, true));
        }else{
          const spacer = document.createElement("div");
          spacer.style.width = "38px";
          spacer.style.height = "38px";
          spacer.style.borderRadius = "14px";
          spacer.style.opacity = "0";
          metaLeft.appendChild(spacer);
        }
        row.appendChild(metaLeft);
      }

      const stack = document.createElement("div");
      stack.className = "stack " + (isMe ? "me" : "other");

      if (!isMe && showMeta){
        const who = document.createElement("div");
        who.className = "who";
        who.textContent = (person && (person.displayName || person.originalName)) ? (person.displayName || person.originalName) : it.originalName;

        if (kakaoSettings.groupColors && person && person.color){
          who.classList.add("colored");
          who.style.color = person.color;
        }

        stack.appendChild(who);
      }

      // 답장 박스 (클릭해서 편집)
      const replyBox = document.createElement("div");
      replyBox.className = "reply-box" + (it.replyTo ? " has-reply" : " placeholder");
      replyBox.textContent = it.replyTo || "[답장 추가]";
      replyBox.dataset.index = i;
      replyBox.addEventListener("click", () => showReplyEditor(i, it.replyTo || ""));
      stack.appendChild(replyBox);

      const line = document.createElement("div");
      line.className = "bubble-line " + (isMe ? "me" : "other");

      // 공지/게시글인 경우
      if (it.isNotice) {
        const noticeBubble = document.createElement("div");
        noticeBubble.className = "notice-bubble";
        noticeBubble.innerHTML = `<div class="notice-header"><span class="notice-icon">📋</span><span class="notice-type">${escapeHtml(it.noticeType || '공지')}</span></div><div class="notice-content">${escapeHtml(it.text.replace(/^톡게시판\s*'[^']+':?\s*/, ''))}</div>`;
        line.appendChild(noticeBubble);
      }
      // 이미지가 있는 경우
      else if (it.imageUrl) {
        const imgEl = document.createElement("img");
        imgEl.src = it.imageUrl;
        imgEl.className = "chat-image";
        imgEl.alt = "이미지";
        line.appendChild(imgEl);
      }
      // 이미지/이모티콘 업로드 필요한 경우
      else if (it.needsUpload && !it.imageUrl) {
        const uploadBox = document.createElement("div");
        uploadBox.className = "media-upload-box";
        uploadBox.dataset.index = i;
        uploadBox.innerHTML = `<span class="media-icon">${it.mediaType === 'emoticon' ? '😊' : it.mediaType === 'video' ? '🎬' : '🖼'}</span><span class="media-text">${escapeHtml(it.text)}</span><span class="media-hint">클릭하여 업로드</span>`;
        uploadBox.addEventListener("click", () => uploadMediaAt(i));
        line.appendChild(uploadBox);
      }
      // 일반 메시지
      else {
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.contentEditable = "true";
        bubble.textContent = it.text;
        bubble.dataset.index = i;
        bubble.addEventListener("blur", function(){
          const idx = parseInt(this.dataset.index);
          if (currentState.items[idx]) {
            currentState.items[idx].text = this.textContent;
          }
        });

        if (!isMe && kakaoSettings.groupColors && person && person.color){
          bubble.style.border = `1px solid ${person.color}33`;
        }
        line.appendChild(bubble);
      }

      const time = document.createElement("div");
      time.className = "time";
      time.textContent = showTime ? (it.time || "") : "";

      if (isMe){
        if (showTime) line.insertBefore(time, line.firstChild);
      }else{
        if (showTime) line.appendChild(time);
      }

      stack.appendChild(line);

      // 컨트롤 버튼들 (메시지 아래쪽에)
      const controls = document.createElement("div");
      controls.className = "msg-controls";

      const btnImg = document.createElement("button");
      btnImg.className = "msg-ctrl-btn";
      btnImg.textContent = "🖼";
      btnImg.title = "이미지 삽입";
      btnImg.addEventListener("click", () => insertImageAt(i));
      controls.appendChild(btnImg);

      const btnDel = document.createElement("button");
      btnDel.className = "msg-ctrl-btn delete";
      btnDel.textContent = "×";
      btnDel.title = "삭제";
      btnDel.addEventListener("click", () => {
        currentState.items.splice(i, 1);
        renderChat(currentState.items);
      });
      controls.appendChild(btnDel);

      stack.appendChild(controls);
      row.appendChild(stack);
      frag.appendChild(row);
    }

    elChat.appendChild(frag);
    elChat.scrollTop = elChat.scrollHeight;
    
    // 이미지 필요 메시지 팁 업데이트
    updateMediaTip();
  }

  // 이미지/이모티콘 업로드
  function uploadMediaAt(index) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataURL(file);
        currentState.items[index].imageUrl = dataUrl;
        currentState.items[index].needsUpload = false;
        renderChat(currentState.items);
      } catch(e) {
        alert("이미지 로드 실패");
      }
    };
    inp.click();
  }

  // 이미지 필요 메시지 수 계산
  function countMediaNeeded() {
    if (!currentState.items) return 0;
    return currentState.items.filter(it => it.needsUpload && !it.imageUrl).length;
  }

  // 미디어 팁 업데이트
  function updateMediaTip() {
    const count = countMediaNeeded();
    let tip = document.getElementById("mediaTip");
    if (count > 0) {
      if (!tip) {
        tip = document.createElement("div");
        tip.id = "mediaTip";
        tip.className = "media-tip";
        tip.style.cursor = "pointer";
        tip.addEventListener("click", () => showMedia());
        const parent = document.getElementById("cardMid");
        if (parent) parent.insertBefore(tip, parent.firstChild);
      }
      tip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>이미지가 필요한 <strong>${count}</strong>건의 채팅이 인식되었습니다. [채팅] 탭에서 업로드하세요.`;
      tip.style.display = "flex";
    } else if (tip) {
      tip.style.display = "none";
    }
    updateMediaTabVisibility();
  }

  function escapeHtml(s) { return s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : ""; }

  // 답장 편집 UI
  function showReplyEditor(msgIndex, currentReply) {
    const existing = document.getElementById("replyEditorModal");
    if (existing) existing.remove();

    const prevMsgs = [];
    for (let j = 0; j < msgIndex; j++) {
      if (currentState.items[j].type === "msg") {
        prevMsgs.push({ idx: j, name: currentState.items[j].originalName, text: currentState.items[j].text });
      }
    }

    const modal = document.createElement("div");
    modal.id = "replyEditorModal";
    modal.className = "modal-overlay show";
    modal.innerHTML = `
      <div class="modal reply-modal">
        <div class="modal-header">
          <h2>답장 설정</h2>
          <button class="modal-close" id="closeReplyEditor">&times;</button>
        </div>
        <div class="reply-modal-body">
          <div class="reply-input-group">
            <label>직접 입력</label>
            <input type="text" id="replyDirectInput" value="${escapeHtmlAttr(currentReply)}" placeholder="답장 내용...">
          </div>
          <div class="reply-select-group">
            <label>이전 메시지에서 선택</label>
            <div class="prev-messages-list" id="prevMsgList">
              ${prevMsgs.length === 0 ? '<div class="empty">이전 메시지 없음</div>' : 
                prevMsgs.map(m => `<div class="prev-msg-item" data-text="${escapeHtmlAttr(m.text)}">[${escapeHtml(m.name)}] ${escapeHtml(m.text.slice(0,40))}${m.text.length>40?'...':''}</div>`).join('')}
            </div>
          </div>
          <div class="reply-actions">
            <button class="btn" id="clearReplyBtn">답장 제거</button>
            <button class="btn primary" id="saveReplyBtn">저장</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = document.getElementById("closeReplyEditor");
    const input = document.getElementById("replyDirectInput");
    const saveBtn = document.getElementById("saveReplyBtn");
    const clearBtn = document.getElementById("clearReplyBtn");
    const list = document.getElementById("prevMsgList");

    closeBtn.onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    list.querySelectorAll(".prev-msg-item").forEach(item => {
      item.onclick = () => {
        input.value = item.dataset.text;
        list.querySelectorAll(".prev-msg-item").forEach(x => x.classList.remove("selected"));
        item.classList.add("selected");
      };
    });

    saveBtn.onclick = () => {
      currentState.items[msgIndex].replyTo = input.value.trim() || null;
      renderChat(currentState.items);
      modal.remove();
    };

    clearBtn.onclick = () => {
      currentState.items[msgIndex].replyTo = null;
      renderChat(currentState.items);
      modal.remove();
    };
  }

  // 이미지 삽입
  function insertImageAt(index) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataURL(file);
        const newMsg = {
          type: "msg",
          originalName: currentState.items[index]?.originalName || "나",
          time: "",
          text: "[이미지]",
          imageUrl: dataUrl
        };
        currentState.items.splice(index + 1, 0, newMsg);
        renderChat(currentState.items);
      } catch(e) {
        alert("이미지 로드 실패");
      }
    };
    inp.click();
  }

  function escapeHtml(s) { return s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : ""; }
  function escapeHtmlAttr(s) { return s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;") : ""; }

  // ===== App state =====
  let currentState = { items: [], lineCount: 0 };

  function renderAll(){
    const raw = elInput.value || "";
    const parsed = parseKakaoExport(raw);
    currentState = parsed;

    // unique names from msg items only
    const uniqueNames = Array.from(new Set(parsed.items.filter(x=>x.type==="msg").map(m => (m.originalName||"").trim()))).filter(Boolean);

    statsChip.textContent = `${uniqueNames.length}명 · ${parsed.lineCount}줄`;

    getProfileStateFor(raw);

    uniqueNames.forEach(n => {
      const p = ensurePerson(session.data, n);
      if (p && !p.color) p.color = pickColorFor(p.id);
    });

    if (session.data.meId && !session.data.people[session.data.meId]){
      session.data.meId = "";
    }

    renderPeople(uniqueNames);
    renderChat(parsed.items);

    previewSub.textContent = ""; // 요청대로 "저장하면..." 문구 제거
  }

  // ===== Tabs =====
  function showPeople(){
    tabPeople.classList.add("active");
    tabKakao.classList.remove("active");
    if (tabMedia) tabMedia.classList.remove("active");
    elPeoplePanel.style.display = "block";
    elKakaoPanel.style.display = "none";
    if (elMediaPanel) elMediaPanel.style.display = "none";
  }
  function showKakao(){
    tabKakao.classList.add("active");
    tabPeople.classList.remove("active");
    if (tabMedia) tabMedia.classList.remove("active");
    elPeoplePanel.style.display = "none";
    elKakaoPanel.style.display = "block";
    if (elMediaPanel) elMediaPanel.style.display = "none";
    renderKakaoSettingsUI();
  }
  function showMedia(){
    if (tabMedia) tabMedia.classList.add("active");
    tabPeople.classList.remove("active");
    tabKakao.classList.remove("active");
    elPeoplePanel.style.display = "none";
    elKakaoPanel.style.display = "none";
    if (elMediaPanel) elMediaPanel.style.display = "block";
    renderMediaPanel();
  }
  tabPeople.addEventListener("click", showPeople);
  tabKakao.addEventListener("click", showKakao);
  if (tabMedia) tabMedia.addEventListener("click", showMedia);

  // 미디어 패널 렌더링
  function renderMediaPanel() {
    if (!elMediaPanel) return;
    const mediaItems = currentState.items ? currentState.items.filter(it => it.needsUpload || it.imageUrl) : [];
    
    let html = '<div class="settingCard"><div class="settingTitle">이미지/이모티콘 목록</div>';
    
    if (mediaItems.length === 0) {
      html += '<div class="help">이미지나 이모티콘이 감지되지 않았습니다.</div>';
    } else {
      html += '<div class="media-list">';
      currentState.items.forEach((it, idx) => {
        if (!it.needsUpload && !it.imageUrl) return;
        const hasImage = !!it.imageUrl;
        html += `<div class="media-item ${hasImage ? 'has-image' : ''}" data-index="${idx}">
          <div class="media-item-info">
            <span class="media-item-icon">${it.mediaType === 'emoticon' ? '😊' : '🖼'}</span>
            <span class="media-item-text">${escapeHtml(it.originalName || '?')}: ${escapeHtml(it.text)}</span>
          </div>
          ${hasImage ? '<div class="media-item-preview"><img src="' + it.imageUrl + '" alt=""></div>' : ''}
          <button class="btn media-upload-btn" data-index="${idx}">${hasImage ? '변경' : '업로드'}</button>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    
    elMediaPanel.innerHTML = html;
    
    // 업로드 버튼 이벤트
    elMediaPanel.querySelectorAll('.media-upload-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        uploadMediaAt(idx);
      });
    });
  }

  // 미디어 탭 표시/숨김
  function updateMediaTabVisibility() {
    if (!tabMedia) return;
    const hasMedia = currentState.items && currentState.items.some(it => it.needsUpload || it.imageUrl);
    tabMedia.style.display = hasMedia ? 'inline-block' : 'none';
  }

  // ===== Layout toggle =====
  function setLayout(layout){
    if (layout === "A"){
      app.classList.add("layout-a");
      app.classList.remove("layout-b");
      btnLayoutA.classList.add("active");
      btnLayoutB.classList.remove("active");
      localStorage.setItem("rpbackup_layout", "A");
      // cleanup layout-b inline sizing
      cardInput.style.height = "";
      cardMid.style.height = "";
      cardMid.style.marginTop = "";
    }else{
      app.classList.add("layout-b");
      app.classList.remove("layout-a");
      btnLayoutB.classList.add("active");
      btnLayoutA.classList.remove("active");
      localStorage.setItem("rpbackup_layout", "B");
      // set default split heights
      setLayoutBHeightsFromVar();
      requestAnimationFrame(updateBRowResizer);
    }
  }
  btnLayoutA.addEventListener("click", () => setLayout("A"));
  btnLayoutB.addEventListener("click", () => setLayout("B"));

  // ===== Resizing =====
  function startDrag(onMove, onEnd){
    const mm = (e) => onMove(e);
    const mu = () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      onEnd && onEnd();
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  }

  function loadSizes(){
    try{
      const s = JSON.parse(localStorage.getItem("rpbackup_sizes_v2") || "{}");
      if (s.colA1) setRootVar("--colA1", s.colA1);
      if (s.colA2) setRootVar("--colA2", s.colA2);
      if (s.colBLeft) setRootVar("--colBLeft", s.colBLeft);
      if (s.rowBTopPx) setRootVar("--rowBTopPx", s.rowBTopPx);
    }catch(_e){}
  }
  function saveSizes(){
    const s = {
      colA1: getComputedStyle(document.documentElement).getPropertyValue("--colA1").trim(),
      colA2: getComputedStyle(document.documentElement).getPropertyValue("--colA2").trim(),
      colBLeft: getComputedStyle(document.documentElement).getPropertyValue("--colBLeft").trim(),
      rowBTopPx: getComputedStyle(document.documentElement).getPropertyValue("--rowBTopPx").trim()
    };
    try{ localStorage.setItem("rpbackup_sizes_v2", JSON.stringify(s)); }catch(_e){}
  }

  // layout A: between input and mid (colA1)
  rzA1.addEventListener("mousedown", (e) => {
    if (!app.classList.contains("layout-a")) return;
    e.preventDefault();
    const appRect = app.getBoundingClientRect();
    const startX = e.clientX;
    const startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--colA1")) || 380;
    startDrag((ev) => {
      const dx = ev.clientX - startX;
      const newW = clamp(startW + dx, 260, Math.max(260, appRect.width - 320 - 260));
      setRootVar("--colA1", px(newW));
    }, saveSizes);
  });

  // layout A: between mid and preview (colA2)
  rzA2.addEventListener("mousedown", (e) => {
    if (!app.classList.contains("layout-a")) return;
    e.preventDefault();
    const appRect = app.getBoundingClientRect();
    const startX = e.clientX;
    const startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--colA2")) || 320;
    startDrag((ev) => {
      const dx = ev.clientX - startX;
      const newW = clamp(startW + dx, 260, Math.max(260, appRect.width - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--colA1"))||380) - 260));
      setRootVar("--colA2", px(newW));
    }, saveSizes);
  });

  // layout B: left/right (colBLeft)
  rzBCol.addEventListener("mousedown", (e) => {
    if (!app.classList.contains("layout-b")) return;
    e.preventDefault();
    const appRect = app.getBoundingClientRect();
    const startX = e.clientX;
    const startLeft = getComputedStyle(document.documentElement).getPropertyValue("--colBLeft").trim() || "30%";
    const startPx = startLeft.endsWith("%") ? (parseFloat(startLeft)/100)*appRect.width : parseFloat(startLeft);

    startDrag((ev) => {
      const dx = ev.clientX - startX;
      const newPx = clamp(startPx + dx, 260, appRect.width - 320);
      const newPct = (newPx / appRect.width) * 100;
      setRootVar("--colBLeft", `${newPct.toFixed(2)}%`);
      updateBRowResizer();
    }, saveSizes);
  });

  function setLayoutBHeightsFromVar(){
    const appRect = app.getBoundingClientRect();
    const stored = getComputedStyle(document.documentElement).getPropertyValue("--rowBTopPx").trim();
    let topH = parseFloat(stored);
    if (!topH || isNaN(topH) || topH <= 0){
      topH = Math.max(220, Math.floor(appRect.height * 0.5) - 6);
    }
    topH = clamp(topH, 180, appRect.height - 220);
    cardInput.style.height = px(topH);
    cardMid.style.height = `calc(100% - ${px(topH)} - 12px)`;
    cardMid.style.marginTop = "12px";
    setRootVar("--rowBTopPx", px(topH));
  }

  function updateBRowResizer(){
    if (!app.classList.contains("layout-b")) return;
    const appRect = app.getBoundingClientRect();
    const cardRect = cardInput.getBoundingClientRect();
    const topWithinApp = cardRect.bottom - appRect.top;
    rzBRow.style.top = `${topWithinApp}px`;
    rzBRow.style.left = "12px";
    rzBRow.style.width = `calc(${getComputedStyle(document.documentElement).getPropertyValue("--colBLeft").trim()} - 24px)`;
  }

  rzBRow.addEventListener("mousedown", (e) => {
    if (!app.classList.contains("layout-b")) return;
    e.preventDefault();
    const appRect = app.getBoundingClientRect();
    const startY = e.clientY;
    const startH = cardInput.getBoundingClientRect().height;

    startDrag((ev) => {
      const dy = ev.clientY - startY;
      const newH = clamp(startH + dy, 180, appRect.height - 220);
      cardInput.style.height = px(newH);
      cardMid.style.height = `calc(100% - ${px(newH)} - 12px)`;
      cardMid.style.marginTop = "12px";
      setRootVar("--rowBTopPx", px(newH));
      updateBRowResizer();
    }, saveSizes);
  });

  // ===== Insert separator =====
  function insertAtCursor(textarea, text){
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const before = textarea.value.slice(0, start);
    const after  = textarea.value.slice(end);
    const needsNLBefore = before.length && !before.endsWith("\n");
    const needsNLAfter  = after.length && !after.startsWith("\n");
    const insert = (needsNLBefore ? "\n" : "") + text + (needsNLAfter ? "\n" : "");
    textarea.value = before + insert + after;
    const pos = (before + insert).length;
    textarea.selectionStart = textarea.selectionEnd = pos;
  }

  btnInsertSep.addEventListener("click", () => {
    const label = prompt("구분선 텍스트(예: 2025년 4월 25일 / 대화 / 회상 등)", "");
    if (label === null) return;
    const t = (label || "").trim() || "구분";
    insertAtCursor(elInput, `[[구분:${t}]]`);
    renderAll();
  });

  // 답장 추가 버튼
  const btnInsertReply = document.getElementById("btnInsertReply");
  if (btnInsertReply) {
    btnInsertReply.addEventListener("click", () => {
      const replyText = prompt("답장할 원본 내용을 입력하세요:", "");
      if (replyText === null) return;
      const t = (replyText || "").trim();
      if (!t) {
        alert("답장 내용을 입력해주세요.");
        return;
      }
      insertAtCursor(elInput, `[[답장:${t}]]`);
      renderAll();
    });
  }

  // ===== Buttons / input events =====
  btnClear.addEventListener("click", () => {
    elInput.value = "";
    renderAll();
  });

  let tmr = null;
  elInput.addEventListener("input", () => {
    clearTimeout(tmr);
    tmr = setTimeout(renderAll, 120);
  });

  // ===== Save: HTML =====
  // AFTERLOG: 편집 조작 요소(메시지 버튼·빈 답장칸·편집 표시)를 뺀 미리보기 HTML
  function cleanChatHtml(){
    const clone = elChat.cloneNode(true);
    clone.querySelectorAll(".msg-controls, .reply-box.placeholder, button, input").forEach(el => el.remove());
    clone.querySelectorAll("[contenteditable]").forEach(el => el.removeAttribute("contenteditable"));
    return clone.innerHTML;
  }

  function buildKakaoHtml(){
    // Save a standalone HTML snapshot (simple): embed current CSS variables + rendered chat as HTML.
    const title = "RP 백업 - 카카오톡";
    const bgColor = kakaoSettings.bgColor || "#b2c7da";
    const cssMode = modeToCss(kakaoSettings.bgMode || "fill");
    const bgImg = kakaoSettings.bgImageDataUrl ? `url('${kakaoSettings.bgImageDataUrl}')` : "none";

    const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;background:#d8d8d8;}
.wrap{min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding:20px;}
.card{width:min(860px, 96vw);border-radius:14px;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.12);border:1px solid #e5e7eb;background:#fff;}
.hd{padding:12px 14px;border-bottom:1px solid #e5e7eb;background:linear-gradient(#fff,#fafafa);font-weight:1000;}
.chat{padding:18px 16px;background:${bgColor};background-image:${bgImg};background-size:${cssMode.size};background-repeat:${cssMode.repeat};background-position:${cssMode.position};}
.sep{margin:10px auto 14px;width:fit-content;background:rgba(255,255,255,.65);border:1px solid rgba(229,231,235,.9);border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;}
.sys{margin:10px auto 14px;width:min(520px,94%);background:rgba(255,255,255,.50);border:1px solid rgba(229,231,235,.85);border-radius:14px;padding:10px 12px;font-size:12px;line-height:1.4;}
.msg-row{display:flex;gap:10px;margin-bottom:6px;align-items:flex-end;}
.msg-row.me{justify-content:flex-end;}
.msg-row.other{justify-content:flex-start;}
.meta-left{width:42px;flex:0 0 42px;display:flex;justify-content:center;}
.avatar{width:38px;height:38px;border-radius:14px;background:#e5e7eb;border:1px solid #d1d5db;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:900;color:#374151;}
.avatar img{width:100%;height:100%;object-fit:cover;}
.stack{display:flex;flex-direction:column;gap:4px;max-width:70%;min-width:0;}
.who{font-size:12px;font-weight:1000;color:rgba(17,24,39,.9);margin-left:2px;}
.bubble-line{display:flex;align-items:flex-end;gap:6px;}
.bubble{display:inline-block;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;box-shadow:0 6px 16px rgba(0,0,0,.08);}
.other .bubble{background:#fff;border-top-left-radius:4px;}
.me .bubble{background:#ffe812;border-top-right-radius:4px;}
.time{font-size:11px;color:rgba(55,65,81,.78);margin-bottom:2px;white-space:nowrap;}
</style></head>
<body>
<div class="wrap"><div class="card">
<div class="hd">미리보기</div>
<div class="chat">${cleanChatHtml()}</div>
</div></div>
</body></html>`;
    return html;
  }
  btnSaveHtml.addEventListener("click", () => {
    downloadBlob(`rpbackup_${Date.now()}.html`, new Blob([buildKakaoHtml()], {type:"text/html;charset=utf-8"}));
  });

  // ===== Save: PNG/JPG (DOM -> Image via SVG foreignObject) =====
  async function domToImageDataUrl(node, type){
    // Clone node to avoid scrollbars and preserve size
    const rect = node.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    const cloned = node.cloneNode(true);
    // Force full height rendering
    cloned.style.width = width + "px";
    cloned.style.height = height + "px";
    cloned.style.boxSizing = "border-box";

    // Wrap in a foreignObject SVG
    const serialized = new XMLSerializer().serializeToString(cloned);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">
            ${serialized}
          </div>
        </foreignObject>
      </svg>
    `;

    const svgBlob = new Blob([svg], {type:"image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(svgBlob);

    try{
      const img = new Image();
      // Attempt CORS-safe: everything is inline, but some browsers need this:
      img.crossOrigin = "anonymous";
      const loaded = new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(new Error("이미지 변환 실패(브라우저 제한 가능)"));
      });
      img.src = url;
      await loaded;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      const dataUrl = canvas.toDataURL(type, type === "image/jpeg" ? 0.92 : undefined);
      return { dataUrl, width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function savePreviewImage(format){
    // Render only the chat body to image
    const target = document.querySelector("#cardPreview .panelBody");
    if (!target) return;

    // Ensure it's at top for consistent export
    const oldScroll = target.scrollTop;
    target.scrollTop = 0;

    try{
      // For better chance, render a wrapper that includes background styles by creating a temp node
      const wrapper = document.createElement("div");
      wrapper.style.width = target.clientWidth + "px";
      wrapper.style.background = getComputedStyle(cardPreview).backgroundColor;
      wrapper.style.backgroundImage = getComputedStyle(cardPreview).backgroundImage;
      wrapper.style.backgroundSize = getComputedStyle(cardPreview).backgroundSize;
      wrapper.style.backgroundRepeat = getComputedStyle(cardPreview).backgroundRepeat;
      wrapper.style.backgroundPosition = getComputedStyle(cardPreview).backgroundPosition;
      wrapper.style.padding = "18px 16px";
      wrapper.style.boxSizing = "border-box";

      // Copy children HTML
      wrapper.innerHTML = target.innerHTML;

      // If too tall, slice into 3000px chunks
      const { dataUrl, width, height } = await domToImageDataUrl(wrapper, format === "png" ? "image/png" : "image/jpeg");

      // Convert to canvas to slice
      const img = new Image();
      const loaded = new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("이미지 로드 실패"));
      });
      img.src = dataUrl;
      await loaded;

      const maxH = 3000;
      const parts = Math.ceil(height / maxH);

      for (let p=0;p<parts;p++){
        const sliceH = Math.min(maxH, height - p*maxH);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = sliceH;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, -p*maxH);

        const outUrl = canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", format==="jpg" ? 0.92 : undefined);
        downloadDataUrl(`rpbackup_${Date.now()}_${p+1}.${format}`, outUrl);
      }
    }catch(e){
      alert("이미지 저장 실패: " + ((e && e.message) ? e.message : "알 수 없는 오류") + "\\n\\n브라우저가 foreignObject 기반 캡처를 제한할 수 있어. (대안: HTML 저장 후, 브라우저 인쇄/스크린샷)");
    }finally{
      target.scrollTop = oldScroll;
    }
  }

  btnSavePng.addEventListener("click", () => savePreviewImage("png"));
  btnSaveJpg.addEventListener("click", () => savePreviewImage("jpg"));

  // ===== Init =====
  try{
    const savedPlatform = localStorage.getItem(PLATFORM_KEY);
    setPlatform(savedPlatform === "cafe" ? "cafe" : "kakao");
  }catch(_e){
    setPlatform("kakao");
  }

  loadKakaoSettings();
  applyKakaoSettings();

  // Restore layout
  const savedLayout = localStorage.getItem("rpbackup_layout") || "A";
  setLayout(savedLayout === "B" ? "B" : "A");

  // Restore sizes
  loadSizes();
  if (app.classList.contains("layout-b")){
    setLayoutBHeightsFromVar();
    requestAnimationFrame(updateBRowResizer);
  }

  window.addEventListener("resize", () => {
    if (app.classList.contains("layout-b")){
      setLayoutBHeightsFromVar();
      updateBRowResizer();
    }
  });

  // Default tab
  showPeople();

  // initial render - 바로 실행
  renderKakaoSettingsUI();
  renderAll();  // 예시 텍스트 바로 파싱 및 렌더링

  // ===== AFTERLOG: 연결 등록 =====
  const KAKAO_DEFAULTS = JSON.parse(JSON.stringify(kakaoSettings));
  function refreshAll(){
    renderAll();
    renderKakaoSettingsUI();
  }
  window.__rpbaModule = {
    stateVersion: 1,
    fileBase: "kakaotalk",
    capabilities: { undo: false, export: ["html", "png", "copy"], importText: true },
    watchRoot: () => document.getElementById("app"),
    snapshot(){
      return {
        text: elInput.value || "",
        kakaoSettings: JSON.parse(JSON.stringify(kakaoSettings)),
        people: JSON.parse(JSON.stringify(session.data)),
        items: JSON.parse(JSON.stringify(currentState.items)),
        lineCount: currentState.lineCount
      };
    },
    load(st){
      if (!st){
        elInput.value = "";
        kakaoSettings = Object.assign({}, KAKAO_DEFAULTS);
        applyKakaoSettings();
        session = { key: "", data: { people: {}, meId: "" }, storageWritable: true };
        refreshAll();
        return;
      }
      elInput.value = st.text || "";
      kakaoSettings = Object.assign({}, KAKAO_DEFAULTS, st.kakaoSettings || {});
      applyKakaoSettings();
      session.key = storageKeyForInput(elInput.value);
      session.data = st.people && st.people.people ? st.people : { people: {}, meId: "" };
      renderAll();
      // 미리보기에서 고친 말풍선·삭제·답장·사진은 원문을 다시 해석하지 않고 저장본대로
      if (Array.isArray(st.items)){
        currentState = { items: st.items, lineCount: st.lineCount || 0 };
        renderChat(currentState.items);
      }
      renderKakaoSettingsUI();
    },
    importText(t){
      elInput.value = t;
      renderAll();
    },
    exportHtml: () => buildKakaoHtml(),
    copyHtml: () => cleanChatHtml(),
    pngTarget(){
      // 스크롤 영역 전체를 그리도록 화면 밖에 같은 폭의 사본을 만든다(배경색·배경 이미지 포함)
      const box = document.createElement("div");
      const w = Math.max(360, elChat.clientWidth || 600);
      const css = modeToCss(kakaoSettings.bgMode || "fill");
      box.style.cssText = "position:fixed;left:-100000px;top:0;width:" + w + "px;padding:18px 16px;box-sizing:border-box;" +
        "background-color:" + (kakaoSettings.bgColor || "#b2c7da") + ";" +
        (kakaoSettings.bgImageDataUrl ? "background-image:url('" + kakaoSettings.bgImageDataUrl + "');background-size:" + css.size + ";background-repeat:" + css.repeat + ";background-position:" + css.position + ";" : "");
      box.className = "panelBody";
      box.innerHTML = cleanChatHtml();
      document.getElementById("cardPreview").appendChild(box);
      return { el: box, bg: kakaoSettings.bgColor || "#b2c7da", cleanup: () => box.remove() };
    }
  };
})();
