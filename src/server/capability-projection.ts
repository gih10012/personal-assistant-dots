/** Preserve open capability metadata; omit authentication/execution internals. */
const PRIVATE_FIELDS = new Set(["token", "secret", "password", "passwd", "credential", "credentials", "authorization", "cookie", "cookies", "headers", "env", "environment_variables", "api_key", "apikey", "private_key", "access_token", "refresh_token", "client_secret", "auth_file", "config_file", "checkpoint", "rollout", "grant_token"]);
export function safeCapabilityProjection(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_capability_projection");
  function clean(item: unknown, depth: number): unknown {
    if (depth > 12) return "[depth limit]";
    if (Array.isArray(item)) return item.slice(0, 500).map((entry) => clean(entry, depth + 1));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).filter(([key]) => !PRIVATE_FIELDS.has(key.toLowerCase().replaceAll("-", "_"))).map(([key, entry]) => [key, clean(entry, depth + 1)]));
    if (typeof item === "string") {
      if (/\b(?:Bearer\s+|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/i.test(item)) return "[private authentication value omitted]";
      if (item.includes("://")) {
        try {
          const url = new URL(item);
          if (url.username || url.password || url.search || url.hash) {
            url.username = ""; url.password = ""; url.search = ""; url.hash = "";
            return url.toString();
          }
        } catch { if (item.includes("@") || item.includes("?")) return "[private endpoint omitted]"; }
      }
      return item.slice(0, 10000);
    }
    return item;
  }
  return clean(value, 0) as Record<string, unknown>;
}
