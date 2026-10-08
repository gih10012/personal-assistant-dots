import { NextResponse, type NextRequest } from "next/server";
import { assertRequest, loadWebAuth, requireSession, WebAuthError } from "./server/web-auth-core";

/** Pre-filter only; actions, private routes and pages repeat authorization. */
export function proxy(request: NextRequest) {
  try {
    const config = loadWebAuth();
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    assertRequest(config, request.headers, unsafe);
    const publicAuth = ["/login", "/api/auth/login", "/api/auth/logout"].includes(request.nextUrl.pathname);
    if (!publicAuth) requireSession(config, request.headers, unsafe);
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    return response;
  } catch (error) {
    const status = error instanceof WebAuthError ? error.status : 503;
    if (status === 401 && request.method === "GET" && !request.nextUrl.pathname.startsWith("/api/"))
      return NextResponse.redirect(new URL("/login", request.nextUrl));
    return NextResponse.json({ error: error instanceof WebAuthError ? error.message : "web_access_rejected" }, { status });
  }
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
