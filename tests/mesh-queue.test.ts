import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { MeshQueue, type NativeRequest, type QueueMessage } from "../src/server/mesh-queue.ts";
import { MeshAuthorityError } from "../src/server/mesh-client.ts";

function fixture(t: TestContext) {
  const conn = new DatabaseSync(":memory:");
  t.after(() => conn.close());
  conn.exec(`CREATE TABLE test_dots(id TEXT PRIMARY KEY,status TEXT);
    INSERT INTO test_dots VALUES('leader','idle'),('other','idle');
    CREATE TABLE test_messages(dot_id TEXT,conversation_id TEXT,channel_id TEXT,role TEXT,text TEXT)`);
  const repo = {
    getDot(id: string) {
      return (conn.prepare("SELECT status FROM test_dots WHERE id=?").get(id) ?? null) as
        { status: "idle" | "working" | "waiting" | "paused" } | null;
    },
    updateDot(id: string, patch: { status: string }) {
      conn.prepare("UPDATE test_dots SET status=? WHERE id=?").run(patch.status, id);
    },
    addMessage(message: QueueMessage) {
      conn.prepare("INSERT INTO test_messages VALUES(?,?,?,?,?)")
        .run(message.dotId, message.conversationId, message.channelId, message.role, message.text);
    },
  };
  return {
    conn, repo, queue: new MeshQueue(conn, repo),
    messages: () => conn.prepare("SELECT * FROM test_messages").all(),
    job: (id: string) => conn.prepare("SELECT * FROM mesh_jobs WHERE id=?").get(id)!,
    status: (id = "leader") => repo.getDot(id)?.status,
  };
}

const request = (handler: (path: string, body: Record<string, unknown>) => unknown | Promise<unknown>): NativeRequest =>
  async <T>(path: string, body: unknown) => await handler(path, body as Record<string, unknown>) as T;
const stage = (queue: MeshQueue, dotId = "leader", conversationId = "chat-1", channelId?: string) =>
  queue.stage({ dotId, conversationId, channelId, input: "a text task", context: { session_scope: `leader:${dotId}` } });

test("lost submission response resends immutable ID/payload after a process restart", async (t) => {
  const f = fixture(t);
  const context = { session_scope: "leader:leader", memories: ["original"] };
  const id = f.queue.stage({ dotId: "leader", conversationId: "chat-1", input: "task", context });
  context.memories.push("later edit");
  const submissions: unknown[] = [];
  const authority = request((path, body) => {
    if (path === "/v1/tasks") {
      submissions.push(structuredClone(body));
      if (submissions.length === 1) throw new Error("response lost AFTER authority accepted");
      return { id: body.id };
    }
    return { id: body.id, status: "completed", result: "real result" };
  });
  await f.queue.pump(authority);
  assert.equal(f.job(id).submitted, 0);
  assert.equal(f.job(id).attempted, 1);
  assert.equal(f.status(), "waiting");
  const restarted = new MeshQueue(f.conn, f.repo);
  restarted.restoreStatuses();
  assert.equal(f.status(), "working");
  await restarted.pump(authority);
  assert.deepEqual(submissions[0], submissions[1]);
  assert.deepEqual(submissions[0], { id, input: "task", context: { session_scope: "leader:leader", memories: ["original"] } });
  assert.equal(f.job(id).delivered, 1);
  await new MeshQueue(f.conn, f.repo).pump(authority);
  assert.equal(f.messages().filter((message) => message.role === "dot").length, 1);
  assert.equal(f.status(), "idle");
});

test("completed results route to original conversation and channel, not current chat", async (t) => {
  const f = fixture(t);
  const channelJob = stage(f.queue, "leader", "channel-work", "team");
  const chatJob = stage(f.queue, "leader", "chat-2");
  await f.queue.pump(request((_path, body) => ({ id: body.id, status: "completed", result: String(body.id) })));
  assert.deepEqual(f.messages().map((message) => [message.conversation_id, message.channel_id, message.text]),
    [["channel-work", "team", channelJob], ["chat-2", null, chatJob]]);
  assert.equal(f.status(), "idle");
});

