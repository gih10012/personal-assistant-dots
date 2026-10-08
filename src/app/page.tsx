import { requireWebPage } from "@/server/web-auth";
import Home from "@/components/Home";

export default async function Page() {
  await requireWebPage(true);
  return <Home />;
}
