/** Durable native-engine queue, independent of Next.js and model providers. */
import type { DatabaseSync } from "node:sqlite";

export type NativeStatus = { id: string; status: string; result: string | null };
export type NativeRequest = <T>(path: string, body: unknown) => Promise<T>;
export type QueueMessage = {
  dotId: string; conversationId: string; channelId: string | null;
  role: "dot" | "system"; text: string;
};
type QueueDot = { status: "idle" | "working" | "waiting" | "paused" };
type Job = {
  id: string; dot_id: string; conversation_id: string; channel_id: string | null;
  input: string; context: string; attempted: number; submitted: number; delivered: number; notice: string;
};
type Control = { dot_id: string; command: "pause" | "resume"; revision: string; blocked: number };
type QueueRepo = {
  getDot: (id: string) => QueueDot | null;
  updateDot: (id: string, patch: { status: QueueDot["status"] }) => unknown;
  addMessage: (message: QueueMessage) => unknown;
};
const terminal = (status: string) => ["completed", "failed", "needs_review"].includes(status);

export class MeshQueue {
  private conn: DatabaseSync;
  private repo: QueueRepo;
  private pumping = false;

  constructor(conn: DatabaseSync, repo: QueueRepo) {
    this.conn = conn;
    this.repo = repo;
    conn.exec(`CREATE TABLE IF NOT EXISTS mesh_jobs (
      id TEXT PRIMARY KEY, dot_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      input TEXT NOT NULL, context TEXT NOT NULL, submitted INTEGER NOT NULL DEFAULT 0,
      delivered INTEGER NOT NULL DEFAULT 0, channel_id TEXT, notice TEXT NOT NULL DEFAULT '', attempted INTEGER NOT NULL DEFAULT 0
    ); CREATE TABLE IF NOT EXISTS mesh_controls (
      dot_id TEXT PRIMARY KEY, command TEXT NOT NULL, revision TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0
    )`);
    const columns = conn.prepare("PRAGMA table_info(mesh_jobs)").all().map((row) => row.name);
    if (!columns.includes("channel_id")) conn.exec("ALTER TABLE mesh_jobs ADD COLUMN channel_id TEXT");
    if (!columns.includes("notice")) conn.exec("ALTER TABLE mesh_jobs ADD COLUMN notice TEXT NOT NULL DEFAULT ''");
    if (!columns.includes("attempted")) {
      conn.exec("ALTER TABLE mesh_jobs ADD COLUMN attempted INTEGER NOT NULL DEFAULT 0");
      // The old queue did not journal before HTTP. Its unsubmitted rows may
      // actually have been accepted remotely; do not assume they are effect-free.
      conn.exec("UPDATE mesh_jobs SET attempted=1");
    }
  }

  stage(job: { dotId: string; conversationId: string; channelId?: string | null; input: string; context: unknown }): string {
    const id = crypto.randomUUID().replaceAll("-", "");
    this.conn.prepare("INSERT INTO mesh_jobs(id,dot_id,conversation_id,channel_id,input,context) VALUES(?,?,?,?,?,?)")
      .run(id, job.dotId, job.conversationId, job.channelId ?? null, job.input, JSON.stringify(job.context));
    if (this.repo.getDot(job.dotId)?.status !== "paused") this.repo.updateDot(job.dotId, { status: "working" });
    return id;
  }

  restoreStatuses() {
    const dots = this.conn.prepare("SELECT DISTINCT dot_id FROM mesh_jobs WHERE delivered=0").all();
    for (const row of dots) {
      const dotId = String(row.dot_id);
      if (this.repo.getDot(dotId)?.status !== "paused") this.repo.updateDot(dotId, { status: "working" });
    }
  }

  /** Pause holds local submissions immediately. Resume stays paused until confirmed. */
  requestControl(dotId: string, command: "pause" | "resume") {
    if (!this.repo.getDot(dotId)) throw new Error("No such dot");
    if (!this.pending(dotId).some((job) => job.attempted)) {
      // No remote effect exists to fence. Offline local holds are immediately
      // effective, and resuming only releases the durable local queue.
      this.conn.prepare("DELETE FROM mesh_controls WHERE dot_id=?").run(dotId);
      this.repo.updateDot(dotId, { status: command === "pause" ? "paused" : this.pending(dotId).length ? "working" : "idle" });
      return;
    }
    this.conn.prepare(`INSERT INTO mesh_controls(dot_id,command,revision,blocked) VALUES(?,?,?,0)
      ON CONFLICT(dot_id) DO UPDATE SET command=excluded.command,revision=excluded.revision,blocked=0`)
      .run(dotId, command, crypto.randomUUID());
    this.repo.updateDot(dotId, { status: "paused" });
  }

  hasPendingControl(dotId: string): boolean {
    return Boolean(this.conn.prepare("SELECT 1 FROM mesh_controls WHERE dot_id=?").get(dotId));
  }

  /** Public, credential-free state. A configured file is not a verified model login. */
  unavailable(reason: "not_configured" | "invalid_config") {
    for (const job of this.pending()) {
      if (!this.repo.getDot(job.dot_id)) continue;
      this.notice(job, reason, reason === "not_configured"
        ? "Task queued locally. Connect the native runtime with a private DOTS_MESH_CONFIG file; no new OpenAI API key is required."
        : "Task queued locally. The native runtime config is invalid or not private. Check the server-side config; no credentials are sent to this interface.");
      if (this.repo.getDot(job.dot_id)?.status !== "paused") this.repo.updateDot(job.dot_id, { status: "waiting" });
    }
  }

