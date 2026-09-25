/* AFTERLOG 연결판(원본: rpbackup/cafe.js). 바꾼 곳은 "AFTERLOG:" 주석으로 표시했다.
   - 예시 글을 자동으로 넣지 않음(끝에 있던 예시 채우기 블록 제거)
   - html2canvas를 CDN이 아니라 앱에 번들된 파일에서 읽음
   - 끝에 window.__rpbaModule 등록(상태 저장·복원·실행취소·내보내기)
*/
(function() {
    'use strict';

    // v6: 기본 예시는 placeholder가 아닌 실제 텍스트(value)로 넣습니다.
    const DEFAULT_EXAMPLE = "작성자 정보\n\t예시 A\n작성일시2026.01.18. 12:35\n안녕하세요.\n댓글 정보\n^댓글 2\t\n등록순\n프로필\n예시 B\n2026.01.18. 12:44답글\n반갑습니다~ (인사한다)\n프로필\n예시 A작성자\n2026.01.18. 12:59답글\n(사망한다)\n프로필\n예시 B\n2026.01.18. 12:57답글\n어째서?! (놀란다)";

    
    // State
    let characters = {};
    let mainPost = null;
    let parsedMessages = [];
    let currentAvatarTarget = null;
    let currentSkin = 'default';  // 기본형
    let skinTheme = 'light';
    let mainFont = 'default';
    let actionFont = 'default';
    let actionColor = '#ACACAC';  // 행동묘사 색상
    let actionStyle = 'normal';   // 행동묘사 스타일 (normal/italic/bold)
    let timestampMode = 'always';
    
    // 폰트 사이즈 설정 (스킨별)
    const fontSizesBySkin = {
        default: { nick: 13, content: 13, post: 14 },
        chat: { nick: 13, content: 13, post: 14 },
        navercafe: { nick: 12, content: 13, post: 14 }
    };
    
    // 줄간격 설정
    let lineHeightContent = 1.6;
    let lineHeightPost = 1.8;
    
    function getFontSizes() {
        return fontSizesBySkin[currentSkin] || { nick: 13, content: 13, post: 14 };
    }
    
    const settings = {
        showActions: false,  // 기본값: 체크 해제
        showDateDivider: false,
        showReplyIndent: true
    };
    
    // Undo/Redo system
    let undoStack = [];
    let redoStack = [];
    const MAX_HISTORY = 50;
    
    const defaultColors = [
        '#7c6f9f', '#6f9f7c', '#9f7c6f', '#6f7c9f', '#9f6f8c',
        '#8c9f6f', '#6f8c9f', '#9f8c6f', '#7c9f6f', '#6f9f8c'
    ];
    
    // DOM Elements
    const inputArea = document.getElementById('inputArea');
    const characterList = document.getElementById('characterList');
    const previewContent = document.getElementById('previewContent');
    const avatarInput = document.getElementById('avatarInput');
    const toast = document.getElementById('toast');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const helpModal = document.getElementById('helpModal');
    
    // ===== UTILITIES =====
    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function parseDate(dateStr) {
        if (!dateStr) return null;
        const match = dateStr.match(/(\d{4})\.(\d{2})\.(\d{2})/);
        if (match) {
            return match[1] + '년 ' + parseInt(match[2]) + '월 ' + parseInt(match[3]) + '일';
        }
        return null;
    }
    
    // ===== UNDO/REDO =====
    function saveState() {
        const state = {
            characters: JSON.parse(JSON.stringify(characters)),
            mainPost: mainPost ? JSON.parse(JSON.stringify(mainPost)) : null,
            parsedMessages: JSON.parse(JSON.stringify(parsedMessages)),
            inputValue: inputArea.value
        };
        
        undoStack.push(state);
        if (undoStack.length > MAX_HISTORY) {
            undoStack.shift();
        }
        redoStack = [];
        updateUndoRedoButtons();
    }
    
    function undo() {
        if (undoStack.length === 0) return;
        
        const currentState = {
            characters: JSON.parse(JSON.stringify(characters)),
            mainPost: mainPost ? JSON.parse(JSON.stringify(mainPost)) : null,
            parsedMessages: JSON.parse(JSON.stringify(parsedMessages)),
            inputValue: inputArea.value
        };
        redoStack.push(currentState);
        
        const prevState = undoStack.pop();
        characters = prevState.characters;
        mainPost = prevState.mainPost;
        parsedMessages = prevState.parsedMessages;
        inputArea.value = prevState.inputValue;
        
        renderCharacterList();
        renderPreview();
        updateUndoRedoButtons();
        showToast('실행취소');
    }
    
    function redo() {
        if (redoStack.length === 0) return;
        
        const currentState = {
            characters: JSON.parse(JSON.stringify(characters)),
            mainPost: mainPost ? JSON.parse(JSON.stringify(mainPost)) : null,
            parsedMessages: JSON.parse(JSON.stringify(parsedMessages)),
            inputValue: inputArea.value
        };
        undoStack.push(currentState);
        
        const nextState = redoStack.pop();
        characters = nextState.characters;
        mainPost = nextState.mainPost;
        parsedMessages = nextState.parsedMessages;
        inputArea.value = nextState.inputValue;
        
        renderCharacterList();
        renderPreview();
        updateUndoRedoButtons();
        showToast('다시실행');
    }
    
    function updateUndoRedoButtons() {
        undoBtn.disabled = undoStack.length === 0;
        redoBtn.disabled = redoStack.length === 0;
    }
    
    // ===== PARSER =====
    // 이름에서 "작성자" 접미사 제거하고 실제 이름 반환
    function normalizeAuthorName(name) {
        if (!name) return '';
        return name.replace(/작성자$/, '').trim();
    }
    
    // 이름이 작성자인지 확인
    function isAuthorName(name) {
        return name && name.endsWith('작성자');
    }
    
    // 같은 인물인지 확인 (작성자 접미사 제외하고 비교)
    function isSamePerson(name1, name2) {
        return normalizeAuthorName(name1) === normalizeAuthorName(name2);
    }
    
    // 캐릭터 찾기 (작성자 접미사 무시)
    function findCharacter(name) {
        const normalized = normalizeAuthorName(name);
        for (const key of Object.keys(characters)) {
            if (normalizeAuthorName(key) === normalized) {
                return characters[key];
            }
        }
        return null;
    }
    
    // 캐릭터 키 찾기 (작성자 접미사 무시)
    function findCharacterKey(name) {
        const normalized = normalizeAuthorName(name);
        for (const key of Object.keys(characters)) {
            if (normalizeAuthorName(key) === normalized) {
                return key;
            }
        }
        return null;
    }
    
    function parseNaverCafe(text) {
        const lines = text.split('\n');
        const messages = [];
        mainPost = null;
        
        let i = 0;
        let postAuthor = null;
        let hasAuthorInfo = false;
        
        // 먼저 "작성자 정보"가 있는지 확인
        for (let j = 0; j < lines.length; j++) {
            if (lines[j].trim() === '작성자 정보') {
                hasAuthorInfo = true;
                break;
            }
        }
        
        // 작성자 정보가 있으면 본문 파싱
        if (hasAuthorInfo) {
            while (i < lines.length) {
                const line = lines[i].trim();
                
                if (line === '작성자 정보') {
                    i++;
                    if (i >= lines.length) break;
                    
                    postAuthor = normalizeAuthorName(lines[i].trim());
                    i++;
                    
                    // 날짜 찾기
                    let date = '';
                    while (i < lines.length) {
                        const l = lines[i].trim();
                        const dateMatch = l.match(/작성일시(\d{4}\.\d{2}\.\d{2}\.\s*\d{2}:\d{2})/);
                        if (dateMatch) {
                            date = dateMatch[1];
                            i++;
                            break;
                        }
                        if (l === '삭제') {
                            i++;
                            continue;
                        }
                        i++;
                        if (i - 3 > 10) break;
                    }
                    
                    // 본문 수집
                    let content = [];
                    while (i < lines.length) {
                        const l = lines[i].trim();
                        if (l === '댓글 정보' || l.startsWith('^댓글') || l.match(/^댓글\s*\d+/)) {
                            break;
                        }
                        if (l && l !== '삭제') {
                            content.push(l);
                        }
                        i++;
                    }
                    
                    // 캐릭터 등록 (작성자)
                    if (postAuthor && !findCharacter(postAuthor)) {
                        characters[postAuthor] = {
                            displayName: postAuthor,
                            avatar: null,
                            color: defaultColors[0],
                            useColor: false,
                            isMe: false,
                            isAuthor: true,
                            hidden: false
                        };
                    } else if (postAuthor) {
                        const existingKey = findCharacterKey(postAuthor);
                        if (existingKey) {
                            characters[existingKey].isAuthor = true;
                        }
                    }
                    
                    if (postAuthor && content.length > 0) {
                        mainPost = {
                            author: postAuthor,
                            date: date,
                            content: content.join('\n').trim()
                        };
                    }
                    break;
                }
                i++;
            }
        }
        
        // 댓글 정보 이후로 이동 또는 프로필부터 시작
        let foundCommentSection = false;
        while (i < lines.length) {
            const line = lines[i].trim();
            if (line === '댓글 정보' || line.startsWith('^댓글') || line.match(/^댓글\s*\d+/) || line === '등록순' || line === '최신순') {
                foundCommentSection = true;
                i++;
                continue;
            }
            if (line === '프로필' || line.startsWith('프로필 ') || line.startsWith('프로필\t')) {
                break;
            }
            i++;
        }
        
        // 작성자 정보가 없고 댓글 섹션도 못찾았으면, 처음부터 프로필 찾기 (중간 댓글부터 붙여넣기 지원)
        if (!hasAuthorInfo && !foundCommentSection) {
            i = 0;
            while (i < lines.length) {
                const line = lines[i].trim();
                if (line === '프로필' || line.startsWith('프로필 ') || line.startsWith('프로필\t')) {
                    break;
                }
                i++;
            }
        }
        
        // 댓글 파싱
        while (i < lines.length) {
            const line = lines[i].trim();
            
            if (line === '프로필' || line.startsWith('프로필 ') || line.startsWith('프로필\t')) {
                let rawAuthor = '';
                let authorIsPost = false;
                
                // "프로필 작성자" 형태
                if (line.startsWith('프로필 ') || line.startsWith('프로필\t')) {
                    rawAuthor = line.replace(/^프로필[\s\t]+/, '').trim();
                } else {
                    // 다음 줄이 작성자
                    i++;
                    if (i >= lines.length) break;
                    rawAuthor = lines[i].trim();
                }
                
                // "작성자" 접미사 확인 및 제거
                if (isAuthorName(rawAuthor)) {
                    authorIsPost = true;
                }
                const author = normalizeAuthorName(rawAuthor);
                
                i++;
                
                // 날짜 및 내용 파싱
                let date = '';
                let content = [];
                let mention = null;
                let isReply = false;
                
                while (i < lines.length) {
                    const currentLine = lines[i].trim();
                    
                    // 다음 프로필이면 중단
                    if (currentLine === '프로필' || currentLine.startsWith('프로필 ') || currentLine.startsWith('프로필\t')) {
                        break;
                    }
                    
                    // 날짜 패턴
                    const dateMatch = currentLine.match(/^(\d{4}\.\d{2}\.\d{2}\.\s*\d{2}:\d{2})/);
                    if (dateMatch) {
                        date = dateMatch[1];
                        i++;
                        continue;
                    }
                    
                    // 스킵할 텍스트 (답글 포함)
                    if (currentLine === '삭제' || 
                        currentLine === '활동 정지' ||
                        currentLine === '활동정지' ||
                        currentLine === '삭제|활동 정지' ||
                        currentLine === '삭제|활동정지' ||
                        currentLine.match(/^답글삭제/) ||
                        currentLine.match(/^삭제\|/) ||
                        currentLine === '정지' ||
                        currentLine === '답글') {
                        if (currentLine === '답글') {
                            isReply = true;
                        }
                        i++;
                        continue;
                    }
                    
                    // 빈 줄
                    if (!currentLine) {
                        if (content.length > 0) content.push('');
                        i++;
                        continue;
                    }
                    
                    // 멘션 체크 (첫 줄에서 다른 작성자 이름)
                    if (content.length === 0) {
                        const normalizedLine = normalizeAuthorName(currentLine);
                        
                        // 이미 등록된 캐릭터 확인 (작성자 접미사 무시)
                        const existingChar = findCharacter(normalizedLine);
                        if (existingChar && !isSamePerson(currentLine, author)) {
                            mention = findCharacterKey(normalizedLine);
                            isReply = true;
                            i++;
                            continue;
                        }
                        
                        // 이미 파싱된 메시지의 작성자도 체크
                        const msgAuthors = messages.map(m => m.author);
                        const matchedAuthor = msgAuthors.find(a => isSamePerson(a, normalizedLine));
                        if (matchedAuthor && !isSamePerson(normalizedLine, author)) {
                            mention = matchedAuthor;
                            isReply = true;
                            i++;
                            continue;
                        }
                        
                        // 본문 작성자도 체크
                        if (postAuthor && isSamePerson(normalizedLine, postAuthor) && !isSamePerson(normalizedLine, author)) {
                            mention = postAuthor;
                            isReply = true;
                            i++;
                            continue;
                        }
                    }
                    
                    content.push(currentLine);
                    i++;
                }
                
                // 캐릭터 등록 (기존 캐릭터와 병합)
                if (author) {
                    const existingKey = findCharacterKey(author);
                    if (existingKey) {
                        // 기존 캐릭터가 있으면 작성자 여부만 업데이트
                        if (authorIsPost) {
                            characters[existingKey].isAuthor = true;
                        }
                    } else {
                        // 새 캐릭터 생성
                        characters[author] = {
                            displayName: author,
                            avatar: null,
                            color: defaultColors[Object.keys(characters).length % defaultColors.length],
                            useColor: false,
                            isMe: false,
                            isAuthor: authorIsPost,
                            hidden: false
                        };
                    }
                }
                
                // 메시지 추가 (작성자 키로 통일)
                if (author && content.length > 0) {
                    const charKey = findCharacterKey(author) || author;
                    const contentText = content.join('\n').trim();
                    // 썸네일이미지 감지 (대괄호 있든 없든)
                    const needsImage = contentText.includes('썸네일이미지') || contentText.includes('[이미지]') || contentText.includes('이미지') && contentText.trim().length < 20;
                    messages.push({
                        id: messages.length,
                        author: charKey,
                        date: date,
                        content: contentText,
                        mention: mention,
                        isReply: isReply || !!mention,
                        deleted: false,
                        needsImage: needsImage,
                        imageUrl: null
                    });
                }
            } else {
                i++;
            }
        }
        
        return messages;
    }
    
    // ===== RENDERER =====
    function formatContent(text, msgId, imageUrl) {
        // 이미지 플레이스홀더 처리 (대괄호 있든 없든)
        let processedText = text;
        const imagePattern = /\[?썸네일이미지\]?|\[이미지\]/g;
        if (imagePattern.test(processedText)) {
            if (imageUrl) {
                processedText = processedText.replace(/\[?썸네일이미지\]?|\[이미지\]/g, 
                    '<div class="rp-image-container"><img src="' + imageUrl + '" class="rp-image" alt=""></div>');
            } else {
                processedText = processedText.replace(/\[?썸네일이미지\]?|\[이미지\]/g, 
                    '<div class="rp-image-upload" data-msg-id="' + msgId + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span class="upload-text">이미지 업로드</span></div>');
            }
        }
        
        if (!settings.showActions) {
            return escapeHtml(processedText).replace(/\n/g, '<br>').replace(/&lt;div class="rp-image/g, '<div class="rp-image').replace(/&lt;\/div&gt;/g, '</div>').replace(/&lt;img src/g, '<img src').replace(/class="rp-image" alt=""&gt;/g, 'class="rp-image" alt="">').replace(/&lt;span class/g, '<span class').replace(/&lt;\/span&gt;/g, '</span>');
        }
        
        let result = '';
        let inAction = false;
        let buffer = '';
        
        for (let i = 0; i < processedText.length; i++) {
            const char = processedText[i];
            
            if (char === '(' && !inAction) {
                if (buffer) {
                    result += '<span class="rp-dialogue">' + escapeHtml(buffer) + '</span>';
                    buffer = '';
                }
                inAction = true;
                buffer = '(';
            } else if (char === ')' && inAction) {
                buffer += ')';
                result += '<span class="rp-action" style="color: ' + actionColor + '">' + escapeHtml(buffer) + '</span>';
                buffer = '';
                inAction = false;
            } else {
                buffer += char;
            }
        }
        
        if (buffer) {
            if (inAction) {
                result += '<span class="rp-action" style="color: ' + actionColor + '">' + escapeHtml(buffer) + '</span>';
            } else {
                result += '<span class="rp-dialogue">' + escapeHtml(buffer) + '</span>';
            }
        }
        
        // HTML 태그 복원
        result = result.replace(/&lt;div class="rp-image/g, '<div class="rp-image')
                       .replace(/&lt;\/div&gt;/g, '</div>')
                       .replace(/&lt;img src/g, '<img src')
                       .replace(/class="rp-image" alt=""&gt;/g, 'class="rp-image" alt="">')
                       .replace(/&lt;span class/g, '<span class')
                       .replace(/&lt;\/span&gt;/g, '</span>');
        
        return result.replace(/\n/g, '<br>');
    }
    
    function getAvatarHtml(author) {
        const char = characters[author];
        if (!char) return escapeHtml((author || '?').charAt(0));
        
        if (char.avatar) {
            return '<img src="' + char.avatar + '" alt="">';
        }
        return escapeHtml(char.displayName.charAt(0));
    }
    
    function getDisplayName(author) {
        const char = characters[author];
        return char ? char.displayName : author;
    }
    
    function getColor(author) {
        const char = characters[author];
        if (!char) return null;
        return char.useColor ? char.color : null;
    }
    
    function isMe(author) {
        const char = characters[author];
        return char ? char.isMe : false;
    }
    
    function isHidden(author) {
        const char = characters[author];
        return char ? char.hidden : false;
    }
    
    function shouldShowTimestamp(msg, idx, visibleMessages) {
        if (timestampMode === 'always') return true;
        if (timestampMode === 'hide') return false;
        
        // 'last' mode - show only for last message in a group by same author
        if (idx === visibleMessages.length - 1) return true;
        
        const nextMsg = visibleMessages[idx + 1];
        if (nextMsg.author !== msg.author) return true;
        
        // Check if date changed
        const msgDate = parseDate(msg.date);
        const nextDate = parseDate(nextMsg.date);
        if (msgDate !== nextDate) return true;
        
        return false;
    }
    
    function renderPreview() {
        const visibleMessages = parsedMessages.filter(m => !m.deleted && !isHidden(m.author));
        
        if (!mainPost && visibleMessages.length === 0) {
            previewContent.innerHTML = 
                '<div class="empty-state">' +
                '<div class="empty-state-icon">📝</div>' +
                '<div class="empty-state-text">왼쪽에 네이버 카페 댓글을 붙여넣으면<br>자동으로 RP 형식으로 변환됩니다</div>' +
                '</div>';
            previewContent.className = 'preview-content';
            return;
        }
        
        let skinClass = 'skin-' + currentSkin;
        if (skinTheme === 'light') {
            skinClass += ' skin-light';
        }
        
        // Add font classes
        previewContent.className = 'preview-content ' + skinClass + ' font-' + mainFont + ' action-font-' + actionFont + ' action-style-' + actionStyle;
        
        // 폰트 사이즈 CSS 변수 적용 (스킨별)
        const sizes = getFontSizes();
        previewContent.style.setProperty('--font-size-nick', sizes.nick + 'px');
        previewContent.style.setProperty('--font-size-content', sizes.content + 'px');
        previewContent.style.setProperty('--font-size-post', sizes.post + 'px');
        previewContent.style.setProperty('--line-height-content', lineHeightContent);
        previewContent.style.setProperty('--line-height-post', lineHeightPost);
        
        let html = '';
        
        // 본문
        if (mainPost && !isHidden(mainPost.author)) {
            html += renderMainPost();
        }
        
        // 댓글 헤더/섹션
        if ((currentSkin === 'default' || currentSkin === 'navercafe') && visibleMessages.length > 0) {
            if (currentSkin === 'navercafe') {
                html += '<div class="rp-comments-section">';
            } else {
                html += '<div class="rp-comments-header">댓글 <span>' + visibleMessages.length + '</span></div>';
            }
        }
        
        // 인물별 첫 댓글 추적 (자동 답글 처리용)
        const authorFirstComment = {};
        
        // 댓글
        let lastDate = null;
        visibleMessages.forEach((msg, idx) => {
            // 날짜 구분선
            if (settings.showDateDivider && msg.date) {
                const dateStr = parseDate(msg.date);
                if (dateStr && dateStr !== lastDate) {
                    html += '<div class="date-divider"><span>' + dateStr + '</span></div>';
                    lastDate = dateStr;
                }
            }
            
            // 인물별 첫 댓글인지 확인
            const isFirstForAuthor = !authorFirstComment[msg.author];
            if (isFirstForAuthor) {
                authorFirstComment[msg.author] = true;
            }
            
            // 작성자인지 확인
            const isAuthorPost = characters[msg.author] && characters[msg.author].isAuthor;
            
            // 대댓글 여부 결정:
            // - 수동 설정(manualReplySet)이 있으면 그대로
            // - 작성자 댓글은 무조건 대댓글
            // - 그 외: 첫 댓글이 아니면 대댓글
            let isReply = msg.isReply;
            if (!msg.hasOwnProperty('manualReplySet') && settings.showReplyIndent) {
                if (isAuthorPost) {
                    isReply = true;  // 작성자는 무조건 대댓글
                } else if (!isFirstForAuthor) {
                    isReply = true;  // 첫 댓글 아니면 대댓글
                }
            }
            
            // 마지막 댓글인지 확인
            const isLast = idx === visibleMessages.length - 1;
            
            const showTime = shouldShowTimestamp(msg, idx, visibleMessages);
            html += renderMessage(msg, isReply, showTime, isLast);
        });
        
        if (currentSkin === 'navercafe' && visibleMessages.length > 0) {
            html += '</div>';
        }
        
        previewContent.innerHTML = html;
        
        // 내용 수정 이벤트 바인딩
        previewContent.querySelectorAll('.rp-content-text').forEach(el => {
            el.addEventListener('blur', function() {
                const id = parseInt(this.closest('.rp-post, .rp-main-post').dataset.id);
                const newContent = this.innerText;
                
                saveState();
                
                if (id === -1 && mainPost) {
                    mainPost.content = newContent;
                } else {
                    const msg = parsedMessages.find(m => m.id === id);
                    if (msg) msg.content = newContent;
                }
            });
        });
        
        // 이미지 업로드 이벤트
        previewContent.querySelectorAll('.rp-image-upload').forEach(el => {
            el.addEventListener('click', function() {
                const msgId = parseInt(this.dataset.msgId);
                uploadImageForMessage(msgId);
            });
        });
        
        // 이미지 탭 업데이트
        updateImagesTab();
    }
    
    function uploadImageForMessage(msgId) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = function() {
            const file = this.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                const msg = parsedMessages.find(m => m.id === msgId);
                if (msg) {
                    msg.imageUrl = e.target.result;
                    renderPreview();
                }
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }
    
    function updateImagesTab() {
        const tabImages = document.getElementById('tabImages');
        const imageList = document.getElementById('imageList');
        
        // 이미지가 필요한 메시지 찾기
        const imageMessages = parsedMessages.filter(m => m.needsImage);
        
        if (imageMessages.length === 0) {
            if (tabImages) tabImages.style.display = 'none';
            if (imageList) imageList.innerHTML = '<div class="empty-state">이미지가 없습니다</div>';
            return;
        }
        
        if (tabImages) tabImages.style.display = 'inline-block';
        
        if (imageList) {
            let html = '';
            imageMessages.forEach(msg => {
                const char = characters[msg.author];
                const hasImage = !!msg.imageUrl;
                html += '<div class="image-item ' + (hasImage ? 'has-image' : '') + '" data-msg-id="' + msg.id + '">';
                html += '<div class="image-item-preview">';
                if (hasImage) {
                    html += '<img src="' + msg.imageUrl + '" alt="">';
                } else {
                    html += '🖼';
                }
                html += '</div>';
                html += '<div class="image-item-info">';
                html += '<div class="image-item-author">' + escapeHtml(getDisplayName(msg.author)) + '</div>';
                html += '<div class="image-item-text">' + escapeHtml(msg.content.substring(0, 30)) + '...</div>';
                html += '</div>';
                html += '<button class="btn image-upload-btn" data-msg-id="' + msg.id + '">' + (hasImage ? '변경' : '업로드') + '</button>';
                html += '</div>';
            });
            imageList.innerHTML = html;
            
            // 업로드 버튼 이벤트
            imageList.querySelectorAll('.image-upload-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const msgId = parseInt(this.dataset.msgId);
                    uploadImageForMessage(msgId);
                });
            });
        }
    }
    
    function renderMainPost() {
        const author = mainPost.author;
        const char = characters[author];
        const color = getColor(author);
        const colorStyle = color ? ' style="color: ' + color + '"' : '';
        const avatarColorStyle = color ? ' style="color: ' + color + '; border-color: ' + color + '"' : '';
        
        let html = '<div class="rp-main-post" data-id="-1">';
        html += '<div class="rp-main-header">';
        html += '<div class="rp-main-avatar"' + avatarColorStyle + '>' + getAvatarHtml(author) + '</div>';
        html += '<div class="rp-main-info">';
        html += '<div class="rp-main-author"' + colorStyle + '>' + escapeHtml(getDisplayName(author));
        if (currentSkin !== 'navercafe') {
            html += ' <span class="rp-author-badge">작성자</span>';
        }
        html += '</div>';
        html += '<div class="rp-main-date">' + (mainPost.date || '') + '</div>';
        html += '</div></div>';
        html += '<div class="rp-main-content"><div class="rp-content-text" contenteditable="true">' + formatContent(mainPost.content, -1, mainPost.imageUrl) + '</div></div>';
        html += '</div>';
        
        return html;
    }
    
    function renderMessage(msg, isReply, showTime, isLast) {
        const meClass = isMe(msg.author) ? 'is-me' : '';
        const replyClass = isReply ? 'rp-reply' : '';
        const color = getColor(msg.author);
        const colorStyle = color ? ' style="color: ' + color + '"' : '';
        const avatarColorStyle = color ? ' style="color: ' + color + '; border-color: ' + color + '"' : '';
        const isAuthor = characters[msg.author] && characters[msg.author].isAuthor;
        
        let mentionHtml = '';
        if (msg.mention) {
            mentionHtml = '<span class="rp-mention">@' + escapeHtml(getDisplayName(msg.mention)) + '</span> ';
        }
        
        // 답글/댓글 전환 버튼 텍스트
        const toggleText = msg.isReply ? '>댓글로' : '대댓글로<';
        
        let html = '<div class="rp-post ' + meClass + ' ' + replyClass + '" data-id="' + msg.id + '">';
        
        if (currentSkin === 'navercafe') {
            // 네이버카페형 레이아웃
            html += '<div class="rp-post-main">';
            html += '<div class="rp-header">';
            html += '<div class="rp-avatar"' + avatarColorStyle + '>' + getAvatarHtml(msg.author) + '</div>';
            html += '<span class="rp-author"' + colorStyle + '>' + escapeHtml(getDisplayName(msg.author)) + '</span>';
            if (isAuthor) {
                html += '<span class="rp-author-badge">작성자</span>';
            }
            if (showTime && msg.date) {
                html += '<span class="rp-date">' + msg.date + '</span>';
            }
            html += '</div>';
            html += '<div class="rp-body">';
            html += '<div class="rp-content">';
            html += '<div class="rp-content-text" contenteditable="true">' + mentionHtml + formatContent(msg.content, msg.id, msg.imageUrl) + '</div>';
            html += '<div class="rp-controls">';
            html += '<button class="rp-ctrl-btn delete-btn" data-id="' + msg.id + '">삭제</button>';
            html += '<button class="rp-ctrl-btn toggle-reply-btn" data-id="' + msg.id + '">' + toggleText + '</button>';
            html += '</div>';
            html += '</div>';
            html += '</div></div></div>';
        } else {
            // 채팅형/기본형 레이아웃
            html += '<div class="rp-post-main">';
            html += '<div class="rp-avatar"' + avatarColorStyle + '>' + getAvatarHtml(msg.author) + '</div>';
            html += '<div class="rp-body">';
            html += '<div class="rp-header">';
            html += '<span class="rp-author"' + colorStyle + '>' + escapeHtml(getDisplayName(msg.author)) + '</span>';
            if (isAuthor) {
                html += '<span class="rp-author-badge">작성자</span>';
            }
            if (showTime && msg.date) {
                html += '<span class="rp-date">' + msg.date + '</span>';
            }
            html += '</div>';
            html += '<div class="rp-content">';
            html += '<div class="rp-content-text" contenteditable="true">' + mentionHtml + formatContent(msg.content, msg.id, msg.imageUrl) + '</div>';
            html += '<div class="rp-controls">';
            html += '<button class="rp-ctrl-btn delete-btn" data-id="' + msg.id + '">삭제</button>';
            html += '<button class="rp-ctrl-btn toggle-reply-btn" data-id="' + msg.id + '">' + toggleText + '</button>';
            html += '</div>';
            html += '</div>';
            html += '</div></div></div>';
        }
        
        return html;
    }
    
    function renderCharacterList() {
        const authors = Object.keys(characters);
        
        if (authors.length === 0) {
            characterList.innerHTML = 
                '<div class="empty-state">' +
                '<div class="empty-state-text">댓글을 붙여넣으면<br>인물 목록이 여기에 표시됩니다</div>' +
                '</div>';
            return;
        }
        
        let html = '';
        authors.forEach(author => {
            const char = characters[author];
            const avatarContent = char.avatar 
                ? '<img src="' + char.avatar + '" alt="">' 
                : escapeHtml(char.displayName.charAt(0));
            
            const avatarColor = char.useColor ? char.color : 'var(--accent-light)';
            const avatarBorderColor = char.useColor ? char.color : 'var(--border)';
            
            let itemClass = 'character-item';
            if (char.isMe) itemClass += ' is-me';
            if (char.isAuthor) itemClass += ' is-author';
            if (char.hidden) itemClass += ' hidden-char';
            
            html += '<div class="' + itemClass + '" data-author="' + escapeHtml(author) + '">';
            html += '<div class="char-avatar" data-author="' + escapeHtml(author) + '" style="color: ' + avatarColor + '; border-color: ' + avatarBorderColor + '" title="프로필 사진 삽입">' + avatarContent + '</div>';
            html += '<div class="char-info">';
            html += '<div class="char-name-row">';
            html += '<input type="text" class="char-name-input" value="' + escapeHtml(char.displayName) + '" data-author="' + escapeHtml(author) + '">';
            if (char.isAuthor) html += '<span class="char-badge">작성자</span>';
            html += '</div>';
            if (author !== char.displayName) html += '<div class="char-original">원본: ' + escapeHtml(author) + '</div>';
            html += '</div>';
            html += '<div class="char-controls">';
            html += '<input type="color" class="char-color-picker" value="' + char.color + '" data-author="' + escapeHtml(author) + '" title="색상 선택">';
            html += '<button class="char-btn ' + (char.useColor ? 'active' : '') + '" data-action="color" data-author="' + escapeHtml(author) + '" title="색상 적용">색</button>';
            html += '<button class="char-btn hide-btn ' + (char.hidden ? 'active' : '') + '" data-action="hide" data-author="' + escapeHtml(author) + '">숨김</button>';
            html += '</div>';
            html += '</div>';
        });
        
        characterList.innerHTML = html;
    }
    
    // ===== EVENT HANDLERS =====
    
    // Input change - 자동 파싱 (150ms 딜레이)
    let inputTimeout;
    inputArea.addEventListener('input', function() {
        clearTimeout(inputTimeout);
        inputTimeout = setTimeout(() => {
            const text = this.value.trim();
            
            if (!text) {
                saveState();
                parsedMessages = [];
                mainPost = null;
                characters = {};
                renderCharacterList();
                renderPreview();
                return;
            }
            
            saveState();
            
            const oldCharacters = JSON.parse(JSON.stringify(characters));
            characters = {};
            
            parsedMessages = parseNaverCafe(text);
            
            Object.keys(characters).forEach(author => {
                if (oldCharacters[author]) {
                    characters[author] = { ...characters[author], ...oldCharacters[author] };
                    if (characters[author]) {
                        characters[author].isAuthor = (mainPost && mainPost.author === author);
                    }
                }
            });
            
            renderCharacterList();
            renderPreview();
        }, 150);
    });
    
    // Character list events
    characterList.addEventListener('click', function(e) {
        const avatar = e.target.closest('.char-avatar');
        if (avatar) {
            currentAvatarTarget = avatar.dataset.author;
            avatarInput.click();
            return;
        }
        
        const btn = e.target.closest('.char-btn');
        if (btn) {
            const author = btn.dataset.author;
            const action = btn.dataset.action;
            
            saveState();
            
            if (action === 'me') {
                const wasMe = characters[author].isMe;
                Object.keys(characters).forEach(a => characters[a].isMe = false);
                if (!wasMe) characters[author].isMe = true;
            } else if (action === 'hide') {
                characters[author].hidden = !characters[author].hidden;
            } else if (action === 'color') {
                characters[author].useColor = !characters[author].useColor;
            }
            
            renderCharacterList();
            renderPreview();
        }
    });
    
    characterList.addEventListener('change', function(e) {
        if (e.target.classList.contains('char-name-input')) {
            const author = e.target.dataset.author;
            saveState();
            characters[author].displayName = e.target.value || author;
            renderPreview();
        }
        
        if (e.target.classList.contains('char-color-picker')) {
            const author = e.target.dataset.author;
            saveState();
            characters[author].color = e.target.value;
            renderCharacterList();
            renderPreview();
        }
    });
    
    // Avatar file input
    avatarInput.addEventListener('change', function(e) {
        if (!currentAvatarTarget || !e.target.files || !e.target.files[0]) return;
        
        saveState();
        
        const reader = new FileReader();
        reader.onload = function(event) {
            characters[currentAvatarTarget].avatar = event.target.result;
            renderCharacterList();
            renderPreview();
        };
        reader.readAsDataURL(e.target.files[0]);
        e.target.value = '';
    });
    
    // Delete button in preview
    previewContent.addEventListener('click', function(e) {
        const deleteBtn = e.target.closest('.delete-btn');
        if (deleteBtn) {
            saveState();
            const id = parseInt(deleteBtn.dataset.id);
            const msg = parsedMessages.find(m => m.id === id);
            if (msg) {
                msg.deleted = true;
                renderPreview();
            }
        }
        
        // 답글/댓글 전환 버튼
        const toggleReplyBtn = e.target.closest('.toggle-reply-btn');
        if (toggleReplyBtn) {
            saveState();
            const id = parseInt(toggleReplyBtn.dataset.id);
            const msg = parsedMessages.find(m => m.id === id);
            if (msg) {
                msg.isReply = !msg.isReply;
                msg.manualReplySet = true; // 수동 설정 플래그
                renderPreview();
            }
        }
    });
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('tab-' + this.dataset.tab).classList.add('active');
        });
    });
    
    // Skin selector
    document.querySelectorAll('.skin-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.skin-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentSkin = this.dataset.skin;
            updateFontSizeUI();
            renderPreview();
        });
    });
    
    // Skin theme selector
    document.querySelectorAll('.skin-theme-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.skin-theme-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            skinTheme = this.dataset.skinTheme;
            renderPreview();
        });
    });
    
    // Font selectors
    document.getElementById('mainFontSelect').addEventListener('change', function() {
        mainFont = this.value;
        renderPreview();
    });
    
    document.getElementById('actionFontSelect').addEventListener('change', function() {
        actionFont = this.value;
        renderPreview();
    });
    
    // Timestamp selector
    document.getElementById('timestampSelect').addEventListener('change', function() {
        timestampMode = this.value;
        renderPreview();
    });
    
    // 폰트 사이즈 슬라이더 + 입력 필드
    const fontSizeAllSlider = document.getElementById('fontSizeAll');
    const fontSizeAllInput = document.getElementById('fontSizeAllInput');
    const fontSizeNickSlider = document.getElementById('fontSizeNick');
    const fontSizeContentSlider = document.getElementById('fontSizeContent');
    const fontSizePostSlider = document.getElementById('fontSizePost');
    const fontSizeNickInput = document.getElementById('fontSizeNickInput');
    const fontSizeContentInput = document.getElementById('fontSizeContentInput');
    const fontSizePostInput = document.getElementById('fontSizePostInput');
    
    // 줄간격 슬라이더 + 입력 필드
    const lineHeightContentSlider = document.getElementById('lineHeightContent');
    const lineHeightContentInput = document.getElementById('lineHeightContentInput');
    const lineHeightPostSlider = document.getElementById('lineHeightPost');
    const lineHeightPostInput = document.getElementById('lineHeightPostInput');
    
    function updateFontSizeUI() {
        const sizes = getFontSizes();
        if (fontSizeNickSlider) fontSizeNickSlider.value = sizes.nick;
        if (fontSizeNickInput) fontSizeNickInput.value = sizes.nick;
        if (fontSizeContentSlider) fontSizeContentSlider.value = sizes.content;
        if (fontSizeContentInput) fontSizeContentInput.value = sizes.content;
        if (fontSizePostSlider) fontSizePostSlider.value = sizes.post;
        if (fontSizePostInput) fontSizePostInput.value = sizes.post;
        if (lineHeightContentSlider) lineHeightContentSlider.value = lineHeightContent;
        if (lineHeightContentInput) lineHeightContentInput.value = lineHeightContent;
        if (lineHeightPostSlider) lineHeightPostSlider.value = lineHeightPost;
        if (lineHeightPostInput) lineHeightPostInput.value = lineHeightPost;
    }
    
    // 폰트 사이즈 - 닉네임
    if (fontSizeNickSlider) {
        fontSizeNickSlider.addEventListener('input', function() {
            const v = parseInt(this.value);
            fontSizesBySkin[currentSkin].nick = v;
            if (fontSizeNickInput) fontSizeNickInput.value = v;
            renderPreview();
        });
    }
    if (fontSizeNickInput) {
        fontSizeNickInput.addEventListener('input', function() {
            const v = parseInt(this.value) || 13;
            fontSizesBySkin[currentSkin].nick = v;
            if (fontSizeNickSlider) fontSizeNickSlider.value = v;
            renderPreview();
        });
    }
    
    // 폰트 사이즈 - 댓글
    if (fontSizeContentSlider) {
        fontSizeContentSlider.addEventListener('input', function() {
            const v = parseInt(this.value);
            fontSizesBySkin[currentSkin].content = v;
            if (fontSizeContentInput) fontSizeContentInput.value = v;
            renderPreview();
        });
    }
    if (fontSizeContentInput) {
        fontSizeContentInput.addEventListener('input', function() {
            const v = parseInt(this.value) || 13;
            fontSizesBySkin[currentSkin].content = v;
            if (fontSizeContentSlider) fontSizeContentSlider.value = v;
            renderPreview();
        });
    }
    
    // 폰트 사이즈 - 본문
    if (fontSizePostSlider) {
        fontSizePostSlider.addEventListener('input', function() {
            const v = parseInt(this.value);
            fontSizesBySkin[currentSkin].post = v;
            if (fontSizePostInput) fontSizePostInput.value = v;
            renderPreview();
        });
    }
    if (fontSizePostInput) {
        fontSizePostInput.addEventListener('input', function() {
            const v = parseInt(this.value) || 14;
            fontSizesBySkin[currentSkin].post = v;
            if (fontSizePostSlider) fontSizePostSlider.value = v;
            renderPreview();
        });
    }
    
    // 줄간격 - 댓글
    if (lineHeightContentSlider) {
        lineHeightContentSlider.addEventListener('input', function() {
            lineHeightContent = parseFloat(this.value);
            if (lineHeightContentInput) lineHeightContentInput.value = lineHeightContent;
            renderPreview();
        });
    }
    if (lineHeightContentInput) {
        lineHeightContentInput.addEventListener('input', function() {
            lineHeightContent = parseFloat(this.value) || 1.6;
            if (lineHeightContentSlider) lineHeightContentSlider.value = lineHeightContent;
            renderPreview();
        });
    }
    
    // 줄간격 - 본문
    if (lineHeightPostSlider) {
        lineHeightPostSlider.addEventListener('input', function() {
            lineHeightPost = parseFloat(this.value);
            if (lineHeightPostInput) lineHeightPostInput.value = lineHeightPost;
            renderPreview();
        });
    }
    if (lineHeightPostInput) {
        lineHeightPostInput.addEventListener('input', function() {
            lineHeightPost = parseFloat(this.value) || 1.8;
            if (lineHeightPostSlider) lineHeightPostSlider.value = lineHeightPost;
            renderPreview();
        });
    }
    
    // 전체 폰트 크기 연동
    if (fontSizeAllSlider) {
        fontSizeAllSlider.addEventListener('input', function() {
            const v = parseInt(this.value);
            if (fontSizeAllInput) fontSizeAllInput.value = v;
            fontSizesBySkin[currentSkin].nick = v;
            fontSizesBySkin[currentSkin].content = v;
            fontSizesBySkin[currentSkin].post = v + 1;
            if (fontSizeNickSlider) fontSizeNickSlider.value = v;
            if (fontSizeNickInput) fontSizeNickInput.value = v;
            if (fontSizeContentSlider) fontSizeContentSlider.value = v;
            if (fontSizeContentInput) fontSizeContentInput.value = v;
            if (fontSizePostSlider) fontSizePostSlider.value = v + 1;
            if (fontSizePostInput) fontSizePostInput.value = v + 1;
            renderPreview();
        });
    }
    if (fontSizeAllInput) {
        fontSizeAllInput.addEventListener('input', function() {
            const v = parseInt(this.value) || 13;
            if (fontSizeAllSlider) fontSizeAllSlider.value = v;
            fontSizeAllSlider.dispatchEvent(new Event('input'));
        });
    }
    
    // 행동묘사 스타일
    const actionStyleSelect = document.getElementById('actionStyleSelect');
    if (actionStyleSelect) {
        actionStyleSelect.addEventListener('change', function() {
            actionStyle = this.value;
            renderPreview();
        });
    }
    
    // Settings toggles
    document.querySelectorAll('.toggle-switch').forEach(toggle => {
        toggle.addEventListener('click', function() {
            const setting = this.dataset.setting;
            settings[setting] = !settings[setting];
            this.classList.toggle('active', settings[setting]);
            
            // 행동묘사 강조 체크 시 설정 그룹 표시/숨김
            if (setting === 'showActions') {
                const actionGroup = document.getElementById('actionSettingsGroup');
                if (actionGroup) {
                    actionGroup.style.display = settings[setting] ? 'block' : 'none';
                }
            }
            
            renderPreview();
        });
    });
    
    // 행동묘사 색상 설정
    const actionColorPicker = document.getElementById('actionColorPicker');
    if (actionColorPicker) {
        actionColorPicker.addEventListener('input', function() {
            actionColor = this.value;
            renderPreview();
        });
    }
    
    const resetActionColor = document.getElementById('resetActionColor');
    if (resetActionColor) {
        resetActionColor.addEventListener('click', function() {
            actionColor = '#ACACAC';
            actionStyle = 'normal';
            actionFont = 'default';
            if (actionColorPicker) actionColorPicker.value = actionColor;
            if (actionStyleSelect) actionStyleSelect.value = actionStyle;
            document.getElementById('actionFontSelect').value = actionFont;
            renderPreview();
        });
    }
    
    // 전체 초기화 버튼
    const resetAllBtn = document.getElementById('resetAllSettings');
    if (resetAllBtn) {
        resetAllBtn.addEventListener('click', function() {
            // 폰트 초기화
            mainFont = 'default';
            actionFont = 'default';
            actionStyle = 'normal';
            document.getElementById('mainFontSelect').value = 'default';
            document.getElementById('actionFontSelect').value = 'default';
            if (actionStyleSelect) actionStyleSelect.value = 'normal';
            
            // 폰트 사이즈 초기화
            fontSizesBySkin[currentSkin] = { nick: 13, content: 13, post: 14 };
            
            // 줄간격 초기화
            lineHeightContent = 1.6;
            lineHeightPost = 1.8;
            updateFontSizeUI();
            
            // 시간표시 초기화
            timestampMode = 'always';
            document.getElementById('timestampSelect').value = 'always';
            
            // 스킨 테마 초기화
            skinTheme = 'light';
            document.querySelectorAll('.skin-theme-btn').forEach(b => b.classList.remove('active'));
            const lightBtn = document.querySelector('.skin-theme-btn[data-skin-theme="light"]');
            if (lightBtn) lightBtn.classList.add('active');
            
            // 행동묘사 색상 초기화
            actionColor = '#ACACAC';
            if (actionColorPicker) actionColorPicker.value = actionColor;
            
            // 표시 옵션 초기화
            settings.showActions = false;
            settings.showDateDivider = false;
            settings.showReplyIndent = true;
            
            document.querySelectorAll('.toggle-switch').forEach(t => {
                const s = t.dataset.setting;
                t.classList.toggle('active', settings[s]);
            });
            
            // 행동묘사 설정 그룹 숨김
            const actionGroup = document.getElementById('actionSettingsGroup');
            if (actionGroup) actionGroup.style.display = 'none';
            
            renderPreview();
            showToast('설정이 초기화되었습니다.');
        });
    }
    
    // Platform buttons
    document.querySelectorAll('.platform-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    // Undo/Redo buttons
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    
    // Help modal
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
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Escape to close modal
        if (e.key === 'Escape') {
            helpModal.classList.remove('show');
            return;
        }
        
        // Don't trigger shortcuts when typing in input fields
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.isContentEditable) {
            // But allow Ctrl+Z/Y in input fields for native undo
            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
                if (e.shiftKey) {
                    e.preventDefault();
                    redo();
                }
                // Let native undo work for input
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
                // Let native redo work
                return;
            }
            return;
        }
        
        // Ctrl+Z = Undo
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            undo();
            return;
        }
        
        // Ctrl+Shift+Z or Ctrl+Y = Redo
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            redo();
            return;
        }
        
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            redo();
            return;
        }
    });
    
    // Reset all
    document.getElementById('resetAll').addEventListener('click', function() {
        if (confirm('모든 입력, 인물 설정, 삭제 내역을 초기화하시겠습니까?')) {
            saveState();
            inputArea.value = '';
            characters = {};
            mainPost = null;
            parsedMessages = [];
            renderCharacterList();
            renderPreview();
            showToast('전체 초기화 완료');
        }
    });
    
    // Resizer
    const resizer = document.getElementById('resizer');
    const leftPanel = document.getElementById('leftPanel');
    let isResizing = false;
    
    resizer.addEventListener('mousedown', () => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', e => {
        if (!isResizing) return;
        const containerRect = document.getElementById('mainContainer').getBoundingClientRect();
        const newWidth = Math.min(Math.max(280, e.clientX - containerRect.left), containerRect.width * 0.6);
        leftPanel.style.width = newWidth + 'px';
        leftPanel.style.minWidth = newWidth + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
    
    // ===== EXPORT =====
    
    // Copy HTML
    document.getElementById('copyHtml').addEventListener('click', function() {
        const content = previewContent.innerHTML;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        // 모든 컨트롤 버튼 제거
        tempDiv.querySelectorAll('.rp-controls, .delete-btn, .toggle-reply-btn, .rp-ctrl-btn, .msg-controls').forEach(el => el.remove());
        tempDiv.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
        
        const cleanHtml = tempDiv.innerHTML;
        
        navigator.clipboard.writeText(cleanHtml).then(() => {
            showToast('HTML이 클립보드에 복사되었습니다');
        }).catch(() => {
            showToast('복사 실패');
        });
    });
    
    // Export HTML
    document.getElementById('exportHtml').addEventListener('click', function() {
        const content = previewContent.innerHTML;
        let skinClass = 'skin-' + currentSkin;
        if (skinTheme === 'light') skinClass += ' skin-light';
        skinClass += ' font-' + mainFont + ' action-font-' + actionFont + ' action-style-' + actionStyle;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        // 모든 컨트롤 버튼들 완전 제거
        tempDiv.querySelectorAll('.rp-controls, .delete-btn, .toggle-reply-btn, .rp-ctrl-btn, .msg-controls, button').forEach(el => el.remove());
        tempDiv.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
        
        // 스타일 수집 (hover 제외, 버튼 관련 스타일도 제외)
        let styles = '';
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    if (rule.cssText && !rule.cssText.includes(':hover') && !rule.cssText.includes('.rp-controls') && !rule.cssText.includes('.rp-ctrl-btn')) {
                        styles += rule.cssText + '\n';
                    }
                }
            } catch(e) {}
        }
        
        const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>RP 백업</title>' +
            '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Nanum+Myeongjo:wght@400;700&family=Nanum+Gothic:wght@400;700&family=Gothic+A1:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;700&display=swap" rel="stylesheet">' +
            '<style>' + styles + '</style></head>' +
            '<body>' +
            '<div class="preview-content ' + skinClass + '" style="max-width:750px;margin:20px auto;padding:20px;">' + 
            tempDiv.innerHTML + '</div></body></html>';
        
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rp-backup.html';
        a.click();
        URL.revokeObjectURL(url);
    });
    
    // Export Image
    function exportImage(format) {
        previewContent.querySelectorAll('.rp-controls').forEach(el => el.style.display = 'none');
        
        const script = document.createElement('script');
        script.src = './vendor/html2canvas.min.js'; // AFTERLOG: CDN 대신 앱에 번들된 파일
        script.onload = function() {
            let bgColor;
            if (currentSkin === 'navercafe') {
                bgColor = skinTheme === 'light' ? '#ffffff' : '#070707';
            } else if (currentSkin === 'default') {
                bgColor = skinTheme === 'light' ? '#ffffff' : '#1a1a1f';
            } else {
                bgColor = skinTheme === 'light' ? '#f5f5f5' : '#1a1a1f';
            }
            
            html2canvas(previewContent, {
                backgroundColor: bgColor,
                scale: 3,
                useCORS: true,
                logging: false
            }).then(canvas => {
                previewContent.querySelectorAll('.rp-controls').forEach(el => el.style.display = '');
                
                const maxHeight = 3000 * 3;
                
                if (canvas.height <= maxHeight) {
                    const link = document.createElement('a');
                    link.download = 'rp-backup.' + format;
                    link.href = canvas.toDataURL('image/' + (format === 'jpg' ? 'jpeg' : 'png'), 1.0);
                    link.click();
                } else {
                    const numParts = Math.ceil(canvas.height / maxHeight);
                    
                    for (let i = 0; i < numParts; i++) {
                        const partCanvas = document.createElement('canvas');
                        partCanvas.width = canvas.width;
                        partCanvas.height = Math.min(maxHeight, canvas.height - i * maxHeight);
                        
                        const ctx = partCanvas.getContext('2d');
                        ctx.drawImage(canvas, 0, -i * maxHeight);
                        
                        setTimeout(() => {
                            const link = document.createElement('a');
                            link.download = 'rp-backup-' + (i + 1) + '.' + format;
                            link.href = partCanvas.toDataURL('image/' + (format === 'jpg' ? 'jpeg' : 'png'), 1.0);
                            link.click();
                        }, i * 500);
                    }
                }
            });
        };
        
        if (typeof html2canvas === 'undefined') {
            document.head.appendChild(script);
        } else {
            script.onload();
        }
    }
    
    document.getElementById('exportPng').addEventListener('click', () => exportImage('png'));
    document.getElementById('exportJpg').addEventListener('click', () => exportImage('jpg'));
    

    // ===== AFTERLOG: 연결 등록 =====
    function cleanPreviewHtml(dropButtons) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = previewContent.innerHTML;
        tempDiv.querySelectorAll('.rp-controls, .delete-btn, .toggle-reply-btn, .rp-ctrl-btn, .msg-controls' + (dropButtons ? ', button' : '')).forEach(el => el.remove());
        tempDiv.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
        return tempDiv.innerHTML;
    }
    function skinClassName() {
        let skinClass = 'skin-' + currentSkin;
        if (skinTheme === 'light') skinClass += ' skin-light';
        return skinClass + ' font-' + mainFont + ' action-font-' + actionFont + ' action-style-' + actionStyle;
    }
    function syncControls() {
        document.querySelectorAll('.skin-btn').forEach(b => b.classList.toggle('active', b.dataset.skin === currentSkin));
        document.querySelectorAll('.skin-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.skinTheme === skinTheme));
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('mainFontSelect', mainFont);
        set('actionFontSelect', actionFont);
        set('actionStyleSelect', actionStyle);
        set('actionColorPicker', actionColor);
        set('timestampSelect', timestampMode);
        document.querySelectorAll('.toggle-switch').forEach(t => {
            const k = t.dataset.setting;
            if (k in settings) t.classList.toggle('active', !!settings[k]);
        });
        const actionGroup = document.getElementById('actionSettingsGroup');
        if (actionGroup) actionGroup.style.display = settings.showActions ? '' : 'none';
        updateFontSizeUI();
    }
    const CAFE_DEFAULTS = JSON.parse(JSON.stringify({ currentSkin, skinTheme, mainFont, actionFont, actionColor, actionStyle, timestampMode, fontSizesBySkin, lineHeightContent, lineHeightPost, settings }));
    window.__rpbaModule = {
        stateVersion: 1,
        fileBase: 'navercafe',
        capabilities: { undo: true, export: ['html', 'png', 'copy'], importText: true },
        watchRoot: () => document.getElementById('mainContainer'),
        snapshot() {
            return JSON.parse(JSON.stringify({
                text: inputArea.value,
                characters, mainPost, parsedMessages,
                currentSkin, skinTheme, mainFont, actionFont, actionColor, actionStyle, timestampMode,
                fontSizesBySkin, lineHeightContent, lineHeightPost, settings
            }));
        },
        load(st) {
            const s = st || CAFE_DEFAULTS;
            inputArea.value = st ? (st.text || '') : '';
            characters = st && st.characters ? st.characters : {};
            mainPost = st ? (st.mainPost || null) : null;
            parsedMessages = st && Array.isArray(st.parsedMessages) ? st.parsedMessages : [];
            currentSkin = s.currentSkin || CAFE_DEFAULTS.currentSkin;
            skinTheme = s.skinTheme || CAFE_DEFAULTS.skinTheme;
            mainFont = s.mainFont || CAFE_DEFAULTS.mainFont;
            actionFont = s.actionFont || CAFE_DEFAULTS.actionFont;
            actionColor = s.actionColor || CAFE_DEFAULTS.actionColor;
            actionStyle = s.actionStyle || CAFE_DEFAULTS.actionStyle;
            timestampMode = s.timestampMode || CAFE_DEFAULTS.timestampMode;
            for (const k of Object.keys(fontSizesBySkin)) Object.assign(fontSizesBySkin[k], CAFE_DEFAULTS.fontSizesBySkin[k], (s.fontSizesBySkin || {})[k] || {});
            lineHeightContent = s.lineHeightContent || CAFE_DEFAULTS.lineHeightContent;
            lineHeightPost = s.lineHeightPost || CAFE_DEFAULTS.lineHeightPost;
            Object.assign(settings, CAFE_DEFAULTS.settings, s.settings || {});
            undoStack = [];
            redoStack = [];
            updateUndoRedoButtons();
            syncControls();
            renderCharacterList();
            renderPreview();
        },
        undo: () => undo(),
        redo: () => redo(),
        importText(t) {
            inputArea.value = t;
            inputArea.dispatchEvent(new Event('input'));
        },
        exportHtml() {
            return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>RP 백업 · 네이버 카페</title>' +
                '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Nanum+Myeongjo:wght@400;700&family=Nanum+Gothic:wght@400;700&family=Gothic+A1:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;700&display=swap" rel="stylesheet">' +
                '<style>' + collectStyles() + '</style></head><body>' +
                '<div class="preview-content ' + skinClassName() + '" style="max-width:750px;margin:20px auto;padding:20px;">' + cleanPreviewHtml(true) + '</div></body></html>';
        },
        copyHtml: () => cleanPreviewHtml(false),
        pngTarget() {
            previewContent.querySelectorAll('.rp-controls').forEach(el => el.style.display = 'none');
            let bg;
            if (currentSkin === 'navercafe') bg = skinTheme === 'light' ? '#ffffff' : '#070707';
            else if (currentSkin === 'default') bg = skinTheme === 'light' ? '#ffffff' : '#1a1a1f';
            else bg = skinTheme === 'light' ? '#f5f5f5' : '#1a1a1f';
            return { el: previewContent, bg, cleanup: () => previewContent.querySelectorAll('.rp-controls').forEach(el => el.style.display = '') };
        }
    };
    function collectStyles() {
        let styles = '';
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    if (rule.cssText && !rule.cssText.includes(':hover') && !rule.cssText.includes('.rp-controls') && !rule.cssText.includes('.rp-ctrl-btn')) styles += rule.cssText + '\n';
                }
            } catch (e) { /* 다른 출처 스타일(글꼴)은 읽을 수 없어 건너뜀 */ }
        }
        return styles;
    }
})();
