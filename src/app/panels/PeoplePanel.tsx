// 인물 목록(간결한 행) + 선택한 인물만 편집(V05). 이름·소개·인장 교체·자르기·모양·이름색·숨기기·합치기를 여기서 한다.
// 원본 이미지 바이트는 바꾸지 않고 표시용 자르기(crop)·모양만 인물 설정에 저장한다.
import { useState } from "react";
import * as C from "../../editor/commands";
import { ColorPicker } from "../../components/ColorPicker";
import { Icon } from "../../components/Icon";
import { Segmented, Slider } from "../../components/Slider";
import { addAsset } from "../../storage/repo";
import { pickFiles } from "../download";
import { Avatar } from "../../renderers/band/BandView";
import type { AvatarShape, Identity } from "../../domain/types";
import type { DocEditor } from "../useDocEditor";

export function PeoplePanel({
  editor,
  assetUrl,
  projectId,
  onAssetsChanged,
  onError,
  initialId,
}: {
  editor: DocEditor;
  assetUrl(id: string): string | undefined;
  projectId: string;
  onAssetsChanged(): Promise<void>;
  onError(msg: string): void;
  initialId?: string | null;
}) {
  const { doc } = editor;
  const [sel, setSel] = useState<string | null>(initialId ?? doc.identityOrder[0] ?? null);
  const counts = new Map<string, number>();
  for (const e of Object.values(doc.entries)) if (e.authorId) counts.set(e.authorId, (counts.get(e.authorId) ?? 0) + 1);
  const person = sel ? doc.identities[sel] : null;

  return (
    <div className="people">
      <ul className="people-rows" role="listbox" aria-label="인물">
        {doc.identityOrder.map((id) => {
          const p = doc.identities[id];
          if (!p) return null;
          return (
            <li key={id}>
              <button type="button" role="option" aria-selected={sel === id} className={p.hidden ? "is-hidden" : undefined} onClick={() => setSel(id)}>
                <Avatar doc={doc} identity={p} context="reply" assetUrl={assetUrl} />
                <span className="ellipsis" style={p.color ? { color: p.color } : undefined}>
                  {p.displayName}
                </span>
                {p.hidden ? <span className="tag">숨김</span> : null}
                <small className="muted">{counts.get(id) ?? 0}</small>
              </button>
            </li>
          );
        })}
      </ul>
      {person ? <PersonEditor key={person.id} editor={editor} person={person} assetUrl={assetUrl} projectId={projectId} onAssetsChanged={onAssetsChanged} onError={onError} count={counts.get(person.id) ?? 0} /> : null}
    </div>
  );
}

