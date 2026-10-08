"use client";
import Link from "next/link";
import type { WebRole } from "@/server/web-auth-core";

export default function ObserverNav({ role }: { role: WebRole }) {
  return <nav aria-label="工作区导航" className="flex shrink-0 items-center gap-4 border-b border-black/10 px-5 py-3 text-sm">
    <Link href="/projects" className="font-semibold">项目与能力</Link>
    <span className="ml-auto text-foreground/55">{role === "owner" ? "Owner · 管理" : "Viewer · 只读"}</span>
    <button className="btn-quiet h-8" onClick={async () => {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (response.ok) window.location.assign("/login");
    }}>退出</button>
  </nav>;
}
