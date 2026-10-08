"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CheckCircle2, ChevronDown, RefreshCw, Wrench, CircleAlert } from "lucide-react";
import { projectMatches, ACTIVE_TASK_STATUSES, type Observations, type ObservedTask, type Observation } from "@/lib/observability";

const statusLabels: Record<string, string> = { pending: "待处理", running: "正在做", completed: "已完成", failed: "失败", needs_review: "待核查", waiting_children: "子 Agent 正在做", continuing: "Goal 持续推进", paused: "已暂停", waiting_auth: "等待登录", waiting_backend: "等待运行环境" };
function time(value: number) { return new Date(value < 1e12 ? value * 1000 : value).toLocaleString(); }
function Task({ task }: { task: ObservedTask }) {
  const active = ACTIVE_TASK_STATUSES.has(task.status);
  return <details className={`rounded-xl border border-black/10 bg-background/60 ${task.parent_id ? "ml-4 border-l-2 border-l-brand/40" : ""}`}>
    <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3">
      {active ? <Activity className="mt-0.5 size-4 shrink-0 text-brand" /> : ["failed", "needs_review"].includes(task.status) ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive/70" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-foreground/45" />}
      <span className="min-w-0 flex-1"><span className="block whitespace-pre-wrap break-words text-sm">{task.input}</span>
        <span className="mt-1 block text-xs text-foreground/50">{statusLabels[task.status] ?? task.status} · {task.node ?? "尚未分配节点"} · {time(task.created)}</span>
      </span><ChevronDown className="mt-1 size-4 shrink-0 text-foreground/35" />
    </summary>
    <div className="space-y-3 border-t border-black/[0.06] px-4 py-3 text-sm">
      <p className="break-all font-mono text-xs text-foreground/50">Task {task.id}{task.parent_id ? ` · Parent ${task.parent_id}` : ""}</p>
      {task.result ? <div><p className="mb-2 text-xs text-foreground/50">结果摘要（账本投影）</p><div className="whitespace-pre-wrap break-words">{task.result}</div></div> : <p className="text-foreground/50">尚无完成结果。</p>}
      {task.native && <details><summary className="cursor-pointer text-xs text-foreground/60">连续线程 · Goal · Plan</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/[0.03] p-3 text-xs">{JSON.stringify(task.native, null, 2)}</pre></details>}
    </div>
  </details>;
}
function CapabilityCard({ row }: { row: Record<string, unknown> }) {
  const [detail, setDetail] = useState<Observation<Record<string, unknown>> | null>(null);
  const [pending, setPending] = useState(false);
  async function load() {
    if (pending || detail || typeof row.id !== "string") return;
    setPending(true);
    try {
      const response = await fetch(`/api/mesh/resources/${encodeURIComponent(row.id)}`, { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/login"); return; }
      setDetail(response.ok ? await response.json() : { state: "unavailable", reason: "capability_details_unavailable" });
    } catch { setDetail({ state: "unavailable", reason: "capability_details_unavailable" }); }
    finally { setPending(false); }
  }
  const metrics = detail?.state === "available" && Array.isArray(detail.data.metrics) ? detail.data.metrics.filter((metric): metric is Record<string, unknown> => !!metric && typeof metric === "object") : [];
  return <details className="rounded-xl border border-black/10 p-3" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary className="cursor-pointer list-none"><span className="block break-all text-sm font-medium">{String(row.id ?? "未命名能力")}</span>
      <span className="mt-1 block text-xs text-foreground/55">{String(row.kind ?? "开放能力类型")} · {String(row.principal ?? "未知提供节点")} · {row.available === true ? "公告可用" : "未公告可用"}</span>
      {typeof row.description === "string" && <span className="mt-2 block whitespace-pre-wrap text-sm text-foreground/65">{row.description}</span>}
      <span className="mt-2 block text-xs text-foreground/50">验证标记：{String(row.verification ?? "未提供")} · 健康：{String(row.health ?? "未知")}（{String(row.health_verification ?? "来源未标明")}）</span>
    </summary>
    {pending && <p className="mt-3 text-xs text-foreground/50">正在读取此能力的证据与性能样本…</p>}
    {detail?.state === "unavailable" && <p className="mt-3 text-xs text-foreground/50">能力详细证据暂不可用；下面仅显示已读取的公告。</p>}
    {detail?.state === "available" && <div className="mt-3 space-y-2">
      <p className="text-xs text-foreground/60">性能样本与验证证据（最多 100 条）。验证结论只适用于该样本和能力版本，不是全局可用保证。</p>
      {!metrics.length && <p className="text-xs text-foreground/50">尚未记录性能样本。</p>}
      {metrics.map((metric, index) => <div key={String(metric.id ?? index)} className="rounded-lg bg-background p-3 text-xs">
        <p className="break-all font-medium">{String(metric.metric ?? "样本")} = {typeof metric.value === "object" ? JSON.stringify(metric.value) : String(metric.value)} {String(metric.unit ?? "")}</p>
        <p className="mt-1 text-foreground/55">{String(metric.verification ?? "未验证")}（此样本） · {metric.current_epoch === true ? "当前能力版本" : "旧能力版本"} · 来源 {String(metric.source ?? "未知")}</p>
        {typeof metric.sample_time === "number" && <p className="mt-1 text-foreground/50">采样 {time(metric.sample_time)}</p>}
        <details className="mt-2"><summary className="cursor-pointer">证据范围与原始样本投影</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(metric, null, 2)}</pre></details>
      </div>)}
    </div>}
    <details className="mt-3"><summary className="cursor-pointer text-xs text-foreground/60">能力公告与开放元数据</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs">{JSON.stringify(row, null, 2)}</pre></details>
  </details>;
}
function CapabilitySection({ title, observation }: { title: string; observation?: Observation<Record<string, unknown>> }) {
  const payload = observation?.state === "available" ? observation.data : null;
  const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : null;
  const events = Array.isArray(payload?.events) ? payload.events.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : null;
  return <section className="rounded-2xl border border-black/10 p-5">
    <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Wrench className="size-4" />{title}</h2>
    {!observation ? <p className="text-sm text-foreground/50">正在读取持久记录…</p> : observation.state === "unavailable" ?
      <p role="status" className="text-sm text-foreground/60">此数据源暂不可用（{observation.reason}）。未展示模拟能力或模拟成果。</p> :
      <div className="space-y-3">
        {capabilities && <>
          <p className="text-xs text-foreground/55">公告、健康状态、性能证据和本次授权分别记录。公告可用不等于执行已验证。</p>
          {!capabilities.length && <p className="text-sm text-foreground/50">当前数据源尚无能力公告。</p>}
          <div className="max-h-[32rem] space-y-2 overflow-auto">{capabilities.map((row, index) => <CapabilityCard key={String(row.id ?? index)} row={row} />)}</div>
        </>}
        {events && <>
          <p className="text-xs text-foreground/55">能力生命周期审计不是性能验证结论；可展开查看操作来源和证据范围。</p>
          {!events.length && <p className="text-sm text-foreground/50">当前窗口暂无能力事件。</p>}
          <ol className="max-h-[32rem] space-y-2 overflow-auto">{events.map((row, index) => <li key={String(row.sequence ?? index)}><details className="rounded-xl border border-black/10 p-3">
            <summary className="cursor-pointer list-none text-sm"><span className="font-medium">{String(row.operation ?? "能力事件")}</span> · {String(row.capability_id ?? "未关联能力")}<span className="mt-1 block text-xs text-foreground/50">{String(row.actor ?? "来源未知")}{typeof row.created === "number" ? ` · ${time(row.created)}` : ""}</span></summary>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs">{JSON.stringify(row, null, 2)}</pre>
          </details></li>)}</ol>
          {typeof payload?.next === "number" && <p className="text-xs text-foreground/40">当前事件游标 {payload.next}（此视图显示返回窗口，不声明已覆盖所有事件）</p>}
        </>}
        {!capabilities && !events && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs">{JSON.stringify(observation.data, null, 2)}</pre>}
      </div>}
  </section>;
}

export default function Projects() {
  const [data, setData] = useState<Observations | null>(null);
  const [after, setAfter] = useState(0);
  const [filter, setFilter] = useState<"all" | "active" | "finished">("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(true);
    try {
      const response = await fetch(`/api/mesh/observe?after=${after}`, { cache: "no-store", signal: controller.signal });
      if (activeRequest.current !== controller) return;
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) { setError("本地面板无法读取数据，请重试。"); return; }
      setData(await response.json()); setError("");
    } catch { if (!controller.signal.aborted) setError("本地服务暂不可用。"); }
    finally { if (activeRequest.current === controller) { activeRequest.current = null; setPending(false); } }
  }, [after]);
  useEffect(() => {
    void refresh(); const timer = setInterval(() => { void refresh(); }, 10000);
    return () => { clearInterval(timer); activeRequest.current?.abort(); activeRequest.current = null; };
  }, [refresh]);
  const page = data?.projects.state === "available" ? data.projects.data : null;
  const projects = useMemo(() => (page?.projects ?? []).filter((project) => projectMatches(project, filter, query)), [page, filter, query]);
  return <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-6 md:px-8">
      <header className="flex flex-wrap items-start gap-3">
        <div className="mr-auto"><h1 className="text-2xl font-semibold">AI 正在做什么，已经做成什么</h1>
          <p className="mt-2 text-sm text-foreground/60">项目任务、造出的 Tools 和发现的终端能力。这里观察事实，不限定模型可以做的事。</p></div>
        <button className="btn-quiet h-9 gap-2" onClick={() => void refresh()} disabled={pending}><RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />刷新</button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "active", "finished"] as const).map((value) => <button key={value} aria-pressed={filter === value} className={`rounded-full border px-4 py-2 text-sm ${filter === value ? "border-foreground bg-background" : "border-black/10 text-foreground/60"}`} onClick={() => setFilter(value)}>{value === "all" ? "全部" : value === "active" ? "正在做" : "做过的项目"}</button>)}
        <input className="field ml-auto max-w-sm" placeholder="搜索项目或任务" aria-label="搜索项目或任务" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data?.projects.state === "unavailable" && <p role="status" className="rounded-xl border border-black/10 p-4 text-sm">任务账本暂不可用（{data.projects.reason}）。没有把空白当作“所有任务已完成”。</p>}
      {!data && <p className="text-sm text-foreground/50">正在读取真实任务账本…</p>}
      {page && <section className="space-y-4" aria-label="项目任务">
        {projects.map((project) => <article key={project.id} className="rounded-2xl border border-black/10 p-5">
          <div className="mb-4 flex flex-wrap items-baseline gap-2"><h2 className="mr-auto text-lg font-semibold">{project.title}</h2>
            {Object.entries(project.status_counts).map(([status, count]) => <span key={status} className="rounded-full bg-background px-2.5 py-1 text-xs">{statusLabels[status] ?? status} {count}</span>)}</div>
          <p className="mb-3 break-all font-mono text-xs text-foreground/40">{project.id}</p>
          <div className="space-y-2">{project.tasks.map((task) => <Task key={task.id} task={task} />)}</div>
        </article>)}
        {!projects.length && <p className="py-6 text-sm text-foreground/50">当前页没有符合筛选的项目。</p>}
        <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/50"><span>账本来源：{page.source} · 状态计数仅当前页 · {data && time(data.sampled_at)}</span>
          {after !== 0 && <button className="btn-quiet h-8" onClick={() => setAfter(0)}>回到第一页</button>}
          {page.has_more && <button className="btn-quiet ml-auto h-8" onClick={() => setAfter(page.next_cursor)}>下一页任务</button>}</div>
      </section>}
      <div className="grid gap-4 lg:grid-cols-2"><CapabilitySection title="资源与终端能力" observation={data?.resources} /><CapabilitySection title="新 Tools · 能力发现与验证" observation={data?.events} /></div>
    </div>
  </div>;
}
