"use client";

import { useEffect, useState } from "react";

type BootstrapResponse = { projects: unknown[] };
type LoadState = "loading" | "ready" | "error";

export default function HomePage() {
  const [state, setState] = useState<LoadState>("loading");
  const [projects, setProjects] = useState<unknown[]>([]);

  const load = async () => {
    setState("loading");
    try {
      const response = await fetch("/api/bootstrap");
      if (!response.ok) throw new Error("bootstrap failed");
      const payload = (await response.json()) as BootstrapResponse;
      setProjects(payload.projects);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">IPD / 产品资料审核</p><h1>视觉准入审核</h1></div>
        <span className="local-tag">本地运行</span>
      </header>
      <section className="content" aria-live="polite">
        {state === "loading" && <p className="state-message">正在加载审核项目...</p>}
        {state === "error" && <div className="state-block"><p>无法加载项目数据。</p><button type="button" onClick={() => void load()}>重试</button></div>}
        {state === "ready" && projects.length === 0 && <div className="empty-state"><h2>尚无审核任务</h2><p>创建项目并上传固定模板 Excel 后，可开始资料准入审核。</p><button type="button" disabled>创建审核项目</button></div>}
      </section>
    </main>
  );
}
