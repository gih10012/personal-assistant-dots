import { requireWebPage } from "@/server/web-auth";
import { Suspense } from "react";
import SettingsView from "@/components/SettingsView";

export default async function Page() {
  await requireWebPage(true);
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
