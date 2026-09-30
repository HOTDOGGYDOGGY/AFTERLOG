// 밴드 사진첩 레이어(디자인 참고 05): 위에 짧은 인물·종류 필터, 아래 촘촘한 정사각 격자. 누르면 원래 비율로 크게 보고 원래 위치로 이동한다.
import { useMemo, useState } from "react";
import { filterAlbum, PLACE_TEXT, type Album, type AlbumPlace } from "./album";
import { Lightbox, type LightboxItem } from "./Lightbox";

type Kind = "all" | "posts" | "profiles";
const isProfile = (p: AlbumPlace) => !!p.profileId;
const short = (t: string) => (t.length > 26 ? `${t.slice(0, 25)}…` : t);

export function AlbumView({ album, assetUrl, onOpenPlace }: { album: Album; assetUrl(id: string): string | undefined; onOpenPlace(p: AlbumPlace): void }) {
  const [who, setWho] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [open, setOpen] = useState<number | null>(null);
  const hasProfiles = album.items.some((it) => it.places.some(isProfile));
  const hasPosts = album.items.some((it) => it.places.some((p) => !isProfile(p)));
  const shown = useMemo(() => {
    const byWho = filterAlbum(album.items, who);
    if (kind === "all") return byWho;
    return byWho.filter((it) => it.places.some((p) => (kind === "profiles" ? isProfile(p) : !isProfile(p))));
  }, [album.items, who, kind]);
  const lbItems: LightboxItem[] = shown.map((it) => {
    const first = it.places[0];
    const links = it.places.slice(0, 3).map((p) => ({
      label: it.places.length > 1 ? `${short(p.label)} →` : p.profileId ? "프로필 열기 →" : `원래 ${PLACE_TEXT[p.kind]}로 →`,
      onClick: () => {
        setOpen(null);
        onOpenPlace(p);
      },
    }));
    return {
      url: assetUrl(it.assetId) ?? "",
      caption: `${first.label}${first.who && !first.label.startsWith(first.who) ? ` · ${first.who}` : ""}${first.time ? ` · ${first.time}` : ""}`,
      note: it.places.length > 1 ? `같은 파일이 ${it.places.length}곳에 쓰임${it.places.length > 3 ? `(처음 3곳만 바로가기)` : ""}` : undefined,
      links,
    };
  });
  return (
    <section className="album-view" aria-label="사진첩">
      <header className="album-head">
        <h2>
          사진첩 <span className="muted">{album.items.length}장</span>
        </h2>
        <p className="small muted">
          보관한 글·댓글·프로필의 사진입니다. 같은 파일은 한 장으로 모으고 쓰인 곳을 모두 남깁니다.
          {album.missing ? ` 파일을 확보하지 못한 사진 ${album.missing}장은 여기 없고, 원래 자리에 '미확보'로 보입니다.` : ""}
        </p>
      </header>
      {hasProfiles && hasPosts ? (
        <div className="album-filter" role="group" aria-label="종류">
          {(
            [
              ["all", "전체"],
              ["posts", "글·댓글"],
              ["profiles", "프로필"],
            ] as [Kind, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {album.people.length > 1 ? (
        <div className="album-filter album-people" role="group" aria-label="인물">
          <button type="button" aria-pressed={!who} className={!who ? "is-on" : ""} onClick={() => setWho(null)}>
            모든 인물
          </button>
          {album.people.map((p) => (
            <button key={p.name} type="button" aria-pressed={who === p.name} className={who === p.name ? "is-on" : ""} onClick={() => setWho(who === p.name ? null : p.name)}>
              {p.name} <small>{p.count}</small>
            </button>
          ))}
        </div>
      ) : null}
      {who || kind !== "all" ? (
        <p className="small muted album-count">
          전체 {album.items.length}장 중 {shown.length}장 표시
        </p>
      ) : null}
      {shown.length ? (
        <div className="album-grid">
          {shown.map((it, i) => {
            const u = assetUrl(it.assetId);
            return (
              <button key={it.assetId} type="button" className="album-item" onClick={() => setOpen(i)} aria-label={`${it.places[0].label} 사진 크게 보기`} title={it.places.map((p) => p.label).join("\n")}>
                {u ? <img src={u} alt="" loading="lazy" /> : null}
                {it.places.length > 1 ? <small>{it.places.length}곳</small> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted album-empty">{album.items.length ? "조건에 맞는 사진이 없습니다." : "보관한 사진이 없습니다."}</p>
      )}
      {open !== null && lbItems[open] ? <Lightbox items={lbItems} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
