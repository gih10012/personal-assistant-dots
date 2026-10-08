import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadWebAuth, requireSession, WebAuthError } from "./web-auth-core";

export async function requireWebOwner() {
  return requireSession(loadWebAuth(), await headers(), true);
}
export async function requireWebPage(ownerOnly = false) {
  try {
    const session = requireSession(loadWebAuth(), await headers());
    if (ownerOnly && session.role !== "owner") redirect("/projects");
    return session;
  }
  catch (error) {
    if (error instanceof WebAuthError && error.status === 401) redirect("/login");
    throw error;
  }
}
export function webRouteGuard(request: Request, write = false, unsafeGet = false, ownerOnly = false): Response | null {
  try {
    const session = requireSession(loadWebAuth(), request.headers, write, unsafeGet);
    if (ownerOnly && session.role !== "owner") throw new WebAuthError(403, "web_read_only_session");
    return null;
  }
  catch (error) {
    const known = error instanceof WebAuthError;
    return Response.json({ error: known ? error.message : "web_access_rejected" }, {
      status: known ? error.status : 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
