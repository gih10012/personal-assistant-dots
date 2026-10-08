/** Initialize local auth without printing credentials or placing them in argv. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

const folder = path.resolve(process.argv[2] ?? path.join(os.homedir(), ".local/state/personal-assistant-dots/web-auth"));
const origin = process.argv[3] ?? "http://127.0.0.1:3100";
const url = new URL(origin);
if (url.origin !== origin || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol))
  throw new Error("Use one exact loopback origin.");
const relative = path.relative(process.cwd(), folder);
if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("Auth must be outside the repository.");
fs.mkdirSync(folder, { mode: 0o700, recursive: true });
const info = fs.lstatSync(folder);
if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error("Use an owned private directory.");
const targets = ["config.json", "owner-login.txt", "viewer-login.txt"].map((name) => path.join(folder, name));
if (targets.some((file) => fs.existsSync(file))) throw new Error("Existing auth is preserved. Choose a new directory to rotate it.");
const owner = randomBytes(32).toString("hex"), viewer = randomBytes(32).toString("hex");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const config = { origin, signing_secret: randomBytes(32).toString("hex"), owner_login_sha256: hash(owner), viewer_login_sha256: hash(viewer) };
fs.writeFileSync(targets[0], JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" });
fs.writeFileSync(targets[1], owner, { mode: 0o600, flag: "wx" });
fs.writeFileSync(targets[2], viewer, { mode: 0o600, flag: "wx" });
console.log(`Auth config: ${targets[0]}\nOwner login file: ${targets[1]}\nViewer login file: ${targets[2]}\nSet DOTS_WEB_AUTH_CONFIG to the config path. Open ${origin}/login and select the owner or viewer login file. Never upload config.json.`);
