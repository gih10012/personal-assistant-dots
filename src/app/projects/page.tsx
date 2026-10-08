import Projects from "@/components/Projects";
import { requireWebPage } from "@/server/web-auth";

export default async function Page() { await requireWebPage(); return <Projects />; }
