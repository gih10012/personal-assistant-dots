import { assertRequest, loadWebAuth, sessionCookie, WebAuthError } from "@/server/web-auth-core";

export async function POST(request: Request) {
  try {
    const config = loadWebAuth();
    assertRequest(config, request.headers, true);
    return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie(config, "", 0), "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof WebAuthError ? error.message : "Logout unavailable." }, { status: error instanceof WebAuthError ? error.status : 503 });
  }
}