  async pump(request: NativeRequest) {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const controls = this.conn.prepare("SELECT * FROM mesh_controls WHERE blocked=0").all() as Control[];
      for (const control of controls) await this.applyControl(control, request);
      // A failing task does not prevent other dots from being submitted or observed.
      for (const job of this.pending()) {
        const dot = this.repo.getDot(job.dot_id);
        if (!dot) continue;
        try {
          if (!job.submitted) {
            if (dot.status === "paused" || this.hasPendingControl(job.dot_id)) continue;
            this.conn.prepare("UPDATE mesh_jobs SET attempted=1 WHERE id=?").run(job.id);
            await request("/v1/tasks", { id: job.id, input: job.input, context: JSON.parse(job.context) });
            this.conn.prepare("UPDATE mesh_jobs SET submitted=1 WHERE id=?").run(job.id);
          }
          // Observe already-submitted jobs even while paused. Pausing is not an undo,
          // and an already-settled result must not disappear from its original chat.
          const task = await request<NativeStatus>("/v1/task/status", { id: job.id });
          if (task.id !== job.id) throw new Error("mesh_task_identity_mismatch");
          this.conn.prepare("UPDATE mesh_jobs SET notice='' WHERE id=?").run(job.id);
          if (terminal(task.status)) this.deliver(job, task);
          else if (this.repo.getDot(job.dot_id)?.status !== "paused")
            this.repo.updateDot(job.dot_id, { status: task.status.startsWith("waiting_") ? "waiting" : "working" });
        } catch {
          this.notice(job, "unavailable", "Native runtime unavailable. This task is still durable; already-submitted work may still be running. No alternate paid API was called.");
          if (this.repo.getDot(job.dot_id)?.status !== "paused") this.repo.updateDot(job.dot_id, { status: "waiting" });
        }
      }
    } finally { this.pumping = false; }
  }

  private pending(dotId?: string): Job[] {
    return (dotId
      ? this.conn.prepare("SELECT * FROM mesh_jobs WHERE dot_id=? AND delivered=0 ORDER BY rowid").all(dotId)
      : this.conn.prepare("SELECT * FROM mesh_jobs WHERE delivered=0 ORDER BY rowid").all()) as Job[];
  }

  private notice(job: Job, code: string, text: string) {
    const current = this.conn.prepare("SELECT notice,delivered FROM mesh_jobs WHERE id=?").get(job.id);
    if (!current || current.delivered || current.notice === code) return;
    this.repo.addMessage({ dotId: job.dot_id, conversationId: job.conversation_id, channelId: job.channel_id, role: "system", text });
    this.conn.prepare("UPDATE mesh_jobs SET notice=? WHERE id=?").run(code, job.id);
  }

  private deliver(job: Job, task: NativeStatus) {
    this.conn.exec("BEGIN IMMEDIATE");
    try {
      // Recheck inside the transaction; two app processes cannot display two results.
      const current = this.conn.prepare("SELECT delivered FROM mesh_jobs WHERE id=?").get(job.id);
      if (current && !current.delivered) {
        this.repo.addMessage({ dotId: job.dot_id, conversationId: job.conversation_id, channelId: job.channel_id,
          role: task.status === "completed" ? "dot" : "system", text: task.result || `Task state: ${task.status}` });
        this.conn.prepare("UPDATE mesh_jobs SET delivered=1 WHERE id=?").run(job.id);
      }
      this.conn.exec("COMMIT");
    } catch (error) { this.conn.exec("ROLLBACK"); throw error; }
    if (this.repo.getDot(job.dot_id)?.status !== "paused")
      this.repo.updateDot(job.dot_id, { status: this.pending(job.dot_id).length ? "working" : "idle" });
  }

  private async applyControl(control: Control, request: NativeRequest) {
    if (!this.repo.getDot(control.dot_id)) return;
    let currentJob: Job | undefined;
    try {
      for (const job of this.pending(control.dot_id)) {
        if (!job.attempted) continue;
        currentJob = job;
        const task = await request<NativeStatus>("/v1/task/status", { id: job.id });
        if (task.id !== job.id) throw new Error("mesh_task_identity_mismatch");
        this.conn.prepare("UPDATE mesh_jobs SET submitted=1 WHERE id=?").run(job.id);
        if (terminal(task.status)) { this.deliver(job, task); continue; }
        const result = await request<NativeStatus>("/v1/task/control", { id: job.id, command: control.command });
        if (result.id !== job.id || (control.command === "pause" ? result.status !== "paused" : result.status === "paused"))
          throw new Error("mesh_control_not_acknowledged");
      }
      const removed = this.conn.prepare("DELETE FROM mesh_controls WHERE dot_id=? AND revision=?")
        .run(control.dot_id, control.revision).changes;
      // Do not overwrite a newer pause/resume intent issued during this await.
      if (removed && control.command === "resume")
        this.repo.updateDot(control.dot_id, { status: this.pending(control.dot_id).length ? "working" : "idle" });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
      const rejected = [400, 403, 404, 409].includes(status);
      if (rejected) this.conn.prepare("UPDATE mesh_controls SET blocked=1 WHERE dot_id=? AND revision=?")
        .run(control.dot_id, control.revision);
      if (currentJob) this.notice(currentJob, rejected ? "control_rejected" : "control_pending", rejected
        ? "Native runtime declined this control request. The dot remains locally paused; review the task before retrying. Resume has not been confirmed."
        : "Control request saved, but the native runtime has not confirmed it. The dot remains locally paused; already-started work may still be running.");
    }
  }
}
