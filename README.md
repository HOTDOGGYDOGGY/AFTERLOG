# AFTERLOG · 애프터로그

**바로 쓰기:** https://hotdoggydoggy.github.io/AFTERLOG/ · **수집 확장:** [afterlog-collector.zip](https://hotdoggydoggy.github.io/AFTERLOG/afterlog-collector.zip) ([설치·사용법](docs/collector.md))

역극(RP) 기록을 원문과 함께 보관하고, 인물·이미지·표시 형식을 고쳐 다시 보거나 파일로 내보내는 도구.
상단 플랫폼 줄에서 **밴드**(새 편집기, 원래 밴드 화면처럼 보기)와 **카카오톡·트위터·DM·카페**(예전 RPBA 도구 연결), **짓시**(원문 보관)를 오갑니다.
밴드 글이 많으면 **수집 확장프로그램**으로 글 목록 전체를 한 번에 모을 수 있습니다. 지원 범위는 [docs/support.md](docs/support.md)를 보세요.

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
3. 검토 화면에서 확인할 점을 보고 가져오기 → 원래 밴드 화면처럼 글 상세가 열립니다(다크 기본, 설정에서 라이트/시스템)
4. 작성자·인장을 누르면 보관된 인물 프로필, 거기서 댓글을 누르면 원글의 그 댓글로 이동. 뒤로가기·Esc로 돌아옴
5. **꾸미기**: 프리셋·글자(역할별)·인장(원형/사각/둥근 사각·크기·테두리)·댓글 모양(밴드/선형/말풍선/카드/읽기)·색·표시 항목. '원형으로 되돌리기'는 표시만 바꿉니다
6. **내용 편집**: 본문 직접 수정, ⋯ 메뉴·우클릭으로 이동·나누기·합치기·삭제, 인물 탭에서 이름·소개·인장 교체·자르기·숨기기·합치기
7. **프로젝트 저장**(복구용, 원본 포함 / 공유용, 원본 제외 — 카톡 등 기존 도구 상태도 함께), **내보내기**(이 글/모든 글 · HTML·PNG·JPG·HTML 복사)

## 개발

```bash
npm run typecheck
npm test           # Vitest (파서·편집·저장·내보내기·수집기·진단)
npm run e2e        # Playwright (웹 앱 흐름)
npm run build:collector:test && npx playwright test --config playwright.collector.config.ts   # 수집 확장(가짜 밴드 서버)
```

- 실제 사용자 샘플은 `tests/private/`에 두면 추가 테스트가 실행됩니다. 이 폴더는 `.gitignore` 대상이며 올리지 않습니다.
- 수집 확장: `collector/` ([docs/collector.md](docs/collector.md)). `.afterlog` 규격은 `src/archive/`를 웹 앱과 함께 씀.
- 구조: `src/importers`(순수 파서) → `src/domain`(모델·검증) → `src/editor`(명령·실행취소) → `src/storage`(IndexedDB) → `src/renderers`(출력 스킨) → `src/exporters`(.afterlog·HTML·PNG) → `src/app`(화면)
- 기존 도구: `public/legacy/`(RPBA 원본 복사 + 최소 수정, 바꾼 곳은 `AFTERLOG:` 주석). 부모와의 다리는 `public/legacy/bridge.js` ↔ `src/app/legacy/LegacyHost.tsx`
- 이관표: [docs/band-migration.md](docs/band-migration.md), 화면 개편(v1.2) 기능 위치표: [docs/ui-v1.2.md](docs/ui-v1.2.md), 검수 기록: [docs/qa-log.md](docs/qa-log.md)
