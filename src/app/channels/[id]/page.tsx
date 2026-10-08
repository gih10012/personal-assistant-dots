import { requireWebPage } from "@/server/web-auth";
import ChannelView from "@/components/ChannelView";

export default async function Page({ params }: PageProps<"/channels/[id]">) {
  await requireWebPage(true);
  const { id } = await params;
  return <ChannelView channelId={id} />;
}
