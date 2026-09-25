// 꾸미기 패널(오른쪽, 기본 닫힘). 적용 범위는 '이 글'이고, 다른 글에는 명시적으로 복사한다(소급 변경 없음).
// 모든 변경은 문서의 view.style에 저장되고 실행취소 한 단계씩 기록된다. 원형으로 되돌리기는 표시 설정만 바꾼다.
import { useMemo, useState } from "react";
import * as C from "../../editor/commands";
import type { CommentSkin, DocStyle, DocumentTheme, FontKey, TextRole, ViewSettings } from "../../domain/types";
import { customStyle, defaultDocStyle, FONT_LABEL, isOriginalSkin, RANGES } from "../../renderers/band/style";
import { Segmented, Slider } from "../../components/Slider";
import { ColorPicker } from "../../components/ColorPicker";
import { Icon } from "../../components/Icon";
import type { DocEditor } from "../useDocEditor";

type Section = "preset" | "text" | "avatar" | "comments" | "colors" | "show";
const SECTIONS: [Section, string, string][] = [
  ["preset", "프리셋", "프리셋 원형 다크 라이트 목록 대화 저장"],
  ["text", "글자", "글자 폰트 글꼴 크기 굵기 줄간격 자간 이름 소개 본문 댓글 시각"],
  ["avatar", "인장", "인장 프로필 사진 모양 원형 사각 둥근 크기 테두리 그림자 반복"],
  ["comments", "본문·댓글", "댓글 답글 말풍선 꼬리 들여쓰기 구분선 스킨 선형 카드 읽기 폭"],
  ["colors", "색·배경", "색 배경 테마 다크 라이트 표면 멘션 글자색"],
  ["show", "표시 항목", "표시 날짜 읽음 표정 소개 발췌 이미지 숨기기"],
];

const ROLE_LABEL: Record<TextRole, string> = { name: "이름", desc: "소개", body: "본문", comment: "댓글", meta: "시각·메타" };
const SKIN_LABEL: [CommentSkin, string][] = [
  ["band", "밴드형"],
  ["linear", "선형 목록"],
  ["bubble", "말풍선"],
  ["card", "카드"],
  ["reading", "읽기형"],
];

interface Preset {
  name: string;
  style: DocStyle;
  width?: number;
  /** 원형 프리셋: 사용자 스킨은 두고 원형 + 기록 테마만 바꾼다 */
  original?: boolean;
}

