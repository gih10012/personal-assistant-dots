import { observe } from "@/server/observability";
import { webRouteGuard } from "@/server/web-auth";

export async function GET(request: Request) {
  const denied = webRouteGuard(request);
  if (denied) return denied;
  const value = new URL(request.url).searchParams.get("after") ?? "0";
  if (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value))) return Response.json({ error: "Invalid task cursor." }, { status: 400 });
  return Response.json(await observe(Number(value)), { headers: { "Cache-Control": "no-store" } });
}
