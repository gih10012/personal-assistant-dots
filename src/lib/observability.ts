/** Browser-safe projections, not an allow-list of actions the model may take. */
export type NativeState = { thread_id?: string; turn_id?: string; harness?: string; mode?: string; plan?: unknown; goal?: unknown };
export type ObservedTask = { id: string; parent_id: string | null; input: string; status: string; node: string | null; created: number; result: string | null; native?: NativeState };
export type ObservedProject = { id: string; title: string; status_counts: Record<string, number>; tasks: ObservedTask[] };
export type ProjectPage = { projects: ObservedProject[]; next_cursor: number; has_more: boolean; counts_scope: "page"; source: "task-ledger" };
export type Observation<T> = { state: "available"; data: T } | { state: "unavailable"; reason: string };
export type Observations = { sampled_at: number; projects: Observation<ProjectPage>; resources: Observation<Record<string, unknown>>; events: Observation<Record<string, unknown>> };

export const ACTIVE_TASK_STATUSES = new Set(["pending", "running", "waiting_auth", "waiting_backend", "waiting_children", "continuing", "paused"]);
export function projectMatches(project: ObservedProject, filter: "all" | "active" | "finished", query: string): boolean {
  const text = query.trim().toLocaleLowerCase();
  if (text && !`${project.title} ${project.id} ${project.tasks.map((task) => task.input).join(" ")}`.toLocaleLowerCase().includes(text)) return false;
  if (filter === "active") return project.tasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status));
  if (filter === "finished") return project.tasks.some((task) => ["completed", "failed", "needs_review"].includes(task.status));
  return true;
}