test("missing or invalid config is explicit and durable, without repeated notices", (t) => {
  const f = fixture(t);
  const id = stage(f.queue);
  f.queue.unavailable("not_configured");
  f.queue.unavailable("not_configured");
  assert.equal(f.messages().length, 1);
  assert.match(String(f.messages()[0].text), /no new OpenAI API key/i);
  assert.equal(f.job(id).submitted, 0);
  assert.equal(f.job(id).delivered, 0);
  assert.equal(f.status(), "waiting");
  f.queue.unavailable("invalid_config");
  assert.equal(f.messages().length, 2);
});

test("one task outage does not starve a different dot", async (t) => {
  const f = fixture(t);
  const broken = stage(f.queue);
  const healthy = stage(f.queue, "other");
  await f.queue.pump(request((_path, body) => {
    if (body.id === broken) throw new Error("unavailable");
    return { id: healthy, status: "completed", result: "other dot completed" };
  }));
  assert.equal(f.job(broken).delivered, 0);
  assert.equal(f.job(healthy).delivered, 1);
  assert.equal(f.status("other"), "idle");
});

test("offline pause stops local submissions and offline resume only releases queue", async (t) => {
  const f = fixture(t);
  const id = stage(f.queue);
  f.queue.requestControl("leader", "pause");
  assert.equal(f.status(), "paused");
  assert.equal(f.queue.hasPendingControl("leader"), false);
  let calls = 0;
  await f.queue.pump(request(() => { calls++; throw new Error("must not call"); }));
  assert.equal(calls, 0);
  f.queue.requestControl("leader", "resume");
  f.queue.unavailable("not_configured");
  assert.equal(f.status(), "waiting");
  assert.equal(f.job(id).submitted, 0);
});

test("remote pause intent survives restart and never claims stopped on network failure", async (t) => {
  const f = fixture(t);
  const id = stage(f.queue);
  await f.queue.pump(request((_path, body) => ({ id: body.id, status: "running", result: null })));
  f.queue.requestControl("leader", "pause");
  await f.queue.pump(request((path, body) => {
    if (path === "/v1/task/control") throw new Error("unknown effect");
    return { id: body.id, status: "running", result: null };
  }));
  assert.equal(f.queue.hasPendingControl("leader"), true);
  assert.equal(f.status(), "paused");
  assert.match(String(f.messages()[0].text), /has not confirmed/);
  const restarted = new MeshQueue(f.conn, f.repo);
  const commands: unknown[] = [];
  await restarted.pump(request((path, body) => {
    if (path === "/v1/task/control") commands.push(body);
    return { id: body.id, status: "paused", result: null };
  }));
  assert.deepEqual(commands, [{ id, command: "pause" }]);
  assert.equal(restarted.hasPendingControl("leader"), false);
  assert.equal(f.status(), "paused");
});

test("lost submission acknowledgement is not mistaken for a local-only task when pausing", async (t) => {
  const f = fixture(t);
  const id = stage(f.queue);
  await f.queue.pump(request(() => { throw new Error("accepted remotely, acknowledgement lost"); }));
  assert.equal(f.job(id).submitted, 0);
  assert.equal(f.job(id).attempted, 1);
  f.queue.requestControl("leader", "pause");
  assert.equal(f.queue.hasPendingControl("leader"), true);
  const calls: string[] = [];
  await f.queue.pump(request((path, body) => {
    calls.push(path);
    return { id: body.id, status: path === "/v1/task/control" ? "paused" : "running", result: null };
  }));
  assert.equal(calls.includes("/v1/tasks"), false); // never start a task just to pause it
  assert.equal(calls.includes("/v1/task/control"), true);
  assert.equal(f.queue.hasPendingControl("leader"), false);
  assert.equal(f.job(id).submitted, 1);
  assert.equal(f.status(), "paused");
});

