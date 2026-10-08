import { observeCapability } from "@/server/observability";
import { webRouteGuard } from "@/server/web-auth";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = webRouteGuard(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!id || id.length > 200 || /[\x00-\x1f]/.test(id)) return Response.json({ error: "Invalid capability identity." }, { status: 400 });
  return Response.json(await observeCapability(id), { headers: { "Cache-Control": "no-store" } });
}
