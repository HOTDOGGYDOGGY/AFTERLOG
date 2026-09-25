import * as C from "../../editor/commands";
import type { DocumentData } from "../../domain/types";
import type { StoredAsset } from "../../storage/db";
import { addAsset, deleteAsset } from "../../storage/repo";
import { pickFiles } from "../download";
import type { DocEditor } from "../useDocEditor";

function referencedAssetIds(docs: DocumentData[]): Set<string> {
  const s = new Set<string>();
  for (const d of docs) {
    for (const i of Object.values(d.identities)) if (i.avatarAssetId) s.add(i.avatarAssetId);
    for (const e of Object.values(d.entries))
      for (const b of [...e.blocks, ...e.originalBlocks, ...(e.excerpt ?? [])]) if (b.type === "image" && b.assetId) s.add(b.assetId);
  }
  return s;
}

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`);

export function AssetsPanel({
  editor,
  allDocs,
  assets,
  assetUrl,
  projectId,
  onAssetsChanged,
  onError,
}: {
  editor: DocEditor;
  allDocs: DocumentData[];
  assets: StoredAsset[];
  assetUrl(id: string): string | undefined;
  projectId: string;
  onAssetsChanged(): Promise<void>;
  onError(msg: string): void;
}) {
  const { doc } = editor;
  const ro = !!editor.readOnly;
  const missing: { entryId: string; blockIndex: number; ref?: string; who: string }[] = [];
  for (const e of Object.values(doc.entries)) {
    e.blocks.forEach((b, i) => {
      if (b.type === "image" && !b.assetId)
        missing.push({ entryId: e.id, blockIndex: i, ref: b.sourceRef, who: e.authorId ? doc.identities[e.authorId]?.displayName ?? "" : "" });
    });
  }
  const missingAvatars = doc.identityOrder.map((id) => doc.identities[id]).filter((p) => p && !p.avatarAssetId);
  const used = referencedAssetIds(allDocs);

  const linkMissing = async (entryId: string, blockIndex: number) => {
    const [f] = await pickFiles("image/png,image/jpeg,image/gif,image/webp", false);
    if (!f) return;
    try {
      const a = await addAsset(projectId, f, f.name);
      await onAssetsChanged();
      editor.apply((d) => C.setImageAsset(d, entryId, blockIndex, a.id));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="assets-panel">
      {missing.length ? (
        <section className="field">
          <span>확보되지 않은 이미지 {missing.length}개</span>
          <ul className="plain-list">
            {missing.map((m) => (
              <li key={`${m.entryId}:${m.blockIndex}`}>
                <span className="ellipsis" title={m.ref}>
                  {m.who ? `${m.who} · ` : ""}
                  {m.ref ?? "이미지"}
                </span>
                <button type="button" className="ui-btn ui-btn-small" disabled={ro} onClick={() => linkMissing(m.entryId, m.blockIndex)}>
                  파일 연결
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {missingAvatars.length ? (
        <p className="muted small">프로필 사진이 없는 인물 {missingAvatars.length}명: 인물 탭에서 사진을 눌러 올릴 수 있습니다.</p>
      ) : null}

      <section className="field">
        <span>저장된 이미지 {assets.length}개</span>
        <div className="asset-grid">
          {assets.map((a) => {
            const isUsed = used.has(a.id);
            return (
              <figure key={a.id} className={`asset${isUsed ? "" : " is-unused"}`} title={`${a.name} · ${fmtSize(a.size)}`}>
                <img src={assetUrl(a.id)} alt={a.name} loading="lazy" />
                <figcaption>
                  <span className="ellipsis">{a.name}</span>
                  {!isUsed ? (
                    <button
                      type="button"
                      className="ui-link small"
                      disabled={ro}
                      onClick={async () => {
                        await deleteAsset(a.id);
                        await onAssetsChanged();
                      }}
                    >
                      정리
                    </button>
                  ) : null}
                </figcaption>
              </figure>
            );
          })}
        </div>
        <small className="muted">어디에도 연결되지 않은 이미지에만 '정리'가 나타납니다.</small>
      </section>
    </div>
  );
}