function PersonEditor({
  editor,
  person: p,
  assetUrl,
  projectId,
  onAssetsChanged,
  onError,
  count,
}: {
  editor: DocEditor;
  person: Identity;
  assetUrl(id: string): string | undefined;
  projectId: string;
  onAssetsChanged(): Promise<void>;
  onError(msg: string): void;
  count: number;
}) {
  const { doc } = editor;
  const ro = !!editor.readOnly;
  const [merge, setMerge] = useState(false);
  const id = p.id;
  const crop = p.style?.avatarCrop ?? { zoom: 1, x: 0, y: 0 };
  const setStyle = (patch: Partial<NonNullable<Identity["style"]>>, key?: string) =>
    editor.apply((d) => C.updateIdentity(d, id, { style: { ...d.identities[id]?.style, ...patch } }), key);

  const uploadAvatar = async () => {
    const [f] = await pickFiles("image/png,image/jpeg,image/gif,image/webp", false);
    if (!f) return;
    try {
      const a = await addAsset(projectId, f, f.name);
      await onAssetsChanged();
      editor.apply((d) => C.updateIdentity(d, id, { avatarAssetId: a.id, style: { ...d.identities[id]?.style, avatarCrop: undefined } }));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <section className="person-editor" aria-label={`${p.displayName} 편집`}>
      <div className="person-editor-head">
        <Avatar doc={doc} identity={p} context="post" assetUrl={assetUrl} />
        <div className="ellipsis">
          <b>{p.displayName}</b>
          <div className="small muted ellipsis" title={p.originalName}>
            {p.displayName !== p.originalName ? `원래 이름: ${p.originalName} · ` : ""}
            {count}개 항목
          </div>
        </div>
      </div>
      <label className="field">
        <span>표시 이름</span>
        <input value={p.displayName} disabled={ro} onChange={(e) => editor.apply((d) => C.updateIdentity(d, id, { displayName: e.target.value }), `idn-name:${id}`)} />
      </label>
      <label className="field">
        <span>소개</span>
        <input value={p.description} disabled={ro} onChange={(e) => editor.apply((d) => C.updateIdentity(d, id, { description: e.target.value }), `idn-desc:${id}`)} />
      </label>
      {p.displayName !== p.originalName || p.description !== p.originalDescription ? (
        <button type="button" className="ui-link small" disabled={ro} onClick={() => editor.apply((d) => C.updateIdentity(d, id, { displayName: p.originalName, description: p.originalDescription }))}>
          원래 이름·소개로
        </button>
      ) : null}

      <div className="field">
        <span>인장</span>
        <div className="row-actions">
          <button type="button" className="ui-btn ui-btn-small" disabled={ro} onClick={uploadAvatar}>
            <Icon name="upload" size={14} /> 이미지 바꾸기
          </button>
          {p.avatarAssetId ? (
            <button type="button" className="ui-btn ui-btn-small" disabled={ro} onClick={() => editor.apply((d) => C.updateIdentity(d, id, { avatarAssetId: null }))}>
              인장 빼기
            </button>
          ) : null}
        </div>
      </div>
      <Segmented<AvatarShape | "doc">
        label="이 인물의 인장 모양"
        value={p.style?.avatarShape ?? "doc"}
        disabled={ro}
        options={[
          ["doc", "문서 설정"],
          ["circle", "원형"],
          ["square", "사각"],
          ["rounded", "둥근 사각"],
        ]}
        onChange={(v) => setStyle({ avatarShape: v === "doc" ? undefined : v })}
      />
      {p.avatarAssetId ? (
        <fieldset className="field crop" disabled={ro}>
          <legend>인장 자르기 (표시만 · 원본 유지)</legend>
          <Slider label="확대" value={crop.zoom} min={1} max={3} step={0.05} unit="배" defaultValue={1} onChange={(v) => setStyle({ avatarCrop: { ...crop, zoom: v } }, `crop:${id}`)} />
          <Slider label="가로 위치" value={crop.x} min={-50} max={50} unit="%" defaultValue={0} onChange={(v) => setStyle({ avatarCrop: { ...crop, x: v } }, `crop:${id}`)} />
          <Slider label="세로 위치" value={crop.y} min={-50} max={50} unit="%" defaultValue={0} onChange={(v) => setStyle({ avatarCrop: { ...crop, y: v } }, `crop:${id}`)} />
          {p.style?.avatarCrop ? (
            <button type="button" className="ui-link small" onClick={() => setStyle({ avatarCrop: undefined })}>
              자르기 되돌리기
            </button>
          ) : null}
        </fieldset>
      ) : null}

      <div className="field-row">
        <span>이름 색</span>
        <ColorPicker label="이름 색" value={p.color} onChange={(c) => editor.apply((d) => C.updateIdentity(d, id, { color: c }))} />
        <span>말풍선 색</span>
        <ColorPicker label="말풍선 색(말풍선형)" value={p.style?.bubbleColor ?? null} onChange={(c) => setStyle({ bubbleColor: c ?? undefined })} />
      </div>

      <div className="row-actions">
        <button type="button" className="ui-btn ui-btn-small" disabled={ro} aria-pressed={p.hidden} onClick={() => editor.apply((d) => C.updateIdentity(d, id, { hidden: !p.hidden }))}>
          <Icon name="eye" size={14} /> {p.hidden ? "다시 보이기" : "숨기기"}
        </button>
        <button type="button" className="ui-btn ui-btn-small" disabled={ro} aria-expanded={merge} onClick={() => setMerge(!merge)}>
          <Icon name="users" size={14} /> 다른 인물과 합치기
        </button>
      </div>
      <p className="small muted">숨기기는 보기·내보내기 필터이며 자료를 지우지 않습니다.</p>
      {merge ? (
        <label className="field">
          <span>"{p.displayName}"의 항목을 이 인물로 옮기고 합치기</span>
          <select
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              editor.apply((d) => C.mergeIdentities(d, id, e.target.value));
              setMerge(false);
            }}
          >
            <option value="">선택…</option>
            {doc.identityOrder
              .filter((x) => x !== id)
              .map((x) => (
                <option key={x} value={x}>
                  {doc.identities[x]?.displayName}
                </option>
              ))}
          </select>
        </label>
      ) : null}
    </section>
  );
}
