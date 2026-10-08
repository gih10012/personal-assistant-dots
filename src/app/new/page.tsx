import { requireWebPage } from "@/server/web-auth";
import NewDot from "@/components/NewDot";

export default async function Page() {
  await requireWebPage(true);
  return <NewDot />;
}
