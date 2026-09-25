// 옆칸의 '보관한 인물 프로필' 목록. 누르면 프로필 보기(구조 자료, 없으면 보관 당시 화면)를 연다.
import type { ProfileEntry } from "./ProfileView";

export function ProfileSnapshots({ profiles, onOpen }: { profiles: ProfileEntry[]; onOpen(id: string): void }) {
  if (!profiles.length) return null;
  return (
    <section className="profile-snapshots" aria-label="보관한 인물 프로필">
      <b>보관한 인물 프로필 {profiles.length}</b>
      <ul>
        {profiles.map((p) => (
          <li key={p.id}>
            <button type="button" className="ui-link ellipsis" onClick={() => onOpen(p.id)} title={p.record?.profileUrl ?? p.snapshot?.sourceUrl}>
              {p.name}
            </button>
            <small className="muted">
              {p.record ? (p.record.stories.state === "collected" ? `스토리 ${p.record.stories.items.length}` : "") : "보관 화면만"}
              {p.record?.identity === "unconfirmed" ? " · 연결 미확인" : ""}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
