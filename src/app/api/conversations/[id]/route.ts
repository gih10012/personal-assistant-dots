import { webRouteGuard } from "@/server/web-auth";
import { conversationMessages } from "@/server/repo";

// Full history of one conversation (the live snapshot only carries recent messages).
export async function GET(req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const denied = webRouteGuard(req, false, false, true);
  if (denied) return denied;
  const { id } = await ctx.params;
  return Response.json({ messages: conversationMessages(id, 1000) });
}
