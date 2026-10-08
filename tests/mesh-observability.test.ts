import assert from "node:assert/strict";
import { test } from "node:test";
import { projectMatches, type ObservedProject } from "../src/lib/observability.ts";
import { safeCapabilityProjection } from "../src/server/capability-projection.ts";

const project: ObservedProject = { id: "learning", title: "安全学习", status_counts: { running: 1, completed: 1 }, tasks: [
  { id: "parent", parent_id: null, input: "了解这个终端可以做什么", status: "running", node: "laptop", created: 1, result: null },
  { id: "child", parent_id: "parent", input: "发现并验证一个新 tool", status: "completed", node: "cloud", created: 2, result: "验证通过" },
] };
test("views filter the same factual project without changing task ownership or status", () => {
  const before = JSON.stringify(project);
  assert.equal(projectMatches(project, "active", "终端"), true);
  assert.equal(projectMatches(project, "finished", "tool"), true);
  assert.equal(projectMatches(project, "all", "不存在"), false);
  assert.equal(JSON.stringify(project), before);
});
test("finished-only tasks are not represented as active", () => {
  assert.equal(projectMatches({ ...project, tasks: [project.tasks[1]] }, "active", ""), false);
  assert.equal(projectMatches({ ...project, tasks: [] }, "finished", ""), false);
});
test("open capability kinds/metrics survive projection; authentication and URL secrets do not", () => {
  const projected = safeCapabilityProjection({ capabilities: [{ kind: "quantum.future", spec: {
    tokens_per_second: 42, environment: "offline", endpoint: "https://u:password@example.test/path?token=secret#private",
    access_token: "private", cookie: "private", secret_fields_redacted: true,
  } }], checkpoint: { sensitive: "private" } });
  assert.deepEqual(projected, { capabilities: [{ kind: "quantum.future", spec: {
    tokens_per_second: 42, environment: "offline", endpoint: "https://example.test/path", secret_fields_redacted: true,
  } }] });
  assert.throws(() => safeCapabilityProjection([]), /invalid/);
});
