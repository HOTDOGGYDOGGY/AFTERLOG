import { isCaptureReport } from "../../archive/captureReport";

const OUTCOME = { complete: "선택 범위 확인 완료", partial: "일부 미확보", unknownEnd: "끝 확인 불가" } as const;
const COVERAGE = { exhausted: "끝까지 확인", partial: "일부만 탐색", unknown: "끝 확인 불가", notRequested: "선택 안 함", unsupported: "지원 안 함" } as const;

/** 수집 확장이 넣은 보고서 요약 */
export function CaptureReports({ reports }: { reports: unknown[] }) {
  const list = reports.filter(isCaptureReport);
  if (!list.length) return null;
  return (
    <section className="field">
      <span>수집 보고서</span>
      {list.map((r) => (
        <div key={r.jobId + r.exportedAt} className="report">
          <p className="small">
            <b>{OUTCOME[r.outcome]}</b> · 수집기 v{r.collectorVersion} · {new Date(r.exportedAt).toLocaleString()}
          </p>
          <ul className="small plain-list">
            {r.lists.map((l, i) => (
              <li key={i}>
                목록에서 글 {l.found}개 찾음 · {COVERAGE[l.coverage]}
              </li>
            ))}
            <li>
              글 {r.posts.discovered}개 중 {r.posts.captured}개 확보 · 실패 {r.posts.failed} · 건너뜀 {r.posts.skipped}
              {r.posts.outOfRange ? ` (기간 밖 ${r.posts.outOfRange})` : ""}
            </li>
            <li>
              이미지 원본 {r.assets.stored} · 축소본만 {r.assets.thumbnailOnly} · 실패 {r.assets.failed}
            </li>
          </ul>
          {r.posts.items.some((i) => i.status === "failed" || i.status === "partial") ? (
            <details className="small">
              <summary>다시 확인할 글</summary>
              <ul>
                {r.posts.items
                  .filter((i) => i.status === "failed" || i.status === "partial")
                  .map((i) => (
                    <li key={i.url}>
                      {i.title ?? i.url} — {i.error ?? i.status}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
          <details className="small muted">
            <summary>아직 수집하지 못하는 것</summary>
            <ul>
              {r.unsupported.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </details>
        </div>
      ))}
    </section>
  );
}
