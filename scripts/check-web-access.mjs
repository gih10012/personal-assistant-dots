/** Read-only deployed HTTP checks. No auth values are printed. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const file = process.env.DOTS_WEB_AUTH_CONFIG;
if (!file) throw new Error("Set DOTS_WEB_AUTH_CONFIG to the private config path.");
const info = fs.lstatSync(file);
if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error("Private owned auth config required.");
const { origin } = JSON.parse(fs.readFileSync(file, "utf8"));
const url = new URL(origin);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Loopback only.");
const readCredential = (role) => {
  const location = path.join(path.dirname(file), `${role}-login.txt`);
  const stat = fs.lstatSync(location);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error("Private owned login file required.");
  return fs.readFileSync(location, "utf8").trim();
};
const get = (route, cookie, headers = {}) => fetch(`${origin}${route}`, { redirect: "manual", headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
const login = async (role) => {
  const response = await fetch(`${origin}/api/auth/login`, { method: "POST", redirect: "manual", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ credential: readCredential(role) }) });
  assert.equal(response.status, 200, `${role} login`);
  assert.equal((await response.json()).role, role);
  const cookie = response.headers.get("set-cookie");
  assert.ok(/HttpOnly; SameSite=Strict; Max-Age=28800/.test(cookie ?? ""), "private browser cookie flags required");
  return cookie.split(";")[0];
};
assert.equal((await get("/api/mesh/observe")).status, 401, "anonymous private API");
assert.equal((await get("/projects")).status, 307, "anonymous private page");
assert.equal((await get("/login", undefined, { Origin: "http://127.0.0.1:9999" })).status, 403, "cross-origin request");
const owner = await login("owner"), viewer = await login("viewer");
assert.equal((await get("/projects", owner)).status, 200, "owner project page");
assert.equal((await get("/projects", viewer)).status, 200, "viewer project page");
assert.equal((await get("/settings", viewer)).status, 307, "viewer does not enter owner UI");
assert.equal((await get("/api/events", viewer)).status, 403, "viewer cannot read private chat snapshot");
assert.equal((await get("/api/files/not-a-file", viewer)).status, 403, "viewer cannot read attachments");
for (const [label, cookie, headers] of [
  ["viewer cannot invoke a server action", viewer, { Origin: origin, "Next-Action": "not-a-real-action" }],
  ["owner write requires Origin", owner, {}],
  ["owner rejects cross-origin write", owner, { Origin: "http://127.0.0.1:9999" }],
]) {
  const response = await fetch(`${origin}/`, { method: "POST", redirect: "manual", headers: { Cookie: cookie, ...headers }, body: "" });
  assert.equal(response.status, 403, label);
}
const observation = await get("/api/mesh/observe", viewer);
assert.equal(observation.status, 200, "viewer read projection");
const payload = await observation.json();
for (const source of ["projects", "resources", "events"]) assert.ok(["available", "unavailable"].includes(payload[source]?.state), `${source} source state`);
assert.equal((await get("/api/mesh/observe?after=-1", viewer)).status, 400, "cursor validation");
console.log("Deployed web access checks passed: anonymous isolation, owner/viewer roles, CSRF, private APIs, real-source projections.");
