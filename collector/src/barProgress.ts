// 밴드 화면 저장 막대에 보여 줄 짧은 진행 요약(디자인 참고 09: 막대만 두지 않고 확보한 글·댓글·이미지 수를 숫자로).
// 관리 창과 같은 기준(결과에서 뺀 글 제외, 끝난 과제만)으로 센다. 글 내용·이름은 넣지 않는다.
import type { Capture, Job, Task } from "./db";

export interface BarProgress {
  state: "running" | "paused" | "finished";
  text: string;
}

const STATE_TEXT: Record<BarProgress["state"], string> = { running: "수집 중", paused: "멈춤", finished: "끝남" };

export function barProgress(job: Pick<Job, "status">, tasks: Pick<Task, "kind" | "status">[], caps: Pick<Capture, "excluded" | "commentsFound">[], imagesStored: number): BarProgress {
  const state: BarProgress["state"] = job.status === "running" ? "running" : job.status === "finished" ? "finished" : "paused";
  const done = (t: Pick<Task, "status">) => t.status === "succeeded" || t.status === "partial" || t.status === "failed" || t.status === "skipped";
  const posts = tasks.filter((t) => t.kind === "post");
  const profiles = tasks.filter((t) => t.kind === "profile");
  const kept = caps.filter((c) => !c.excluded);
  const parts = [STATE_TEXT[state]];
  if (posts.length) parts.push(`글 ${posts.filter(done).length}/${posts.length}`);
  else if (tasks.some((t) => t.kind === "list" && !done(t))) parts.push("글 목록 확인 중");
  if (kept.length || posts.length) parts.push(`댓글 ${kept.reduce((n, c) => n + (c.commentsFound || 0), 0).toLocaleString()}`);
  if (profiles.length) parts.push(`프로필 ${profiles.filter(done).length}/${profiles.length}`);
  parts.push(`이미지 ${imagesStored.toLocaleString()}`);
  const failed = tasks.filter((t) => t.status === "failed").length;
  if (failed) parts.push(`실패 ${failed}`);
  return { state, text: parts.join(" · ") };
}
