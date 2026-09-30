// 옆칸의 '보관한 인물 프로필' 목록(디자인 참고 02: 얼굴·이름·상태 한 줄). 누르면 프로필 보기(구조 자료, 없으면 보관 당시 화면)를 연다.
import { ProfileFace, profileRowText, type ProfileEntry } from "./ProfileView";

export function ProfileSnapshots({
  profiles,
  onOpen,
  assetUrl,
  assetIdBySha,
}: {
  profiles: ProfileEntry[];
  onOpen(id: string): void;
  assetUrl(id: string): string | undefined;
  assetIdBySha(sha: string): string | undefined;
}) {
  if (!profiles.length) return null;
  return (
    <section className="profile-snapshots" aria-label="보관한 인물 프로필">
      <b>보관한 인물 프로필 {profiles.length}</b>
      <ul>
        {profiles.map((p) => (
          <li key={p.id}>
            <button type="button" className="pv-person-row" onClick={() => onOpen(p.id)} title={p.record?.profileUrl ?? p.snapshot?.sourceUrl}>
              <ProfileFace entry={p} assetUrl={assetUrl} assetIdBySha={assetIdBySha} size={32} />
              <span className="pv-person-text">
                <span className="ellipsis">{p.name}</span>
                <small className="muted ellipsis">{profileRowText(p)}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