const PRESET_KEY = "afterlog.stylePresets";
function builtinPresets(): Preset[] {
  const band = defaultDocStyle();
  const dark: DocStyle = { ...band, documentTheme: "dark" };
  const light: DocStyle = { ...band, documentTheme: "light" };
  const list: DocStyle = { ...band, commentSkin: "linear", avatar: { ...band.avatar, repeat: "hidden" } };
  const chat: DocStyle = { ...band, commentSkin: "bubble", avatar: { ...band.avatar, repeat: "group" } };
  return [
    { name: "BAND 원형 · 화면 테마 따름", style: band, original: true },
    { name: "BAND 원형 · 다크", style: dark, original: true },
    { name: "BAND 원형 · 라이트", style: light, original: true },
    { name: "간결한 목록", style: list },
    { name: "대화형(말풍선)", style: chat },
  ];
}
function readPresets(): Preset[] {
  try {
    const v = JSON.parse(localStorage.getItem(PRESET_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writePresets(p: Preset[]) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(p));
  } catch {
    /* 저장소를 못 쓰면 이번 창에서만 */
  }
}

let clipboardStyle: { style: DocStyle; width: number; original: boolean } | null = null;

export function DesignPanel({
  editor,
  onClose,
  onCompare,
  otherDocs,
  onApplyToAll,
  onSaveProjectDefault,
}: {
  editor: DocEditor;
  onClose(): void;
  onCompare(on: boolean): void;
  otherDocs: number;
  onApplyToAll(view: ViewSettings): Promise<void>;
  onSaveProjectDefault(view: ViewSettings): Promise<void>;
}) {
  const { doc } = editor;
  const ro = !!editor.readOnly;
  // 패널은 보관된 사용자 스킨을 보여 주고 고친다. 원형 보기 중에 값을 바꾸면 사용자 스킨으로 전환된다
  const st = customStyle(doc.view);
  const original = isOriginalSkin(doc.view);
  const def = defaultDocStyle();
  const [open, setOpen] = useState<Section>("preset");
  const [q, setQ] = useState("");
  const [presets, setPresets] = useState<Preset[]>(readPresets);
  const [msg, setMsg] = useState<string | null>(null);
  const setStyle = (fn: (s: DocStyle, v: ViewSettings) => void, key?: string) =>
    editor.apply(
      (d) =>
        C.updateView(d, (v) => {
          if (!v.style) v.style = customStyle(v as ViewSettings);
          fn(v.style as DocStyle, v as ViewSettings);
          v.skinFamily = "custom";
        }),
      key,
    );
  const needle = q.trim();
  const visible = useMemo(() => SECTIONS.filter(([, label, kw]) => !needle || label.includes(needle) || kw.includes(needle)), [needle]);
  const sec = (id: Section, children: React.ReactNode) => {
    const meta = SECTIONS.find((s) => s[0] === id)!;
    if (!visible.some((v) => v[0] === id)) return null;
    const isOpen = needle ? true : open === id;
    return (
      <section className={`design-sec${isOpen ? " is-open" : ""}`} key={id}>
        <button type="button" className="design-sec-head" aria-expanded={isOpen} onClick={() => setOpen(id)}>
          <span>{meta[1]}</span>
          <Icon name="chevronDown" size={14} />
        </button>
        {isOpen ? <div className="design-sec-body">{children}</div> : null}
      </section>
    );
  };

  const typo = (r: TextRole) => {
    const t = st.typography[r];
    const [lo, hi] = RANGES.size[r];
    return (
      <div className="design-role" key={r}>
        <div className="design-role-head">
          <b>{ROLE_LABEL[r]}</b>
          <select
            aria-label={`${ROLE_LABEL[r]} 글꼴`}
            value={t.font ?? ""}
            disabled={ro}
            onChange={(e) => setStyle((s) => void (s.typography[r].font = (e.target.value || undefined) as FontKey | undefined))}
          >
            <option value="">전체 글꼴 따름</option>
            {(Object.keys(FONT_LABEL) as FontKey[]).map((f) => (
              <option key={f} value={f}>
                {FONT_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
        <Slider label="크기" value={t.size} min={lo} max={hi} defaultValue={def.typography[r].size} disabled={ro} onChange={(v) => setStyle((s) => void (s.typography[r].size = v), `ty:${r}:size`)} />
        {r === "body" || r === "comment" ? (
          <>
            <Slider
              label="줄간격"
              value={t.lineHeight ?? def.typography[r].lineHeight ?? 1.6}
              min={RANGES.lineHeight[0]}
              max={RANGES.lineHeight[1]}
              step={0.05}
              unit="배"
              defaultValue={def.typography[r].lineHeight}
              disabled={ro}
              onChange={(v) => setStyle((s) => void (s.typography[r].lineHeight = v), `ty:${r}:lh`)}
            />
            <Slider
              label="자간"
              value={t.letterSpacing ?? 0}
              min={RANGES.letterSpacing[0]}
              max={RANGES.letterSpacing[1]}
              step={0.1}
              defaultValue={0}
              disabled={ro}
              onChange={(v) => setStyle((s) => void (s.typography[r].letterSpacing = v), `ty:${r}:ls`)}
            />
          </>
        ) : null}
        {r === "name" ? (
          <Segmented
            label="굵기"
            value={String(t.weight ?? 700)}
            disabled={ro}
            options={[
              ["400", "보통"],
              ["600", "약간 굵게"],
              ["700", "굵게"],
            ]}
            onChange={(v) => setStyle((s) => void (s.typography.name.weight = Number(v)))}
          />
        ) : null}
      </div>
    );
  };

  return (
    <aside className="design-panel" aria-label="꾸미기">
      <div className="panel-head">
        <strong>꾸미기</strong>
        <span className="tag" title="이 설정은 지금 연 글에만 적용됩니다">이 글</span>
        <span className="spacer" />
        <button type="button" className="ui-icon-btn" aria-label="꾸미기 닫기" title="닫기(원형 보기로)" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="design-tools">
        <input type="search" placeholder="설정 찾기 (예: 인장, 줄간격)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="디자인 설정 검색" />
        <button
          type="button"
          className="ui-btn ui-btn-small"
          onPointerDown={() => onCompare(true)}
          onPointerUp={() => onCompare(false)}
          onPointerLeave={() => onCompare(false)}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onCompare(true)}
          onKeyUp={() => onCompare(false)}
          title="누르고 있는 동안 원형(기본 디자인)으로 비교합니다. 설정은 바뀌지 않습니다."
        >
          원형과 비교
        </button>
      </div>
      <div className="skin-family" role="radiogroup" aria-label="보기">
        <button type="button" role="radio" aria-checked={original} disabled={ro} onClick={() => editor.apply((d) => C.updateView(d, (v) => void (v.skinFamily = "original")))}>
          밴드 원형
        </button>
        <button type="button" role="radio" aria-checked={!original} disabled={ro} onClick={() => editor.apply((d) => C.updateView(d, (v) => void (v.skinFamily = "custom")))}>
          내 스킨
        </button>
      </div>
      <p className="small muted skin-family-note">
        {original ? "원형으로 보는 중입니다. 아래 값을 바꾸면 '내 스킨'으로 바뀌며, 내 스킨은 원형으로 돌아가도 그대로 보관됩니다." : "내 스킨으로 보는 중입니다. '밴드 원형'을 누르면 언제든 원래 모양으로 돌아가고 내 스킨은 보관됩니다."}
      </p>
      <div className="panel-body design-body">
        {sec(
          "preset",
          <>
            <ul className="preset-list">
              {[...builtinPresets(), ...presets].map((p, i) => (
                <li key={`${p.name}:${i}`}>
                  <button
                    type="button"
                    disabled={ro}
                    onClick={() =>
                      editor.apply((d) =>
                        C.updateView(d, (v) => {
                          if (p.original) {
                            // 원형 프리셋은 보관된 내 스킨을 지우지 않는다
                            if (!v.style) v.style = customStyle(v as ViewSettings);
                            v.style.documentTheme = p.style.documentTheme;
                            v.skinFamily = "original";
                            return;
                          }
                          v.style = structuredClone(p.style);
                          if (p.width) v.width = p.width;
                          v.skinFamily = "custom";
                        }),
                      )
                    }
                  >
                    {p.name}
                  </button>
                  {i >= builtinPresets().length ? (
                    <button
                      type="button"
                      className="ui-icon-btn"
                      aria-label={`${p.name} 프리셋 지우기`}
                      onClick={() => {
                        const next = presets.filter((x) => x !== p);
                        setPresets(next);
                        writePresets(next);
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="small muted">프리셋은 표시 설정만 담습니다(인물 이름·원문·이미지는 들어가지 않음). 적용해도 인물별 설정은 그대로입니다.</p>
            <div className="row-actions">
              <button
                type="button"
                className="ui-btn ui-btn-small"
                onClick={() => {
                  const name = prompt("프리셋 이름", "내 스타일");
                  if (!name) return;
                  const next = [...presets, { name, style: structuredClone(st), width: doc.view.width }];
                  setPresets(next);
                  writePresets(next);
                }}
              >
                지금 설정을 프리셋으로 저장
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-small"
                onClick={() => {
                  clipboardStyle = { style: structuredClone(st), width: doc.view.width, original };
                  setMsg("디자인을 복사했습니다. 다른 글을 열고 '붙여넣기'를 누르세요.");
                }}
              >
                설정 복사
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-small"
                disabled={ro || !clipboardStyle}
                onClick={() =>
                  clipboardStyle &&
                  editor.apply((d) =>
                    C.updateView(d, (v) => {
                      v.style = structuredClone(clipboardStyle!.style);
                      v.width = clipboardStyle!.width;
                      v.skinFamily = clipboardStyle!.original ? "original" : "custom";
                    }),
                  )
                }
              >
                붙여넣기
              </button>
            </div>
          </>,
        )}
        {sec(
          "text",
          <>
            {(["name", "desc", "body", "comment", "meta"] as TextRole[]).map(typo)}
            <p className="small muted">기기에 설치된 글꼴을 씁니다. HTML 파일은 오프라인에서 열리지만, 보는 기기에 같은 글꼴이 없으면 기본 글꼴로 바뀔 수 있습니다.</p>
          </>,
        )}
        {sec(
          "avatar",
          <>
            <Segmented
              label="모양"
              value={st.avatar.shape}
              disabled={ro}
              options={[
                ["circle", "원형"],
                ["square", "사각"],
                ["rounded", "둥근 사각"],
              ]}
              onChange={(v) => setStyle((s) => void (s.avatar.shape = v))}
            />
            {st.avatar.shape === "rounded" ? (
              <Slider label="둥글기" value={st.avatar.radius} min={RANGES.radius[0]} max={RANGES.radius[1]} defaultValue={def.avatar.radius} disabled={ro} onChange={(v) => setStyle((s) => void (s.avatar.radius = v), "av:radius")} />
            ) : null}
            {(["post", "comment", "reply", "profile"] as const).map((k) => (
              <Slider
                key={k}
                label={{ post: "글 인장", comment: "댓글 인장", reply: "답글 인장", profile: "프로필 인장" }[k]}
                value={st.avatar.sizes[k]}
                min={RANGES.avatar[k][0]}
                max={RANGES.avatar[k][1]}
                defaultValue={def.avatar.sizes[k]}
                disabled={ro}
                onChange={(v) => setStyle((s) => void (s.avatar.sizes[k] = v), `av:size:${k}`)}
              />
            ))}
            <Slider label="테두리" value={st.avatar.borderWidth} min={RANGES.border[0]} max={RANGES.border[1]} defaultValue={0} disabled={ro} onChange={(v) => setStyle((s) => void (s.avatar.borderWidth = v), "av:border")} />
            {st.avatar.borderWidth ? (
              <div className="field-row">
                <span>테두리 색</span>
                <ColorPicker label="테두리 색" value={st.avatar.borderColor} onChange={(c) => setStyle((s) => void (s.avatar.borderColor = c))} />
              </div>
            ) : null}
            <Segmented
              label="그림자"
              value={st.avatar.shadow}
              disabled={ro}
              options={[
                ["none", "없음"],
                ["soft", "약하게"],
              ]}
              onChange={(v) => setStyle((s) => void (s.avatar.shadow = v))}
            />
            <Segmented
              label="맞춤"
              value={st.avatar.fit}
              disabled={ro}
              options={[
                ["cover", "채우기"],
                ["contain", "전체 보이기"],
              ]}
              onChange={(v) => setStyle((s) => void (s.avatar.fit = v))}
            />
            <Segmented
              label="반복 표시"
              value={st.avatar.repeat}
              disabled={ro}
              options={[
                ["every", "매번"],
                ["group", "연속이면 첫 번째만"],
                ["hidden", "숨김"],
              ]}
              onChange={(v) => setStyle((s) => void (s.avatar.repeat = v))}
            />
            <Segmented
              label="인장 없을 때"
              value={st.avatar.fallback}
              disabled={ro}
              options={[
                ["initial", "첫 글자"],
                ["neutral", "기본 모양"],
                ["none", "빈칸 없음"],
              ]}
              onChange={(v) => setStyle((s) => void (s.avatar.fallback = v))}
            />
            <p className="small muted">인물별 모양·자르기는 편집 모드의 '인물' 탭에서 바꿉니다. 원본 이미지는 그대로 보관됩니다.</p>
          </>,
        )}
        {sec(
          "comments",
          <>
            <div className="skin-grid" role="radiogroup" aria-label="댓글 모양">
              {SKIN_LABEL.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={st.commentSkin === k} disabled={ro} onClick={() => setStyle((s) => void (s.commentSkin = k))}>
                  <span className={`skin-thumb skin-thumb-${k}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {label}
                </button>
              ))}
            </div>
            <p className="small muted">모양만 바뀝니다. 작성자·본문·순서·답글 관계·표정 값은 그대로입니다.</p>
            {st.commentSkin === "bubble" ? (
              <>
                <Segmented
                  label="말풍선 꼬리"
                  value={st.comments.bubbleTail}
                  disabled={ro}
                  options={[
                    ["none", "없음"],
                    ["small", "작게"],
                    ["default", "기본"],
                  ]}
                  onChange={(v) => setStyle((s) => void (s.comments.bubbleTail = v))}
                />
                <Slider label="말풍선 둥글기" value={st.comments.bubbleRadius} min={0} max={24} defaultValue={def.comments.bubbleRadius} disabled={ro} onChange={(v) => setStyle((s) => void (s.comments.bubbleRadius = v), "cm:bubbleRadius")} />
              </>
            ) : null}
            <Slider label="답글 들여쓰기" value={st.comments.replyIndent} min={RANGES.replyIndent[0]} max={RANGES.replyIndent[1]} defaultValue={def.comments.replyIndent} disabled={ro} onChange={(v) => setStyle((s) => void (s.comments.replyIndent = v), "cm:indent")} />
            <label className="check">
              <input type="checkbox" checked={st.comments.dividers} disabled={ro} onChange={(e) => setStyle((s) => void (s.comments.dividers = e.target.checked))} />
              댓글 사이 구분선
            </label>
            <Slider label="글 폭" value={doc.view.width} min={RANGES.width[0]} max={RANGES.width[1]} step={10} defaultValue={600} disabled={ro} onChange={(v) => setStyle((_s, vw) => void (vw.width = v), "width")} />
            <p className="small muted">글 폭은 원형 보기·HTML·이미지 출력에 같이 쓰입니다(밴드 상세 기본 600px).</p>
          </>,
        )}
        {sec(
          "colors",
          <>
            <Segmented<DocumentTheme>
              label="기록 테마"
              value={st.documentTheme}
              disabled={ro}
              options={[
                ["app", "화면 테마 따름"],
                ["dark", "다크"],
                ["light", "라이트"],
              ]}
              onChange={(v) =>
                editor.apply((d) =>
                  C.updateView(d, (vw) => {
                    if (!vw.style) vw.style = customStyle(vw as ViewSettings);
                    vw.style.documentTheme = v;
                  }),
                )
              }
            />
            <p className="small muted">원형·내 스킨 모두에 적용됩니다. 편집기 화면 테마와 별개입니다. '화면 테마 따름'이면 내보낼 때의 화면 테마로 저장됩니다.</p>
            {(
              [
                ["background", "바깥 배경"],
                ["surface", "글 바탕"],
                ["commentSurface", "댓글 바탕"],
                ["text", "글자"],
                ["mention", "@멘션"],
              ] as [keyof DocStyle["colors"], string][]
            ).map(([k, label]) => (
              <div className="field-row" key={k}>
                <span>{label}</span>
                <ColorPicker label={label} value={st.colors[k]} onChange={(c) => setStyle((s) => void (s.colors[k] = c))} />
                {st.colors[k] ? (
                  <button type="button" className="ui-link small" onClick={() => setStyle((s) => void (s.colors[k] = null))}>
                    기본
                  </button>
                ) : null}
              </div>
            ))}
          </>,
        )}
        {sec(
          "show",
          <>
            {(
              [
                ["date", "날짜"],
                ["readCount", "읽음 수"],
                ["reactions", "표정·댓글 수"],
                ["description", "소개"],
                ["excerpt", "원글 발췌 (댓글 모음)"],
              ] as [keyof ViewSettings["show"], string][]
            ).map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={doc.view.show[k]} disabled={ro} onChange={(e) => editor.apply((d) => C.updateView(d, (v) => void (v.show[k] = e.target.checked)))} />
                {label}
              </label>
            ))}
            <label className="field">
              <span>확보되지 않은 이미지</span>
              <select value={doc.view.missingImages} disabled={ro} onChange={(e) => editor.apply((d) => C.updateView(d, (v) => void (v.missingImages = e.target.value as ViewSettings["missingImages"])))}>
                <option value="placeholder">자리 표시 남기기 (기본)</option>
                <option value="omit">보기·내보내기에서 빼기</option>
              </select>
            </label>
            <p className="small muted">끄면 화면·출력에서만 빠지고 자료는 그대로 남습니다.</p>
          </>,
        )}
        {msg ? <p className="notice ok">{msg}</p> : null}
      </div>
      <div className="design-foot">
        <button
          type="button"
          className="ui-btn ui-btn-small"
          disabled={ro}
          onClick={() =>
            editor.apply((d) =>
              C.updateView(d, (v) => {
                // 내 스킨의 모든 값을 기본값으로(기록 테마는 유지). 글·댓글·인물·첨부는 그대로
                const keepTheme = customStyle(v as ViewSettings).documentTheme;
                v.style = { ...defaultDocStyle(), documentTheme: keepTheme };
                v.width = 600;
              }),
            )
          }
          title="보관된 내 스킨을 기본값으로 되돌립니다. 글·댓글·인물·첨부는 바뀌지 않습니다"
        >
          내 스킨 초기화
        </button>
        {otherDocs > 0 ? (
          <button
            type="button"
            className="ui-btn ui-btn-small"
            disabled={ro}
            onClick={async () => {
              if (!confirm(`이 글의 디자인을 다른 글 ${otherDocs}개에도 복사할까요? 각 글의 인물·본문은 바뀌지 않습니다.`)) return;
              await onApplyToAll(doc.view);
              setMsg(`다른 글 ${otherDocs}개에 같은 디자인을 적용했습니다.`);
            }}
          >
            모든 글에 적용
          </button>
        ) : null}
        <button
          type="button"
          className="ui-btn ui-btn-small"
          onClick={async () => {
            await onSaveProjectDefault(doc.view);
            setMsg("새로 가져오는 글은 이 디자인으로 시작합니다.");
          }}
        >
          새 글의 기본으로
        </button>
      </div>
    </aside>
  );
}
