/** Local browser sessions. Mesh bearer credentials never enter this module. */
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "dots_session";
export const SESSION_TTL = 8 * 60 * 60;
export type WebRole = "owner" | "viewer";
export type WebAuthConfig = {
  origin: string; signing_secret: string; owner_login_sha256: string;
  viewer_login_sha256?: string;
};
export type WebSession = { v: 1; role: WebRole; iat: number; exp: number; nonce: string };
export class WebAuthError extends Error {
  status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}
export function loadWebAuth(file = process.env.DOTS_WEB_AUTH_CONFIG): WebAuthConfig {
  if (!file || !path.isAbsolute(file)) throw new WebAuthError(503, "web_auth_not_configured");
  const relative = path.relative(process.cwd(), file);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)))
    throw new WebAuthError(503, "web_auth_must_be_outside_repository");
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077))
      throw new Error("private_file_required");
    const canonicalRelative = path.relative(fs.realpathSync(process.cwd()), fs.realpathSync(file));
    if (canonicalRelative === "" || (!canonicalRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(canonicalRelative)))
      throw new Error("private_auth_inside_repository");
    const config = JSON.parse(fs.readFileSync(file, "utf8")) as WebAuthConfig;
    const origin = new URL(config.origin);
    if (!["http:", "https:"].includes(origin.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
      origin.origin !== config.origin || origin.username || origin.password)
      throw new Error("exact_loopback_origin_required");
    if (!/^[a-f0-9]{64}$/.test(config.signing_secret) || !/^[a-f0-9]{64}$/.test(config.owner_login_sha256) ||
      (config.viewer_login_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(config.viewer_login_sha256)))
      throw new Error("strong_auth_secrets_required");
    return config;
  } catch { throw new WebAuthError(503, "web_auth_configuration_invalid"); }
}
function equalDigest(a: string, b: string): boolean {
  return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
export function authenticateLogin(config: WebAuthConfig, credential: string): WebRole | null {
  if (typeof credential !== "string" || credential.length < 32 || credential.length > 256) return null;
  const hash = createHash("sha256").update(credential.trim()).digest("hex");
  if (equalDigest(hash, config.owner_login_sha256)) return "owner";
  if (config.viewer_login_sha256 && equalDigest(hash, config.viewer_login_sha256)) return "viewer";
  return null;
}
export function issueSession(config: WebAuthConfig, role: WebRole, now = Math.floor(Date.now() / 1000)): string {
  const value: WebSession = { v: 1, role, iat: now, exp: now + SESSION_TTL, nonce: randomBytes(16).toString("hex") };
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", Buffer.from(config.signing_secret, "hex")).update(payload).digest("hex")}`;
}
export function verifySession(config: WebAuthConfig, token?: string, now = Math.floor(Date.now() / 1000)): WebSession | null {
  if (!token || token.length > 1024) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const digest = createHmac("sha256", Buffer.from(config.signing_secret, "hex")).update(payload).digest("hex");
  if (!equalDigest(digest, signature)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as WebSession;
    if (data.v !== 1 || !["owner", "viewer"].includes(data.role) || !Number.isInteger(data.iat) || !Number.isInteger(data.exp) ||
      data.iat > now + 30 || data.exp <= now || data.exp - data.iat !== SESSION_TTL || !/^[a-f0-9]{32}$/.test(data.nonce)) return null;
    return data;
  } catch { return null; }
}
export function sessionFromHeaders(config: WebAuthConfig, headers: Headers): WebSession | null {
  const values = (headers.get("cookie") ?? "").split(";").map((v) => v.trim()).filter((v) => v.startsWith(`${SESSION_COOKIE}=`));
  return values.length === 1 ? verifySession(config, values[0].slice(SESSION_COOKIE.length + 1)) : null;
}
export function assertRequest(config: WebAuthConfig, headers: Headers, mutation = false, unsafeGet = false): void {
  if (headers.get("host") !== new URL(config.origin).host) throw new WebAuthError(403, "web_host_rejected");
  const origin = headers.get("origin");
  if (origin !== null && origin !== config.origin) throw new WebAuthError(403, "web_origin_rejected");
  if (["cross-site", "same-site"].includes(headers.get("sec-fetch-site") ?? "")) throw new WebAuthError(403, "web_cross_origin_rejected");
  if (mutation && origin !== config.origin && !(unsafeGet && headers.get("sec-fetch-site") === "same-origin"))
    throw new WebAuthError(403, "web_origin_required");
}
export function requireSession(config: WebAuthConfig, headers: Headers, write = false, unsafeGet = false): WebSession {
  assertRequest(config, headers, write, unsafeGet);
  const session = sessionFromHeaders(config, headers);
  if (!session) throw new WebAuthError(401, "web_login_required");
  if (write && session.role !== "owner") throw new WebAuthError(403, "web_read_only_session");
  return session;
}
export function sessionCookie(config: WebAuthConfig, token: string, maxAge = SESSION_TTL): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(config.origin).protocol === "https:" ? "; Secure" : ""}`;
}
