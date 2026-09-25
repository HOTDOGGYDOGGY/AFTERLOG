import { useState } from "react";
import * as C from "../../editor/commands";
import { ColorPicker } from "../../components/ColorPicker";
import { addAsset } from "../../storage/repo";
import { pickFiles } from "../download";
import type { DocEditor } from "../useDocEditor";

export function PeoplePanel({
  editor,
  assetUrl,
  projectId,
  onAssetsChanged,
  onError,
}: {
  editor: DocEditor;
  assetUrl(id: string): string | undefined;
  projectId: string;
  onAssetsChanged(): Promise<void>;
  onError(msg: string): void;
}) {
  const { doc } = editor;
  const ro = !!editor.readOnly;
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const e of Object.values(doc.entries)) if (e.authorId) counts.set(e.authorId, (counts.get(e.authorId) ?? 0) + 1);

  const uploadAvatar = async (id: string) => {
    const [f] = await pickFiles("image/png,image/jpeg,image/gif,image/webp", false);
    if (!f) return;
    try {
      const a = await addAsset(projectId, f, f.name);
      await onAssetsChanged();
      editor.apply((d) => C.updateIdentity(d, id, { avatarAssetId: a.id }));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="people-list">
      <p className="muted small">표시 이름을 바꿔도 원래 이름은 보존됩니다. 숨기기는 보기 필터이며 자료를 지우지 않습니다.</p>
      {doc.identityOrder.map((id) => {
        const p = doc.identities[id];
        if (!p) return null;
        const url = p.avatarAssetId ? assetUrl(p.avatarAssetId) : undefined;
        return (
          <div key={id} className={`person${p.hidden ? " is-hidden" : ""}`}>
            <button type="button" className="person-avatar" disabled={ro} onClick={() => uploadAvatar(id)} aria-label={`${p.displayName} 프로필 사진 바꾸기`} title="프로필 사진 바꾸기">
              {url ? <img src={url} alt="" /> : <span>{Array.from(p.displayName)[0] ?? "?"}</span>}
            </button>
            <div className="person-fields">
              <input
                aria-label="표시 이름"
                value={p.displayName}
                disabled={ro}
                onChange={(e) => editor.apply((d) => C.updateIdentity(d, id, { displayName: e.target.value }), `idn-name:${id}`)}
              />
              <input
                aria-label="설명"
                className="small"
                value={p.description}
                placeholder="설명"
                disabled={ro}
                onChange={(e) => editor.apply((d) => C.updateIdentity(d, id, { description: e.target.value }), `idn-desc:${id}`)}
              />
              <div className="person-meta">
                <span className="muted small" title={p.originalName}>
                  {p.displayName !== p.originalName ? `원래: ${p.originalName} · ` : ""}
                  {counts.get(id) ?? 0}개 항목
                </span>
              </div>
            </div>
            <div className="person-actions">
              <ColorPicker label="이름 색" value={p.color} onChange={(c) => editor.apply((d) => C.updateIdentity(d, id, { color: c }))} />
              <button
                type="button"
                className="ui-icon-btn"
                disabled={ro}
                aria-pressed={p.hidden}
                aria-label={p.hidden ? `${p.displayName} 보이기` : `${p.displayName} 숨기기`}
                title={p.hidden ? "보이기" : "숨기기"}
                onClick={() => editor.apply((d) => C.updateIdentity(d, id, { hidden: !p.hidden }))}
              >
                {p.hidden ? "◌" : "◉"}
              </button>
              <button
                type="button"
                className="ui-icon-btn"
                disabled={ro}
                aria-label="다른 인물과 합치기"
                title="다른 인물과 합치기"
                onClick={() => setMergeFrom(mergeFrom === id ? null : id)}
              >
                ⇄
              </button>
            </div>
            {mergeFrom === id ? (
              <div className="person-merge">
                <label className="field">
                  <span>"{p.displayName}"의 항목을 이 인물로 옮기고 합치기</span>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      editor.apply((d) => C.mergeIdentities(d, id, e.target.value));
                      setMergeFrom(null);
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
              </div>
            ) : null}
            {p.displayName !== p.originalName || p.description !== p.originalDescription ? (
              <button
                type="button"
                className="ui-link small"
                disabled={ro}
                onClick={() => editor.apply((d) => C.updateIdentity(d, id, { displayName: p.originalName, description: p.originalDescription }))}
              >
                원래 이름·설명으로
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
