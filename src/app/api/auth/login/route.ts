import { authenticateLogin, assertRequest, issueSession, loadWebAuth, sessionCookie, WebAuthError } from "@/server/web-auth-core";

const state = globalThis as unknown as { dotsLoginFailures?: { since: number; count: number } };
export async function POST(request: Request) {
  try {
    const config = loadWebAuth();
    assertRequest(config, request.headers, true);
    const now = Date.now();
    const failures = state.dotsLoginFailures;
    if (failures && now - failures.since < 60000 && failures.count >= 5)
      return Response.json({ error: "Too many attempts. Try again in one minute." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    if (request.headers.get("content-type") !== "application/json") return Response.json({ error: "JSON required." }, { status: 415 });
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Login credential required." }, { status: 400 });
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1024) { await reader.cancel(); return Response.json({ error: "Login request too large." }, { status: 413 }); }
      chunks.push(value);
    }
    let credential: unknown;
    try { credential = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { credential?: unknown }).credential; }
    catch { return Response.json({ error: "Invalid login request." }, { status: 400 }); }
    const role = typeof credential === "string" ? authenticateLogin(config, credential) : null;
    if (!role) {
      state.dotsLoginFailures = failures && now - failures.since < 60000 ? { ...failures, count: failures.count + 1 } : { since: now, count: 1 };
      return Response.json({ error: "Login credential rejected." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    state.dotsLoginFailures = undefined;
    return Response.json({ role }, { headers: { "Set-Cookie": sessionCookie(config, issueSession(config, role)), "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof WebAuthError ? error.message : "Login unavailable." }, {
      status: error instanceof WebAuthError ? error.status : 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
