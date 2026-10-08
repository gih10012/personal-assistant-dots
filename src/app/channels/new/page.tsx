import { requireWebPage } from "@/server/web-auth";
import NewChannel from "@/components/NewChannel";

export default async function Page() {
  await requireWebPage(true);
  return <NewChannel />;
}
