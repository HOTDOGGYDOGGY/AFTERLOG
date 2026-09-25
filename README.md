# AFTERLOG · 애프터로그

**바로 쓰기:** https://hotdoggydoggy.github.io/AFTERLOG/

역극(RP) 기록을 원문과 함께 보관하고, 인물·이미지·표시 형식을 고쳐 다시 보거나 파일로 내보내는 도구.
지금은 **밴드 게시글+댓글**을 지원합니다. 지원 범위는 [docs/support.md](docs/support.md)를 보세요.

자료는 브라우저 안(IndexedDB)에만 저장되고 어디로도 전송되지 않습니다. 브라우저 데이터는 지워질 수 있으니 **프로젝트 저장(.afterlog)** 으로 복구 파일을 꼭 받아 두세요.

## 실행

Node.js 20.19 이상이 필요합니다.

```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # dist/ 에 정적 사이트 생성 (아무 정적 호스팅에나 올리면 됨)
```

## 배포 (GitHub Pages)

`.github/workflows/deploy.yml`이 main 브랜치에 변경이 올라올 때마다 테스트 → 빌드 → Pages 배포를 합니다(Actions 탭에서 수동 실행도 가능).
처음 한 번 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿔야 합니다.
빌드는 상대 경로(`base: "./"`)라 저장소 이름이 바뀌어도 그대로 동작합니다.

`index.html`을 더블클릭해서는 앱이 동작하지 않습니다(개발 서버나 정적 호스팅 필요).
더블클릭으로 열리는 것은 앱에서 **내보낸 감상용 HTML**입니다.

## 사용 순서

1. 밴드에서 게시글을 연 상태로 `Ctrl+S` → "웹페이지, 전체"로 저장
2. 저장된 `.html`과 `_files` 폴더를 함께 선택하거나, 폴더째 `.zip`으로 묶어 넣기
   (게시글 영역 HTML을 복사한 `.txt`, 화면 텍스트 복사도 됩니다. 정확도는 저장 페이지 > HTML 조각 > 텍스트)
3. 검토 화면에서 확인할 점을 보고 가져오기
4. 미리보기에서 본문을 바로 고치고, ⋯ 메뉴·우클릭으로 이동·나누기·합치기·삭제, 오른쪽 패널에서 작성자·부모 지정
5. 인물 탭에서 표시 이름·설명·사진·색·숨기기, 표시 탭에서 테마·글꼴·크기
6. **프로젝트 저장**(복구용, 원본 포함 / 공유용, 원본 제외), **내보내기**(단일 HTML, 분할 PNG)

## 개발

```bash
npm run typecheck
npm test           # Vitest (파서·편집·저장·내보내기)
npm run e2e        # Playwright (실제 브라우저 흐름)
```

- 실제 사용자 샘플은 `tests/private/`에 두면 추가 테스트가 실행됩니다. 이 폴더는 `.gitignore` 대상이며 올리지 않습니다.
- 구조: `src/importers`(순수 파서) → `src/domain`(모델·검증) → `src/editor`(명령·실행취소) → `src/storage`(IndexedDB) → `src/renderers`(출력 스킨) → `src/exporters`(.afterlog·HTML·PNG) → `src/app`(화면)
- 이관표: [docs/band-migration.md](docs/band-migration.md), 검수 기록: [docs/qa-log.md](docs/qa-log.md)
