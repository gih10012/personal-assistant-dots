import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { test } from "node:test";
import { loadMeshConfig, meshRequest } from "../src/server/mesh-client.ts";

test("private config and token, no redirect-following or credential leakage", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "dots-mesh-test-"));
  const token = path.join(folder, "token");
  const configFile = path.join(folder, "config.json");
  fs.writeFileSync(token, "a".repeat(64), { mode: 0o600 });
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${"a".repeat(64)}`);
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "https://invalid.example/private" });
      response.end();
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ id: "durable-task" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    fs.writeFileSync(configFile, JSON.stringify({ control_url: `http://127.0.0.1:${address.port}`, token_file: token }), { mode: 0o600 });
    const config = loadMeshConfig(configFile);
    assert.deepEqual(await meshRequest(config, "/v1/tasks", { input: "test" }), { id: "durable-task" });
    await assert.rejects(meshRequest(config, "/redirect"), /mesh_authority_302/);
    assert.throws(() => meshRequest(config, "https://invalid.example/", {}), /mesh_origin_mismatch/);
    fs.chmodSync(configFile, 0o644);
    assert.throws(() => loadMeshConfig(configFile), /owned_private/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
