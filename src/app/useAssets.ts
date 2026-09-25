import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredAsset } from "../storage/db";
import { listAssets } from "../storage/repo";

/** 프로젝트 자산 목록과 표시용 Blob URL. URL은 저장하지 않고 열 때마다 새로 만든다. */
export function useAssets(projectId: string | null) {
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const urls = useRef(new Map<string, string>());
  const [, bump] = useState(0);

  const reload = useCallback(async () => {
    const list = projectId ? await listAssets(projectId) : [];
    const next = new Map<string, string>();
    for (const a of list) next.set(a.id, urls.current.get(a.id) ?? URL.createObjectURL(a.blob));
    for (const [id, u] of urls.current) if (!next.has(id)) URL.revokeObjectURL(u);
    urls.current = next;
    setAssets(list);
    bump((x) => x + 1);
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(
    () => () => {
      for (const u of urls.current.values()) URL.revokeObjectURL(u);
      urls.current = new Map();
    },
    [projectId],
  );

  const url = useCallback((id: string) => urls.current.get(id), [assets]); // eslint-disable-line react-hooks/exhaustive-deps
  const getBlob = useCallback(async (id: string) => assets.find((a) => a.id === id)?.blob, [assets]);
  return { assets, url, getBlob, reload };
}