test("authority rejects unsafe resume: stay paused, no success claim or automatic retry", async (t) => {
  const f = fixture(t);
  stage(f.queue);
  await f.queue.pump(request((_path, body) => ({ id: body.id, status: "running", result: null })));
  f.queue.requestControl("leader", "resume");
  let attempts = 0;
  const denied = request((path, body) => {
    if (path === "/v1/task/control") { attempts++; throw new MeshAuthorityError(409); }
    return { id: body.id, status: "paused", result: null };
  });
  await f.queue.pump(denied);
  await new MeshQueue(f.conn, f.repo).pump(denied);
  assert.equal(attempts, 1);
  assert.equal(f.status(), "paused");
  assert.equal(f.queue.hasPendingControl("leader"), true);
  assert.match(String(f.messages()[0].text), /Resume has not been confirmed/);
});

test("acknowledged resume stays working while task remains pending, not false idle", async (t) => {
  const f = fixture(t);
  stage(f.queue);
  await f.queue.pump(request((_path, body) => ({ id: body.id, status: "pending", result: null })));
  f.queue.requestControl("leader", "resume");
  assert.equal(f.status(), "paused");
  await f.queue.pump(request((_path, body) => ({ id: body.id, status: "pending", result: null })));
  assert.equal(f.queue.hasPendingControl("leader"), false);
  assert.equal(f.status(), "working");
});

test("pausing does not hide results that had already settled remotely", async (t) => {
  const f = fixture(t);
  const id = stage(f.queue);
  await f.queue.pump(request((_path, body) => ({ id: body.id, status: "running", result: null })));
  f.queue.requestControl("leader", "pause");
  await f.queue.pump(request((_path, body) => ({ id: body.id, status: "completed", result: "settled before fence" })));
  assert.equal(f.job(id).delivered, 1);
  assert.equal(f.status(), "paused");
  assert.equal(f.messages().filter((message) => message.role === "dot").length, 1);
});

test("older control response cannot override a newer owner intent", async (t) => {
  const f = fixture(t);
  stage(f.queue);
  await f.queue.pump(request((_path, body) => ({ id: body.id, status: "running", result: null })));
  f.queue.requestControl("leader", "pause");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const called = new Promise<void>((resolve) => { entered = resolve; });
  const inFlight = f.queue.pump(request(async (path, body) => {
    if (path === "/v1/task/control") { entered(); await gate; }
    return { id: body.id, status: path === "/v1/task/control" ? "paused" : "running", result: null };
  }));
  await called;
  f.queue.requestControl("leader", "resume");
  release();
  await inFlight;
  assert.equal(f.queue.hasPendingControl("leader"), true);
  assert.equal(f.status(), "paused");
  const commands: unknown[] = [];
  await f.queue.pump(request((path, body) => {
    if (path === "/v1/task/control") commands.push(body.command);
    return { id: body.id, status: "running", result: null };
  }));
  assert.deepEqual(commands, ["resume"]);
  assert.equal(f.status(), "working");
});

test("mismatched task response cannot be displayed as this task's result", async (t) => {
  const f = fixture(t);
  const id = stage(f.queue);
  await f.queue.pump(request(() => ({ id: "different-task", status: "completed", result: "incorrect" })));
  assert.equal(f.job(id).delivered, 0);
  assert.equal(f.messages().filter((message) => message.role === "dot").length, 0);
});

test("additive migration preserves original staged payload and adds safe defaults", (t) => {
  const conn = new DatabaseSync(":memory:");
  t.after(() => conn.close());
  conn.exec(`CREATE TABLE mesh_jobs(id TEXT PRIMARY KEY,dot_id TEXT NOT NULL,conversation_id TEXT NOT NULL,
    input TEXT NOT NULL,context TEXT NOT NULL,submitted INTEGER NOT NULL DEFAULT 0,delivered INTEGER NOT NULL DEFAULT 0);
    INSERT INTO mesh_jobs VALUES('original','leader','chat','input','{}',0,0)`);
  new MeshQueue(conn, { getDot: () => null, updateDot: () => {}, addMessage: () => {} });
  const row = conn.prepare("SELECT * FROM mesh_jobs WHERE id='original'").get()!;
  assert.equal(row.input, "input");
  assert.equal(row.context, "{}");
  assert.equal(row.channel_id, null);
  assert.equal(row.notice, "");
  assert.equal(row.attempted, 1); // legacy records may have an unknown HTTP outcome
});
