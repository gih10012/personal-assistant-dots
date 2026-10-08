import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { assertRequest, authenticateLogin, issueSession, loadWebAuth, requireSession, sessionCookie, verifySession, SESSION_COOKIE, SESSION_TTL, type WebAuthConfig } from "../src/server/web-auth-core.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const owner = "o".repeat(64), viewer = "v".repeat(64);
const config: WebAuthConfig = { origin: "http://127.0.0.1:3100", signing_secret: "a".repeat(64), owner_login_sha256: hash(owner), viewer_login_sha256: hash(viewer) };
function headers(role: "owner" | "viewer" = "owner") {
  return new Headers({ host: "127.0.0.1:3100", origin: config.origin, cookie: `${SESSION_COOKIE}=${issueSession(config, role)}` });
}
test("owner and viewer secrets select roles; arbitrary body role cannot elevate", () => {
  assert.equal(authenticateLogin(config, owner), "owner");
  assert.equal(authenticateLogin(config, viewer), "viewer");
  assert.equal(authenticateLogin(config, "bad"), null);
});
test("sessions expire, reject tampering and bind a bounded issued lifetime", () => {
  const token = issueSession(config, "owner", 1000);
  assert.equal(verifySession(config, token, 1001)?.role, "owner");
  assert.equal(verifySession(config, token, 1000 + SESSION_TTL), null);
  assert.equal(verifySession(config, token, 950), null);
  assert.equal(verifySession(config, `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`, 1001), null);
  assert.equal(verifySession({ ...config, signing_secret: "b".repeat(64) }, token, 1001), null);
});
test("viewer reads but may never mutate; anonymous has no reads", () => {
  assert.equal(requireSession(config, headers("viewer")).role, "viewer");
  assert.throws(() => requireSession(config, headers("viewer"), true), /read_only/);
  assert.equal(requireSession(config, headers(), true).role, "owner");
  const anonymous = headers(); anonymous.delete("cookie");
  assert.throws(() => requireSession(config, anonymous), /login_required/);
});
test("Host, Origin, same-site attacks and missing write origin are rejected", () => {
  const request = headers();
  request.set("host", "attacker.example"); assert.throws(() => assertRequest(config, request), /host_rejected/);
  request.set("host", "127.0.0.1:3100"); request.set("origin", "http://127.0.0.1:9999");
  assert.throws(() => assertRequest(config, request), /origin_rejected/);
  request.set("origin", "null"); assert.throws(() => assertRequest(config, request), /origin_rejected/);
  request.delete("origin"); assert.throws(() => assertRequest(config, request, true), /origin_required/);
  request.set("sec-fetch-site", "same-site"); assert.throws(() => assertRequest(config, request), /cross_origin_rejected/);
  request.set("sec-fetch-site", "same-origin"); assert.doesNotThrow(() => assertRequest(config, request, true, true));
  assert.throws(() => assertRequest(config, request, true), /origin_required/);
});
test("cookies are HttpOnly, Strict, expiring; no credentials or token in browser payload", () => {
  const cookie = sessionCookie(config, issueSession(config, "viewer"));
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=28800/);
  assert.ok(!cookie.includes(owner) && !cookie.includes(viewer) && !cookie.includes(config.signing_secret));
  assert.match(sessionCookie({ ...config, origin: "https://127.0.0.1:3100" }, "x"), /; Secure$/);
  const request = headers(); request.set("cookie", `${request.get("cookie")}; ${request.get("cookie")}`);
  assert.throws(() => requireSession(config, request), /login_required/);
});
test("auth requires owned private regular config outside repository and exact loopback", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "dots-web-auth-test-"));
  const file = path.join(folder, "config.json");
  try {
    fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    assert.deepEqual(loadWebAuth(file), config);
    fs.chmodSync(file, 0o644); assert.throws(() => loadWebAuth(file), /configuration_invalid/);
    fs.chmodSync(file, 0o600);
    fs.symlinkSync(file, path.join(folder, "link.json")); assert.throws(() => loadWebAuth(path.join(folder, "link.json")), /configuration_invalid/);
    fs.writeFileSync(file, JSON.stringify({ ...config, origin: "http://192.0.2.1:3100" })); assert.throws(() => loadWebAuth(file), /configuration_invalid/);
    assert.throws(() => loadWebAuth(path.join(process.cwd(), "config.json")), /outside_repository/);
    assert.throws(() => loadWebAuth("relative.json"), /not_configured/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
test("every exported server action and legacy API repeats server-side guard", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const actions = fs.readFileSync(path.join(root, "src/app/actions.ts"), "utf8");
  const declarations = [...actions.matchAll(/^export async function [^\n]+\{\n([^\n]*)/gm)];
  assert.ok(declarations.length > 40);
  for (const declaration of declarations) assert.equal(declaration[1].trim(), "await requireWebOwner();");
  const routes = fs.readdirSync(path.join(root, "src/app/api"), { recursive: true }).filter((file) => typeof file === "string" && file.endsWith("route.ts") && !file.startsWith("auth/")) as string[];
  for (const route of routes) {
    const source = fs.readFileSync(path.join(root, "src/app/api", route), "utf8");
    for (const method of source.matchAll(/export async function (?:GET|POST)\([^\n]*\) \{\n([^\n]*)\n([^\n]*)/g)) {
      assert.match(method[1], /const denied = webRouteGuard\(/, route);
      assert.equal(method[2].trim(), "if (denied) return denied;", route);
    }
  }
});
