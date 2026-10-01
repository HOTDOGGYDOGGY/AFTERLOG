// 꾸미기 패널(오른쪽, 기본 닫힘). 적용 범위는 '이 글'이고, 다른 글에는 명시적으로 복사한다(소급 변경 없음).
// 모든 변경은 문서의 view.style에 저장되고 실행취소 한 단계씩 기록된다. 원형으로 되돌리기는 표시 설정만 바꾼다.
import { useEffect, useMemo, useRef, useState } from "react";
import * as C from "../../editor/commands";
import { defaultViewSettings, type AvatarShape, type CommentSkin, type DocStyle, type DocumentTheme, type FontKey, type Identity, type TextRole, type ViewSettings } from "../../domain/types";
import { Avatar } from "../../renderers/band/BandView";
import { customStyle, defaultDocStyle, FONT_LABEL, isOriginalSkin, RANGES } from "../../renderers/band/style";
import { Segmented, Slider } from "../../components/Slider";
import { ColorPicker } from "../../components/ColorPicker";
import { Icon } from "../../components/Icon";
import type { DocEditor } from "../useDocEditor";

type Section = "preset" | "text" | "avatar" | "comments" | "people" | "colors" | "show";
const SECTIONS: [Section, string, string][] = [
  ["preset", "프리셋", "프리셋 원형 다크 라이트 목록 대화 저장"],
  ["text", "글자", "글자 폰트 글꼴 크기 굵기 줄간격 자간 이름 소개 본문 댓글 시각"],
  ["avatar", "인장", "인장 프로필 사진 모양 원형 사각 둥근 크기 테두리 그림자 반복"],
  ["comments", "본문·댓글", "댓글 답글 말풍선 꼬리 들여쓰기 구분선 스킨 선형 카드 읽기 폭"],
  ["people", "인물별", "인물 참여자 사람 이름색 말풍선 색 글자색 위치 오른쪽 왼쪽 나 모양"],
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
  assetUrl,
}: {
  editor: DocEditor;
  onClose(): void;
  onCompare(on: boolean): void;
  otherDocs: number;
  /** 다른 글에 복사. 되돌리는 함수를 돌려주면 '취소'를 보여 준다 */
  onApplyToAll(view: ViewSettings): Promise<(() => Promise<void>) | void>;
  onSaveProjectDefault(view: ViewSettings): Promise<void>;
  assetUrl?(id: string): string | undefined;
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
  const [msg, setMsgState] = useState<{ text: string; undo?: () => void | Promise<void>; local?: boolean } | null>(null);
  const setMsg = (text: string | null, undo?: () => void | Promise<void>, local = false) => setMsgState(text ? { text, undo, local } : null);
  /** 되돌리기 계열은 한 단계 실행취소로 되돌릴 수 있게 하고, 바로 '취소'를 보여 준다 */
  const resetWith = (label: string, fn: () => void) => {
    fn();
    afterReset.current = null;
    setMsg(
      `${label} 되돌렸습니다.`,
      () => {
        editor.undo();
        setMsg("되돌리기를 취소했습니다.");
      },
      true,
    );
  };
  // 되돌린 뒤 다른 값을 또 바꾸면 '취소'는 거둔다(실행취소가 엉뚱한 변경을 되돌리지 않게)
  const afterReset = useRef<unknown>(null);
  useEffect(() => {
    if (!msg?.local || !msg.undo) return;
    if (afterReset.current === null) afterReset.current = doc;
    else if (afterReset.current !== doc) setMsgState({ text: msg.text });
  }, [doc, msg]);
  const resetSection = (id: Section) => {
    const label = SECTIONS.find((x) => x[0] === id)?.[1] ?? "";
    if (id === "text") resetWith(`'${label}' 묶음을 기본값으로`, () => setStyle((s2) => void (s2.typography = structuredClone(def.typography)), undefined, true));
    if (id === "avatar") resetWith(`'${label}' 묶음을 기본값으로`, () => setStyle((s2) => void (s2.avatar = structuredClone(def.avatar)), undefined, true));
    if (id === "comments")
      resetWith(`'${label}' 묶음을 기본값으로`, () =>
        setStyle((s2, v) => {
          s2.commentSkin = def.commentSkin;
          s2.comments = structuredClone(def.comments);
          v.width = 600;
        }, undefined, true),
      );
    if (id === "colors") resetWith("색을 기본값으로", () => setStyle((s2) => void (s2.colors = structuredClone(def.colors)), undefined, true));
    if (id === "show")
      resetWith("표시 항목을 기본값으로", () =>
        editor.apply((d) =>
          C.updateView(d, (v) => {
            const dv = defaultViewSettings();
            v.show = { ...dv.show };
            v.missingImages = dv.missingImages;
          }),
        ),
      );
  };
  const setStyle = (fn: (s: DocStyle, v: ViewSettings) => void, key?: string, keepFamily = false) =>
    editor.apply(
      (d) =>
        C.updateView(d, (v) => {
          if (!v.style) v.style = customStyle(v as ViewSettings);
          fn(v.style as DocStyle, v as ViewSettings);
          // 되돌리기는 보던 모양(원형/내 스킨)을 바꾸지 않는다
          if (!keepFamily) v.skinFamily = "custom";
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
        {isOpen ? (
          <div className="design-sec-body">
            {id !== "preset" && id !== "people" && !ro ? (
              <div className="design-sec-reset">
                <button type="button" className="ui-link small" onClick={() => resetSection(id)} title="이 묶음의 값만 기본값으로 되돌립니다. 다른 묶음·글·인물·자료는 그대로입니다">
                  이 묶음만 기본값으로
                </button>
              </div>
            ) : null}
            {children}
          </div>
        ) : null}
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
            <p className="small muted">인물마다 다른 인장 모양은 아래 '인물별'에서, 인장 이미지·자르기는 '내용 편집 → 인물'에서 바꿉니다. 원본 이미지는 그대로 보관됩니다.</p>
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
          "people",
          <PeopleStyles editor={editor} skin={st.commentSkin} assetUrl={assetUrl} onReset={resetWith} onUseBubble={() => setStyle((s2) => void (s2.commentSkin = "bubble"))} />,
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
      </div>
      <div className="design-foot">
        {msg ? (
          <p className="notice ok design-msg" role="status">
            {msg.text}
            {msg.undo ? (
              <button
                type="button"
                className="ui-link"
                onClick={async () => {
                  const u = msg.undo!;
                  setMsg(null);
                  await u();
                }}
              >
                취소
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="design-foot-row">
          {otherDocs > 0 ? (
            <button
              type="button"
              className="ui-btn ui-btn-small"
              disabled={ro}
              onClick={async () => {
                if (!confirm(`이 글의 디자인을 다른 글 ${otherDocs}개에도 복사할까요? 각 글의 인물·본문은 바뀌지 않고, 바로 뒤 '취소'로 되돌릴 수 있습니다.`)) return;
                const restore = await onApplyToAll(doc.view);
                setMsg(
                  `다른 글 ${otherDocs}개에 같은 디자인을 적용했습니다.`,
                  restore
                    ? async () => {
                        await restore();
                        setMsg(`다른 글 ${otherDocs}개의 디자인을 적용 전으로 되돌렸습니다.`);
                      }
                    : undefined,
                );
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
        {/* 되돌리기는 적용 버튼과 떨어뜨려 두고, 누른 뒤 '취소'로 바로 되돌릴 수 있게 한다(자료 삭제는 여기 없음) */}
        <details className="design-reset">
          <summary>되돌리기…</summary>
          <p className="small muted">이 글의 꾸밈만 바뀝니다. 글·댓글·인물 이름·이미지 같은 자료는 지우지 않습니다.</p>
          <button
            type="button"
            className="ui-btn ui-btn-small"
            disabled={ro}
            onClick={() =>
              resetWith("내 스킨 전체를 기본값으로", () =>
                editor.apply((d) =>
                  C.updateView(d, (v) => {
                    // 내 스킨의 모든 값을 기본값으로(기록 테마는 유지). 글·댓글·인물·첨부는 그대로
                    const keepTheme = customStyle(v as ViewSettings).documentTheme;
                    v.style = { ...defaultDocStyle(), documentTheme: keepTheme };
                    v.width = 600;
                  }),
                ),
              )
            }
            title="보관된 내 스킨을 기본값으로 되돌립니다. 글·댓글·인물·첨부는 바뀌지 않습니다"
          >
            내 스킨 전체 기본값으로
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-small"
            disabled={ro || !Object.values(doc.identities).some(hasLook)}
            onClick={() =>
              resetWith("인물별 꾸밈을 모두", () =>
                editor.apply((d) => {
                  let out = d;
                  for (const id of Object.keys(d.identities)) if (hasLook(d.identities[id])) out = C.updateIdentity(out, id, clearLook(d.identities[id]));
                  return out;
                }),
              )
            }
          >
            인물별 꾸밈 모두 지우기
          </button>
        </details>
      </div>
    </aside>
  );
}

/** 인물의 '보이는 모양' 설정이 있는가(이름·소개·인장 이미지·자르기는 자료 편집이라 제외) */
const hasLook = (p: Identity | undefined) => !!p && (!!p.color || !!p.style?.bubbleColor || !!p.style?.bubbleTextColor || !!p.style?.side || !!p.style?.avatarShape);
const clearLook = (p: Identity): Partial<Identity> => ({ color: null, style: { ...p.style, bubbleColor: undefined, bubbleTextColor: undefined, side: undefined, avatarShape: undefined } });

/** 상대 휘도 대비(WCAG). 둘 다 #rrggbb일 때만 */
export function contrastRatio(a: string, b: string): number | null {
  const lum = (h: string) => {
    const m = /^#([0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const la = lum(a);
  const lb = lum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 인물별 꾸미기(디자인 참고 08·11·12): 한 줄에 얼굴·이름·요약, 고른 사람만 펼쳐 색·위치·모양. 보이는 모양만 바꾼다 */
function PeopleStyles({
  editor,
  skin,
  assetUrl,
  onReset,
  onUseBubble,
}: {
  editor: DocEditor;
  skin: CommentSkin;
  assetUrl?(id: string): string | undefined;
  onReset(label: string, fn: () => void): void;
  onUseBubble(): void;
}) {
  const { doc } = editor;
  const ro = !!editor.readOnly;
  const counts = new Map<string, number>();
  for (const e of Object.values(doc.entries)) if (e.authorId) counts.set(e.authorId, (counts.get(e.authorId) ?? 0) + 1);
  const ids = doc.identityOrder.filter((id) => doc.identities[id] && counts.get(id));
  const [sel, setSel] = useState<string | null>(null);
  const bubble = skin === "bubble";
  const setLook = (id: string, patch: Partial<NonNullable<Identity["style"]>>, color?: string | null) =>
    editor.apply((d) => C.updateIdentity(d, id, { ...(color !== undefined ? { color } : {}), style: { ...d.identities[id]?.style, ...patch } }));
  if (!ids.length) return <p className="small muted">이 글에 작성자가 확인된 항목이 없습니다.</p>;
  return (
    <>
      <p className="small muted">보이는 모양만 바꿉니다. 이름·소개·인장 이미지·인물 합치기는 '내용 편집 → 인물'에서 합니다. 원래 작성자·순서·답글 관계는 그대로입니다.</p>
      {!bubble ? (
        <p className="small muted design-people-note">
          말풍선 색·위치는 댓글 모양이 '말풍선'일 때 보입니다.{" "}
          <button type="button" className="ui-link" disabled={ro} onClick={onUseBubble}>
            말풍선으로 바꾸기
          </button>
        </p>
      ) : null}
      <ul className="design-people" aria-label="인물별 꾸미기">
        {ids.map((id) => {
          const p = doc.identities[id];
          const open = sel === id;
          const tags = [p.color ? "이름색" : "", p.style?.bubbleColor || p.style?.bubbleTextColor ? "말풍선색" : "", p.style?.side === "right" ? "오른쪽" : "", p.style?.avatarShape ? "인장 모양" : ""].filter(Boolean);
          const cr = p.style?.bubbleColor && p.style?.bubbleTextColor ? contrastRatio(p.style.bubbleColor, p.style.bubbleTextColor) : null;
          return (
            <li key={id} className={open ? "is-open" : undefined}>
              <button type="button" className="design-person-row" aria-expanded={open} onClick={() => setSel(open ? null : id)}>
                <Avatar doc={doc} identity={p} context="reply" assetUrl={assetUrl ?? (() => undefined)} />
                <span className="design-person-name ellipsis" style={p.color ? { color: p.color } : undefined}>
                  {p.displayName}
                </span>
                <small className="muted">{tags.length ? tags.join(" · ") : `${counts.get(id)}개`}</small>
                {open ? <span className="tag">고르는 중</span> : null}
              </button>
              {open ? (
                <div className="design-person-edit">
                  <div className="field-row">
                    <span>이름 색</span>
                    <ColorPicker label={`${p.displayName} 이름 색`} value={p.color} onChange={(c) => !ro && setLook(id, {}, c)} />
                  </div>
                  <div className="field-row">
                    <span>말풍선 바탕</span>
                    <ColorPicker label={`${p.displayName} 말풍선 바탕`} value={p.style?.bubbleColor ?? null} onChange={(c) => !ro && setLook(id, { bubbleColor: c ?? undefined })} />
                    <span>글자</span>
                    <ColorPicker label={`${p.displayName} 말풍선 글자`} value={p.style?.bubbleTextColor ?? null} onChange={(c) => !ro && setLook(id, { bubbleTextColor: c ?? undefined })} />
                  </div>
                  {cr !== null && cr < 3 ? <p className="small pv-warn">말풍선 바탕과 글자의 대비가 낮아 읽기 어려울 수 있습니다(대비 {cr.toFixed(1)}:1).</p> : null}
                  <Segmented<"left" | "right">
                    label="말풍선 위치"
                    value={p.style?.side ?? "left"}
                    disabled={ro || !bubble}
                    options={[
                      ["left", "왼쪽"],
                      ["right", "오른쪽"],
                    ]}
                    onChange={(v) => setLook(id, { side: v === "right" ? "right" : undefined })}
                  />
                  <Segmented<AvatarShape | "doc">
                    label="인장 모양"
                    value={p.style?.avatarShape ?? "doc"}
                    disabled={ro}
                    options={[
                      ["doc", "문서 설정"],
                      ["circle", "원형"],
                      ["square", "사각"],
                      ["rounded", "둥근 사각"],
                    ]}
                    onChange={(v) => setLook(id, { avatarShape: v === "doc" ? undefined : v })}
                  />
                  {hasLook(p) ? (
                    <button type="button" className="ui-link small" disabled={ro} onClick={() => onReset(`'${p.displayName}'의 꾸밈을`, () => editor.apply((d) => C.updateIdentity(d, id, clearLook(d.identities[id]))))}>
                      이 인물 꾸밈만 되돌리기
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
