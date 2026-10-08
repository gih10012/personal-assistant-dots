/** Server-side transport. Never return this config or token to the browser. */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

export type MeshConfig = { control_url: string; token_file: string };

/** Definite authority response, distinct from an unknown transport outcome. */
export class MeshAuthorityError extends Error {
  status: number;
  constructor(status: number) {
    super(`mesh_authority_${status}`);
    this.status = status;
  }
}

function privateFile(file: string): string {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077))
    throw new Error("mesh_config_requires_owned_private_file");
  return fs.readFileSync(file, "utf8");
}

export function loadMeshConfig(file: string): MeshConfig {
  const value = JSON.parse(privateFile(file)) as MeshConfig;
  const url = new URL(value.control_url);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))))
    throw new Error("mesh_control_requires_tls_or_loopback");
  if (typeof value.token_file !== "string") throw new Error("mesh_token_file_required");
  if (privateFile(value.token_file).trim().length < 32) throw new Error("weak_mesh_token");
  return value;
}

export function meshRequest<T>(config: MeshConfig, path: string, body?: unknown): Promise<T> {
  const url = new URL(path, config.control_url);
  if (url.origin !== new URL(config.control_url).origin) throw new Error("mesh_origin_mismatch");
  const data = body === undefined ? undefined : JSON.stringify(body);
  const token = privateFile(config.token_file).trim();
  if (token.length < 32) throw new Error("weak_mesh_token");
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: data === undefined ? "GET" : "POST", timeout: 15000,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new MeshAuthorityError(response.statusCode ?? 0));
        return; // no redirects, especially not with owner credentials
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 512 * 1024) response.destroy(new Error("mesh_response_too_large"));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T); }
        catch { reject(new Error("invalid_mesh_response")); }
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("mesh_request_timeout")));
    request.on("error", () => reject(new Error("mesh_request_unavailable")));
    request.end(data);
  });
}
