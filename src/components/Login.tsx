"use client";
import { useState, type FormEvent } from "react";

export default function Login() {
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "Login unavailable."); return; }
      setCredential(""); window.location.assign("/projects");
    } catch { setError("Local server is unavailable."); }
    finally { setPending(false); }
  }
  return <section className="m-auto w-full max-w-md px-6 py-12">
    <p className="eyebrow mb-3">Personal assistant mesh · local access</p>
    <h1 className="mb-3 text-2xl font-semibold">打开私人工作区</h1>
    <p className="mb-6 text-sm text-foreground/60">选择本机私有目录中的 owner-login.txt（管理）或 viewer-login.txt（只读）。不要选择 config.json 或任何模型认证文件。</p>
    <form onSubmit={login} className="space-y-4">
      <label className="block text-sm">本地登录文件
        <input type="file" accept=".txt,text/plain" className="mt-2 block w-full text-sm" onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > 256 || !["owner-login.txt", "viewer-login.txt"].includes(file.name)) { setError("请选择 owner-login.txt 或 viewer-login.txt。"); setCredential(""); return; }
          setCredential((await file.text()).trim()); setError("");
        }} />
      </label>
      <details className="text-sm text-foreground/60"><summary className="cursor-pointer">手动输入登录凭证</summary>
        <input type="password" autoComplete="off" aria-label="登录凭证" className="field mt-2" value={credential} onChange={(event) => setCredential(event.target.value)} />
      </details>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button disabled={pending || !credential} className="btn-primary w-full" type="submit">{pending ? "验证中…" : "进入工作区"}</button>
    </form>
    <p className="mt-6 text-xs text-foreground/45">仅允许配置的 localhost 地址。会话 8 小时后过期；模型和 mesh 操作令牌不会发给浏览器。</p>
  </section>;
}
