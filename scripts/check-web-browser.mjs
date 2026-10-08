/** Isolated headless Firefox acceptance; never opens the user's profile/desktop. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const configFile = process.env.DOTS_WEB_AUTH_CONFIG;
if (!configFile || !process.env.DOTS_GECKODRIVER) throw new Error("Set private DOTS_WEB_AUTH_CONFIG and an installed DOTS_GECKODRIVER executable.");
const configStat = fs.lstatSync(configFile);
if (!configStat.isFile() || configStat.isSymbolicLink() || configStat.uid !== process.getuid?.() || (configStat.mode & 0o077)) throw new Error("Private owned auth config required.");
const { origin } = JSON.parse(fs.readFileSync(configFile, "utf8"));
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Loopback only.");
const credentialFile = path.join(path.dirname(configFile), "owner-login.txt");
const credentialStat = fs.lstatSync(credentialFile);
if (!credentialStat.isFile() || credentialStat.isSymbolicLink() || credentialStat.uid !== process.getuid?.() || (credentialStat.mode & 0o077)) throw new Error("Private owned login file required.");
const privateTemp = fs.mkdtempSync(path.join(os.tmpdir(), "dots-firefox-check-"));
const output = process.env.DOTS_WEB_ACCEPTANCE_DIR ?? path.join(os.homedir(), ".local/state/personal-assistant-dots/acceptance");
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const outputStat = fs.lstatSync(output);
if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || outputStat.uid !== process.getuid?.() || (outputStat.mode & 0o077)) throw new Error("Private owned screenshot directory required.");
const socket = net.createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const driver = spawn(process.env.DOTS_GECKODRIVER, ["--host", "127.0.0.1", "--port", String(port), "--profile-root", privateTemp, "--log", "error"], { stdio: "ignore" });
let session;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function command(route, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`WebDriver operation rejected (${response.status}).`);
  return data.value;
}
async function run(script, args = []) { return command(`/session/${session}/execute/sync`, { script, args }); }
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) { try { await command("/status"); ready = true; break; } catch { await pause(100); } }
  assert.ok(ready, "headless driver startup");
  const created = await command("/session", { capabilities: { alwaysMatch: { browserName: "firefox", "moz:firefoxOptions": { binary: process.env.DOTS_FIREFOX_BINARY ?? "/usr/bin/firefox", args: ["--headless", "--no-remote"], prefs: { "network.proxy.type": 0 } } } } });
  session = created.sessionId;
  await command(`/session/${session}/window/rect`, { width: 1440, height: 1000 });
  await command(`/session/${session}/url`, { url: `${origin}/login` });
  assert.equal(await run("return document.querySelector('h1')?.textContent"), "打开私人工作区");
  const fileInput = await command(`/session/${session}/element`, { using: "css selector", value: "input[type=file]" });
  await command(`/session/${session}/element/${fileInput["element-6066-11e4-a52e-4f735466cecf"]}/value`, { text: credentialFile });
  let formReady = false;
  for (let attempt = 0; attempt < 50; attempt++) { if (await run("return !document.querySelector('button[type=submit]').disabled")) { formReady = true; break; } await pause(100); }
  assert.ok(formReady, "private file chooser loads login credential");
  const button = await command(`/session/${session}/element`, { using: "css selector", value: "button[type=submit]" });
  await command(`/session/${session}/element/${button["element-6066-11e4-a52e-4f735466cecf"]}/click`, {});
  let projectsReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await run("return location.pathname === '/projects' && document.querySelector('h1')?.textContent === 'AI 正在做什么，已经做成什么'")) { projectsReady = true; break; }
    await pause(100);
  }
  assert.ok(projectsReady, "owner browser login and project page render");
  // Wait for a factual source response (available OR explicit unavailable), not an invented success.
  let sourceReady = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    if (await run("return !document.body.innerText.includes('正在读取真实任务账本…') && !document.body.innerText.includes('正在读取持久记录…')")) { sourceReady = true; break; }
    await pause(100);
  }
  assert.ok(sourceReady, "observation source response renders");
  assert.ok(await run("return document.body.innerText.includes('资源与终端能力') && document.body.innerText.includes('新 Tools · 能力发现与验证')"), "capability observation sections");
  assert.ok(await run("return !localStorage.getItem('token') && !localStorage.getItem('access_token')"), "no browser token storage");
  assert.ok(await run("return !document.cookie.includes('dots_session')"), "HttpOnly cookie not exposed to page JavaScript");
  const sizes = [];
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    await command(`/session/${session}/window/rect`, { width, height });
    await pause(150);
    assert.ok(await run("return document.documentElement.scrollWidth <= window.innerWidth"), `${name} has no horizontal page overflow`);
    const actual = await run("return {width:window.innerWidth,height:window.innerHeight}");
    if (name === "mobile") assert.ok(actual.width < 768, "actual narrow viewport crosses the responsive breakpoint");
    sizes.push(`${name} ${actual.width}x${actual.height} CSS pixels`);
    const shot = await command(`/session/${session}/screenshot`);
    fs.writeFileSync(path.join(output, `projects-${name}.png`), Buffer.from(shot, "base64"), { mode: 0o600 });
  }
  console.log(`Isolated Firefox browser acceptance passed: file login, actual project/capability render, HttpOnly, responsive layout (${sizes.join("; ")}). Private screenshots: ${output}`);
} finally {
  if (session) { try { await command(`/session/${session}`, undefined, "DELETE"); } catch {} }
  driver.kill("SIGTERM");
  // Browser-generated temporary files are retained on unexpected shutdown for inspection.
}
