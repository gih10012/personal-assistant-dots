import { requireWebPage } from "@/server/web-auth";
import AppsDirectory, { type CatalogApp } from "@/components/AppsDirectory";
import catalog from "@/data/apps.json";

export const metadata = { title: "Apps · Open Dot" };

export default async function Page() {
  await requireWebPage(true);
  return <AppsDirectory apps={catalog.apps as CatalogApp[]} />;
}
