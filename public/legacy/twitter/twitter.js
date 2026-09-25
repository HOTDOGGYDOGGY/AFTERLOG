/* AFTERLOG 연결판(원본: rpbackup/twitter.js). 바꾼 곳은 "AFTERLOG:" 주석으로 표시했다.
   - 주소의 mode=dm 이면 DM 전용(트위터 DM만), mode=twitter 이면 타임라인·멘션 타래 전용. 같은 모듈이지만 상태는 따로 저장된다
   - 원문을 고치거나 형식을 바꿔도 이미 올린 프로필 사진·인증 표시를 이어받음
   - 부모 창에 postMessage('*')를 보내던 플랫폼 버튼 코드 제거(통합 셸이 전환을 담당)
   - html2canvas를 CDN이 아니라 앱에 번들된 파일에서 읽음
   - 끝에 window.__rpbaModule 등록
*/
// Twitter Backup JS
(function() {
    'use strict';
    
    // State
    let currentType = 'dm'; // dm, timeline, thread
    let currentTheme = 'light';
    let fontSize = 15;
    let fontSizeName = 15;
    let settings = {
        showTime: true
    };
    
    let characters = {};
    let parsedMessages = [];
    let mainTweet = null;

    // AFTERLOG: DM 탭과 트위터 탭을 나눈다
    const FORCED_MODE = new URLSearchParams(location.search).get('mode'); // 'dm' | 'twitter' | null
    if (FORCED_MODE === 'twitter') currentType = 'timeline';
    function pickType(detected) {
        if (FORCED_MODE === 'dm') return 'dm';
        if (FORCED_MODE === 'twitter' && detected === 'dm') return currentType === 'dm' ? 'timeline' : currentType;
        return detected;
    }
    // AFTERLOG: 다시 해석해도 인물의 사진·인증 표시는 이어받는다
    function carryCharacters(prev) {
        Object.keys(characters).forEach(k => {
            const o = prev[k];
            if (!o) return;
            if (o.avatar) characters[k].avatar = o.avatar;
            if (o.verified) characters[k].verified = o.verified;
        });
    }
    
    // DOM Elements
    const inputArea = document.getElementById('inputArea');
    const previewContent = document.getElementById('previewContent');
    const characterList = document.getElementById('characterList');
    const typeValue = document.getElementById('typeValue');
    const toast = document.getElementById('toast');
    
    // ===== PARSING =====
    
    function detectType(text) {
        const lines = text.trim().split('\n');
        
        // DM 감지: 시간 패턴이 연속으로 나오면 DM
        const timePattern = /^(오전|오후)\s*\d{1,2}:\d{2}$/;
        let timeCount = 0;
        for (const line of lines) {
            if (timePattern.test(line.trim())) {
                timeCount++;
                if (timeCount >= 2) return 'dm';
            }
        }
        
        // Thread 감지: @멘션으로 시작하는 트윗이 있고, 조회수가 있으면 타래
        if (text.includes('조회수') || text.includes('views')) {
            return 'thread';
        }
        
        // Timeline 감지: 여러 개의 @핸들과 시간이 있으면
        const handlePattern = /@[\w_]+/g;
        const handles = text.match(handlePattern);
        if (handles && handles.length >= 2) {
            return 'timeline';
        }
        
        // 기본값
        return 'dm';
    }
    
    function parseDM(text) {
        const lines = text.trim().split('\n');
        const messages = [];
        let currentMsg = [];
        let currentTime = '';
        let isMe = false;
        
        const timePattern = /^(오전|오후)\s*\d{1,2}:\d{2}$/;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (timePattern.test(line)) {
                // 이전 메시지 저장
                if (currentMsg.length > 0) {
                    messages.push({
                        id: messages.length,
                        text: currentMsg.join('\n'),
                        time: currentTime,
                        isMe: isMe
                    });
                    currentMsg = [];
                }
                
                // 시간이 연속으로 나오면 (같은 시간 2번) 발신자 전환
                if (i + 1 < lines.length && timePattern.test(lines[i + 1].trim())) {
                    currentTime = line;
                    isMe = !isMe;
                    i++; // 다음 시간 스킵
                } else {
                    currentTime = line;
                }
            } else if (line) {
                currentMsg.push(line);
            }
        }
        
        // 마지막 메시지
        if (currentMsg.length > 0) {
            messages.push({
                id: messages.length,
                text: currentMsg.join('\n'),
                time: currentTime,
                isMe: isMe
            });
        }
        
        // 상대방 이름 추출 (첫 줄이 이름일 수 있음)
        const firstLine = lines[0].trim();
        if (!timePattern.test(firstLine) && firstLine.length < 30) {
            if (!characters['other']) {
                characters['other'] = {
                    displayName: firstLine,
                    handle: '',
                    avatar: null,
                    verified: false
                };
            }
            // 첫 줄이 이름이면 첫 메시지에서 제거
            if (messages.length > 0 && messages[0].text.startsWith(firstLine)) {
                messages[0].text = messages[0].text.substring(firstLine.length).trim();
            }
        } else {
            if (!characters['other']) {
                characters['other'] = {
                    displayName: '상대방',
                    handle: '',
                    avatar: null,
                    verified: false
                };
            }
        }
        
        if (!characters['me']) {
            characters['me'] = {
                displayName: '나',
                handle: '',
                avatar: null,
                verified: false
            };
        }
        
        return messages;
    }
    
    function parseTimeline(text) {
        const lines = text.trim().split('\n');
        const tweets = [];
        let i = 0;
        
        while (i < lines.length) {
            const line = lines[i].trim();
            
            // 이름 찾기
            if (line && !line.startsWith('@') && !line.startsWith('·')) {
                const name = line;
                i++;
                
                // @핸들 찾기
                if (i < lines.length && lines[i].trim().startsWith('@')) {
                    const handle = lines[i].trim();
                    i++;
                    
                    // · 스킵
                    if (i < lines.length && lines[i].trim() === '·') i++;
                    
                    // 시간
                    let time = '';
                    if (i < lines.length) {
                        time = lines[i].trim();
                        i++;
                    }
                    
                    // 내용 수집
                    let content = [];
                    while (i < lines.length) {
                        const l = lines[i].trim();
                        // 다음 트윗 시작 감지
                        if (l && !l.startsWith('@') && i + 1 < lines.length && lines[i + 1].trim().startsWith('@')) {
                            break;
                        }
                        if (l) content.push(l);
                        i++;
                    }
                    
                    // 캐릭터 등록
                    const charKey = handle.replace('@', '');
                    if (!characters[charKey]) {
                        characters[charKey] = {
                            displayName: name,
                            handle: handle,
                            avatar: null,
                            verified: name.includes('✓') || name.includes('🔵')
                        };
                    }
                    
                    tweets.push({
                        id: tweets.length,
                        author: charKey,
                        name: name.replace(/[✓🔵]/g, '').trim(),
                        handle: handle,
                        time: time,
                        text: content.join('\n'),
                        likes: 0,
                        retweets: 0,
                        replies: 0
                    });
                }
            } else {
                i++;
            }
        }
        
        return tweets;
    }
    
    function parseThread(text) {
        const lines = text.trim().split('\n');
        let mainTweetData = null;
        const replies = [];
        let i = 0;
        
        // 첫 트윗 (메인)
        if (i < lines.length) {
            const name = lines[i].trim();
            i++;
            
            if (i < lines.length && lines[i].trim().startsWith('@')) {
                const handle = lines[i].trim();
                i++;
                
                // 멘션된 상대 찾기
                let mention = '';
                if (i < lines.length && lines[i].trim().startsWith('@')) {
                    mention = lines[i].trim();
                    i++;
                }
                
                // 내용
                let content = [];
                while (i < lines.length) {
                    const l = lines[i].trim();
                    if (l.match(/^(오전|오후)\s*\d{1,2}:\d{2}\s*·/) || l.includes('조회수')) {
                        break;
                    }
                    if (l) content.push(l);
                    i++;
                }
                
                // 시간/조회수
                let time = '';
                let views = '';
                while (i < lines.length) {
                    const l = lines[i].trim();
                    if (l.match(/^(오전|오후)/)) {
                        time = l;
                    }
                    if (l.includes('조회수')) {
                        views = l;
                    }
                    if (l.startsWith('@') || (l && !l.startsWith('·') && !l.match(/^\d/) && i > 5)) {
                        break;
                    }
                    i++;
                }
                
                const charKey = handle.replace('@', '');
                if (!characters[charKey]) {
                    characters[charKey] = {
                        displayName: name,
                        handle: handle,
                        avatar: null,
                        verified: false
                    };
                }
                
                mainTweetData = {
                    author: charKey,
                    name: name,
                    handle: handle,
                    mention: mention,
                    text: content.join('\n'),
                    time: time,
                    views: views
                };
            }
        }
        
        // 답글들
        while (i < lines.length) {
            const line = lines[i].trim();
            
            // 이름 찾기 (특수문자로 시작하는 경우도 있음)
            if (line && !line.startsWith('@') && !line.startsWith('·') && !line.match(/^\d/)) {
                const name = line;
                i++;
                
                if (i < lines.length && lines[i].trim().startsWith('@')) {
                    const handle = lines[i].trim();
                    i++;
                    
                    // · 스킵
                    if (i < lines.length && lines[i].trim() === '·') i++;
                    
                    // 날짜
                    let date = '';
                    if (i < lines.length) {
                        date = lines[i].trim();
                        i++;
                    }
                    
                    // 내용
                    let content = [];
                    while (i < lines.length) {
                        const l = lines[i].trim();
                        // 다음 답글 시작 감지 (이름 + @핸들 패턴)
                        if (l && !l.startsWith('@') && !l.startsWith('·') && 
                            i + 1 < lines.length && lines[i + 1].trim().startsWith('@')) {
                            break;
                        }
                        // 숫자만 있는 줄은 스킵 (좋아요/RT 수)
                        if (!l.match(/^[\d,]+$/)) {
                            if (l) content.push(l);
                        }
                        i++;
                    }
                    
                    const charKey = handle.replace('@', '');
                    if (!characters[charKey]) {
                        characters[charKey] = {
                            displayName: name,
                            handle: handle,
                            avatar: null,
                            verified: false
                        };
                    }
                    
                    replies.push({
                        id: replies.length,
                        author: charKey,
                        name: name,
                        handle: handle,
                        date: date,
                        text: content.join('\n')
                    });
                }
            } else {
                i++;
            }
        }
        
        mainTweet = mainTweetData;
        return replies;
    }
    
    // ===== RENDERING =====
    
    function renderPreview() {
        if (parsedMessages.length === 0 && !mainTweet) {
            previewContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <div class="empty-state-text">왼쪽에 DM, 타임라인 트윗, 멘션 타래를 붙여넣으면<br>여기에 미리보기가 표시됩니다.</div>
                </div>
            `;
            return;
        }
        
        previewContent.className = 'preview-content twitter-preview theme-' + currentTheme;
        previewContent.style.setProperty('--font-size', fontSize + 'px');
        
        let html = '';
        
        if (currentType === 'dm') {
            html = renderDM();
        } else if (currentType === 'timeline') {
            html = renderTimeline();
        } else if (currentType === 'thread') {
            html = renderThread();
        }
        
        previewContent.innerHTML = html;
    }
    
    function renderDM() {
        const other = characters['other'] || { displayName: '상대방', avatar: null };
        
        let html = '<div class="tw-dm-container">';
        
        // 헤더
        html += '<div class="tw-dm-header">';
        html += '<div class="tw-dm-avatar">' + getAvatarHtml('other') + '</div>';
        html += '<div>';
        html += '<div class="tw-dm-name">' + escapeHtml(other.displayName) + '</div>';
        if (other.handle) {
            html += '<div class="tw-dm-handle">' + escapeHtml(other.handle) + '</div>';
        }
        html += '</div></div>';
        
        // 메시지들
        html += '<div class="tw-dm-messages">';
        
        let lastTime = '';
        parsedMessages.forEach((msg, idx) => {
            // 시간 표시
            if (settings.showTime && msg.time && msg.time !== lastTime) {
                html += '<div class="tw-dm-time">' + escapeHtml(msg.time) + '</div>';
                lastTime = msg.time;
            }
            
            const msgClass = msg.isMe ? 'me' : 'other';
            html += '<div class="tw-dm-msg ' + msgClass + '">' + escapeHtml(msg.text).replace(/\n/g, '<br>') + '</div>';
        });
        
        html += '</div></div>';
        
        return html;
    }
    
    function renderTimeline() {
        let html = '<div class="tw-timeline">';
        
        parsedMessages.forEach(tweet => {
            const char = characters[tweet.author] || {};
            
            html += '<div class="tw-tweet">';
            html += '<div class="tw-tweet-avatar">' + getAvatarHtml(tweet.author) + '</div>';
            html += '<div class="tw-tweet-content">';
            
            // 헤더
            html += '<div class="tw-tweet-header">';
            html += '<span class="tw-tweet-name" style="font-size:' + fontSizeName + 'px">' + escapeHtml(tweet.name || char.displayName) + '</span>';
            html += '<span class="tw-tweet-handle">' + escapeHtml(tweet.handle) + '</span>';
            if (settings.showTime && tweet.time) {
                html += '<span class="tw-tweet-time">· ' + escapeHtml(tweet.time) + '</span>';
            }
            html += '</div>';
            
            // 내용
            html += '<div class="tw-tweet-text" style="font-size:' + fontSize + 'px">' + escapeHtml(tweet.text).replace(/\n/g, '<br>') + '</div>';
            
            html += '</div></div>';
        });
        
        html += '</div>';
        return html;
    }
    
    function renderThread() {
        let html = '<div class="tw-thread">';
        
        // 메인 트윗
        if (mainTweet) {
            const char = characters[mainTweet.author] || {};
            
            html += '<div class="tw-thread-main">';
            html += '<div class="tw-tweet" style="border:none;padding:0;">';
            html += '<div class="tw-tweet-avatar">' + getAvatarHtml(mainTweet.author) + '</div>';
            html += '<div class="tw-tweet-content">';
            
            html += '<div class="tw-tweet-header">';
            html += '<span class="tw-tweet-name" style="font-size:' + fontSizeName + 'px">' + escapeHtml(mainTweet.name) + '</span>';
            html += '</div>';
            html += '<div class="tw-tweet-handle">' + escapeHtml(mainTweet.handle) + '</div>';
            
            if (mainTweet.mention) {
                html += '<div style="margin-top:8px;color:var(--tw-accent);">' + escapeHtml(mainTweet.mention) + '</div>';
            }
            
            html += '<div class="tw-tweet-text" style="font-size:' + fontSize + 'px;margin-top:8px;">' + escapeHtml(mainTweet.text).replace(/\n/g, '<br>') + '</div>';
            
            if (settings.showTime && mainTweet.time) {
                html += '<div class="tw-thread-info">' + escapeHtml(mainTweet.time) + '</div>';
            }
            
            html += '</div></div></div>';
        }
        
        // 답글들
        if (parsedMessages.length > 0) {
            html += '<div class="tw-thread-replies-header">💬 답글 게시하기</div>';
            
            parsedMessages.forEach((reply, idx) => {
                const char = characters[reply.author] || {};
                
                if (idx > 0) {
                    html += '<div class="tw-reply-line"></div>';
                }
                
                html += '<div class="tw-reply">';
                html += '<div class="tw-tweet-avatar">' + getAvatarHtml(reply.author) + '</div>';
                html += '<div class="tw-tweet-content">';
                
                html += '<div class="tw-tweet-header">';
                html += '<span class="tw-tweet-name" style="font-size:' + fontSizeName + 'px">' + escapeHtml(reply.name || char.displayName) + '</span>';
                html += '<span class="tw-tweet-handle">' + escapeHtml(reply.handle) + '</span>';
                if (settings.showTime && reply.date) {
                    html += '<span class="tw-tweet-time">· ' + escapeHtml(reply.date) + '</span>';
                }
                html += '</div>';
                
                html += '<div class="tw-tweet-text" style="font-size:' + fontSize + 'px">' + escapeHtml(reply.text).replace(/\n/g, '<br>') + '</div>';
                
                html += '</div></div>';
            });
        }
        
        html += '</div>';
        return html;
    }
    
    function getAvatarHtml(key) {
        const char = characters[key];
        if (char && char.avatar) {
            return '<img src="' + char.avatar + '" alt="">';
        }
        // 첫 글자 표시
        const displayName = char ? char.displayName : key;
        const firstChar = displayName ? displayName.charAt(0) : '?';
        return escapeHtml(firstChar);
    }
    
    function renderCharacterList() {
        const keys = Object.keys(characters);
        
        if (keys.length === 0) {
            characterList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-text">트윗/DM을 붙여넣으면<br>인물 목록이 여기에 표시됩니다</div>
                </div>
            `;
            return;
        }
        
        let html = '';
        keys.forEach(key => {
            const char = characters[key];
            const avatarContent = char.avatar 
                ? '<img src="' + char.avatar + '" alt="">' 
                : escapeHtml(char.displayName.charAt(0));
            
            html += '<div class="character-item" data-key="' + escapeHtml(key) + '">';
            html += '<div class="character-header">';
            html += '<div class="character-avatar" data-key="' + escapeHtml(key) + '">' + avatarContent + '</div>';
            html += '<div class="character-info">';
            html += '<div class="character-name">' + escapeHtml(char.displayName) + '</div>';
            if (char.handle) {
                html += '<div class="character-handle">' + escapeHtml(char.handle) + '</div>';
            }
            html += '</div>';
            html += '<div class="character-controls">';
            html += '<button class="char-btn ' + (char.verified ? 'active' : '') + '" data-action="verify" data-key="' + escapeHtml(key) + '">✓</button>';
            html += '</div>';
            html += '</div></div>';
        });
        
        characterList.innerHTML = html;
        
        // 아바타 클릭 이벤트
        characterList.querySelectorAll('.character-avatar').forEach(el => {
            el.addEventListener('click', function() {
                const key = this.dataset.key;
                uploadAvatar(key);
            });
        });
        
        // 인증 버튼 이벤트
        characterList.querySelectorAll('.char-btn[data-action="verify"]').forEach(btn => {
            btn.addEventListener('click', function() {
                const key = this.dataset.key;
                if (characters[key]) {
                    characters[key].verified = !characters[key].verified;
                    this.classList.toggle('active', characters[key].verified);
                    renderPreview();
                }
            });
        });
    }
    
    function uploadAvatar(key) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = function() {
            const file = this.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                if (characters[key]) {
                    characters[key].avatar = e.target.result;
                    renderCharacterList();
                    renderPreview();
                }
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }
    
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;');
    }
    
    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }
    
    // ===== EVENT HANDLERS =====
    
    // 입력 변경
    inputArea.addEventListener('input', function() {
        const text = this.value.trim();
        if (!text) {
            parsedMessages = [];
            mainTweet = null;
            characters = {};
            typeValue.textContent = '-';
            renderCharacterList();
            renderPreview();
            return;
        }
        
        // 타입 감지
        const detected = pickType(detectType(text));
        currentType = detected;
        typeValue.textContent = detected === 'dm' ? 'DM' : detected === 'timeline' ? '타임라인' : '멘션 타래';
        
        // 타입 버튼 업데이트
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === detected);
        });
        
        // 파싱
        const prevChars = characters;
        characters = {};
        mainTweet = null;
        
        if (detected === 'dm') {
            parsedMessages = parseDM(text);
        } else if (detected === 'timeline') {
            parsedMessages = parseTimeline(text);
        } else {
            parsedMessages = parseThread(text);
        }
        carryCharacters(prevChars);
        
        renderCharacterList();
        renderPreview();
    });
    
    // 탭 전환
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('tab-' + tab).classList.add('active');
        });
    });
    
    // 타입 선택
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            currentType = this.dataset.type;
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // 재파싱
            const text = inputArea.value.trim();
            if (text) {
                const prevChars = characters;
                characters = {};
                mainTweet = null;
                if (currentType === 'dm') {
                    parsedMessages = parseDM(text);
                } else if (currentType === 'timeline') {
                    parsedMessages = parseTimeline(text);
                } else {
                    parsedMessages = parseThread(text);
                }
                carryCharacters(prevChars);
                renderCharacterList();
            }
            
            renderPreview();
        });
    });
    
    // 테마 선택
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            currentTheme = this.dataset.theme;
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            renderPreview();
        });
    });
    
    // 전체 폰트 크기 연동
    const fontSizeAllSlider = document.getElementById('fontSizeAll');
    const fontSizeAllInput = document.getElementById('fontSizeAllInput');
    
    if (fontSizeAllSlider) {
        fontSizeAllSlider.addEventListener('input', function() {
            const v = parseInt(this.value);
            if (fontSizeAllInput) fontSizeAllInput.value = v;
            fontSizeName = v;
            fontSize = v;
            if (fontSizeNameSlider) fontSizeNameSlider.value = v;
            if (fontSizeNameInput) fontSizeNameInput.value = v;
            if (fontSizeSlider) fontSizeSlider.value = v;
            if (fontSizeInput) fontSizeInput.value = v;
            renderPreview();
        });
    }
    if (fontSizeAllInput) {
        fontSizeAllInput.addEventListener('input', function() {
            const v = parseInt(this.value) || 15;
            if (fontSizeAllSlider) fontSizeAllSlider.value = v;
            fontSizeAllSlider.dispatchEvent(new Event('input'));
        });
    }
    
    // 폰트 사이즈 - 닉네임
    const fontSizeNameSlider = document.getElementById('fontSizeName');
    const fontSizeNameInput = document.getElementById('fontSizeNameInput');
    
    if (fontSizeNameSlider) {
        fontSizeNameSlider.addEventListener('input', function() {
            fontSizeName = parseInt(this.value);
            if (fontSizeNameInput) fontSizeNameInput.value = fontSizeName;
            renderPreview();
        });
    }
    
    if (fontSizeNameInput) {
        fontSizeNameInput.addEventListener('input', function() {
            fontSizeName = parseInt(this.value) || 15;
            if (fontSizeNameSlider) fontSizeNameSlider.value = fontSizeName;
            renderPreview();
        });
    }
    
    // 폰트 사이즈 - 내용
    const fontSizeSlider = document.getElementById('fontSizeContent');
    const fontSizeInput = document.getElementById('fontSizeContentInput');
    
    if (fontSizeSlider) {
        fontSizeSlider.addEventListener('input', function() {
            fontSize = parseInt(this.value);
            if (fontSizeInput) fontSizeInput.value = fontSize;
            renderPreview();
        });
    }
    
    if (fontSizeInput) {
        fontSizeInput.addEventListener('input', function() {
            fontSize = parseInt(this.value) || 15;
            if (fontSizeSlider) fontSizeSlider.value = fontSize;
            renderPreview();
        });
    }
    
    // 토글 스위치
    document.querySelectorAll('.toggle-switch').forEach(toggle => {
        toggle.addEventListener('click', function() {
            const setting = this.dataset.setting;
            settings[setting] = !settings[setting];
            this.classList.toggle('active', settings[setting]);
            renderPreview();
        });
    });
    
    // 전체 초기화
    const resetSettingsBtn = document.getElementById('resetAllSettings');
    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', function() {
            currentTheme = 'light';
            fontSize = 15;
            fontSizeName = 15;
            settings = { showTime: true };
            
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            const lightBtn = document.querySelector('.theme-btn[data-theme="light"]');
            if (lightBtn) lightBtn.classList.add('active');
            
            if (fontSizeSlider) fontSizeSlider.value = 15;
            if (fontSizeInput) fontSizeInput.value = 15;
            if (fontSizeNameSlider) fontSizeNameSlider.value = 15;
            if (fontSizeNameInput) fontSizeNameInput.value = 15;
            if (fontSizeAllSlider) fontSizeAllSlider.value = 15;
            if (fontSizeAllInput) fontSizeAllInput.value = 15;
            
            document.querySelectorAll('.toggle-switch').forEach(t => {
                const s = t.dataset.setting;
                t.classList.toggle('active', !!settings[s]);
            });
            
            renderPreview();
            showToast('설정이 초기화되었습니다.');
        });
    }
    
    // 도움말
    document.getElementById('helpBtn').addEventListener('click', function() {
        helpModal.classList.add('show');
    });
    
    document.getElementById('closeHelp').addEventListener('click', function() {
        helpModal.classList.remove('show');
    });
    
    helpModal.addEventListener('click', function(e) {
        if (e.target === helpModal) {
            helpModal.classList.remove('show');
        }
    });
    
    // 내보내기
    document.getElementById('copyHtml').addEventListener('click', function() {
        const html = previewContent.innerHTML;
        navigator.clipboard.writeText(html).then(() => {
            showToast('HTML이 복사되었습니다.');
        });
    });
    
    document.getElementById('exportHtml').addEventListener('click', function() {
        const styles = document.querySelector('link[href*="twitter.css"]');
        let css = '';
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    if (rule.cssText && !rule.cssText.includes(':hover')) {
                        css += rule.cssText + '\n';
                    }
                }
            } catch(e) {}
        }
        
        const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>트위터 백업</title>' +
            '<style>' + css + '</style></head>' +
            '<body style="background:#0a0a14;padding:20px;">' +
            '<div style="max-width:600px;margin:0 auto;">' + previewContent.outerHTML + '</div>' +
            '</body></html>';
        
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'twitter-backup.html';
        a.click();
        URL.revokeObjectURL(url);
    });
    
    document.getElementById('exportPng').addEventListener('click', function() {
        const script = document.createElement('script');
        script.src = './vendor/html2canvas.min.js'; // AFTERLOG: CDN 대신 번들 파일
        script.onload = function() {
            html2canvas(previewContent, {
                backgroundColor: currentTheme === 'light' ? '#fff' : currentTheme === 'dim' ? '#15202b' : '#000',
                scale: 3
            }).then(canvas => {
                const link = document.createElement('a');
                link.download = 'twitter-backup.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
            });
        };
        
        if (typeof html2canvas === 'undefined') {
            document.head.appendChild(script);
        } else {
            script.onload();
        }
    });
    
    document.getElementById('resetAll').addEventListener('click', function() {
        if (confirm('모든 내용을 초기화하시겠습니까?')) {
            inputArea.value = '';
            parsedMessages = [];
            mainTweet = null;
            characters = {};
            typeValue.textContent = '-';
            renderCharacterList();
            renderPreview();
            showToast('초기화되었습니다.');
        }
    });
    
    // AFTERLOG: 플랫폼 버튼(부모 창에 postMessage('*')) 제거 — 통합 셸이 전환을 담당
    
    // 리사이저
    const resizer = document.getElementById('resizer');
    const leftPanel = document.getElementById('leftPanel');
    
    let isResizing = false;
    
    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;
        const newWidth = e.clientX;
        if (newWidth > 250 && newWidth < 600) {
            leftPanel.style.width = newWidth + 'px';
        }
    });
    
    document.addEventListener('mouseup', function() {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
    

    // ===== AFTERLOG: 연결 등록 =====
    const TYPE_LABEL = { dm: 'DM', timeline: '타임라인', thread: '멘션 타래' };
    // 탭에 맞는 형식 버튼만 보인다
    document.querySelectorAll('.type-btn').forEach(btn => {
        const t = btn.dataset.type;
        if ((FORCED_MODE === 'dm' && t !== 'dm') || (FORCED_MODE === 'twitter' && t === 'dm')) btn.hidden = true;
        btn.classList.toggle('active', t === currentType);
    });
    function syncControls() {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === currentType));
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === currentTheme));
        typeValue.textContent = inputArea.value.trim() ? TYPE_LABEL[currentType] : '-';
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('fontSizeAll', fontSize); set('fontSizeAllInput', fontSize);
        set('fontSizeContent', fontSize); set('fontSizeContentInput', fontSize);
        set('fontSizeName', fontSizeName); set('fontSizeNameInput', fontSizeName);
        document.querySelectorAll('.toggle-switch').forEach(t => {
            const k = t.dataset.setting;
            if (k in settings) t.classList.toggle('active', !!settings[k]);
        });
    }
    function cleanPreview() {
        const clone = previewContent.cloneNode(true);
        clone.querySelectorAll('button, input').forEach(el => el.remove());
        clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
        return clone;
    }
    window.__rpbaModule = {
        stateVersion: 1,
        fileBase: FORCED_MODE === 'dm' ? 'twitter-dm' : 'twitter',
        capabilities: { undo: false, export: ['html', 'png', 'copy'], importText: true },
        watchRoot: () => document.getElementById('mainContainer'),
        snapshot() {
            return JSON.parse(JSON.stringify({ text: inputArea.value, currentType, currentTheme, fontSize, fontSizeName, settings, characters, parsedMessages, mainTweet }));
        },
        load(st) {
            inputArea.value = st ? (st.text || '') : '';
            currentType = pickType(st && st.currentType ? st.currentType : (FORCED_MODE === 'twitter' ? 'timeline' : 'dm'));
            currentTheme = (st && st.currentTheme) || 'light';
            fontSize = (st && st.fontSize) || 15;
            fontSizeName = (st && st.fontSizeName) || 15;
            settings = Object.assign({ showTime: true }, (st && st.settings) || {});
            characters = (st && st.characters) || {};
            parsedMessages = (st && Array.isArray(st.parsedMessages)) ? st.parsedMessages : [];
            mainTweet = (st && st.mainTweet) || null;
            syncControls();
            renderCharacterList();
            renderPreview();
        },
        importText(t) {
            inputArea.value = t;
            inputArea.dispatchEvent(new Event('input'));
        },
        exportHtml() {
            let css = '';
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) if (rule.cssText && !rule.cssText.includes(':hover')) css += rule.cssText + '\n';
                } catch (e) { /* 다른 출처 스타일은 건너뜀 */ }
            }
            const bg = currentTheme === 'light' ? '#e8ebee' : currentTheme === 'dim' ? '#0d141c' : '#000';
            return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>' + (FORCED_MODE === 'dm' ? '트위터 DM 백업' : '트위터 백업') + '</title>' +
                '<style>' + css + '</style></head>' +
                '<body style="background:' + bg + ';padding:20px;margin:0;">' +
                '<div style="max-width:600px;margin:0 auto;">' + cleanPreview().outerHTML + '</div></body></html>';
        },
        copyHtml: () => cleanPreview().innerHTML,
        pngTarget() {
            return { el: previewContent, bg: currentTheme === 'light' ? '#fff' : currentTheme === 'dim' ? '#15202b' : '#000' };
        }
    };
})();
