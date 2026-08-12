"use client";

import { useEffect, useState } from "react";

type Project = { project_id: string; name: string; file_count: number };
type Skill = { skill_id: string; name: string; version: string };
type Task = { task_id: string; stage: string; status: string; progress: number; error_code?: string | null; stage_results?: Record<string, unknown> };
type Report = { review_id: string; admission_status: "approved" | "conditional_approval" | "rejected" | "manual_review"; source_path: string[]; hard_fail_checks: { rule_id: string; hard_fail: boolean; finding: string; source_refs: string[] }[]; completeness: { marketing_score: number; manual_score: number; raw_score: number; audited_completeness_percent: number; missing_fields: string[] }; findings: { category: string; status: string; finding: string; source_refs: string[]; required_action: string; owner_role: string }[] };
type BootstrapResponse = { projects: Project[] };
type LoadState = "loading" | "ready" | "error";

export default function HomePage() {
  const [state, setState] = useState<LoadState>("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [projectName, setProjectName] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedSkill, setSelectedSkill] = useState("");
  const [actionState, setActionState] = useState<LoadState | "idle">("idle");
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"input" | "progress" | "report">("input");
  const [task, setTask] = useState<Task | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [findingFilter, setFindingFilter] = useState("all");

  const load = async () => {
    setState("loading");
    try {
      const response = await fetch("/api/bootstrap");
      if (!response.ok) throw new Error("bootstrap failed");
      const payload = (await response.json()) as BootstrapResponse;
      setProjects(payload.projects);
      const skillResponse = await fetch("/api/skills");
      if (!skillResponse.ok) throw new Error("skills failed");
      const skillPayload = (await skillResponse.json()) as { skills: Skill[] };
      setSkills(skillPayload.skills);
      setSelectedSkill(skillPayload.skills[0]?.skill_id ?? "");
      setState("ready");
    } catch {
      setState("error");
    }
  };

  useEffect(() => { void load(); }, []);

  const createProject = async () => {
    setActionState("loading"); setMessage("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "项目创建失败");
      setSelectedProject(payload); setProjectName(""); setActionState("ready"); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "项目创建失败"); setActionState("error"); }
  };

  const uploadAndStart = async () => {
    if (!selectedProject || !selectedFile || !selectedSkill) { setMessage("请先选择项目、Excel 文件和 Skill 版本"); return; }
    setActionState("loading"); setMessage("");
    try {
      const form = new FormData(); form.append("file", selectedFile);
      const uploadResponse = await fetch(`/api/projects/${selectedProject.project_id}/files`, { method: "POST", body: form });
      const upload = await uploadResponse.json(); if (!uploadResponse.ok) throw new Error(upload.message || "文件上传失败");
      const bindResponse = await fetch(`/api/projects/${selectedProject.project_id}/skills`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill_id: selectedSkill }) });
      const binding = await bindResponse.json(); if (!bindResponse.ok) throw new Error(binding.message || "Skill 绑定失败");
      const taskResponse = await fetch(`/api/projects/${selectedProject.project_id}/validation-tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_version_id: upload.file_version_id }) });
      const task = await taskResponse.json(); if (!taskResponse.ok) throw new Error(task.message || "审核任务创建失败");
      setMessage(`任务已创建：${task.task_id}`); setActionState("ready"); await load();
      setTask(task); setView("progress"); void pollTask(selectedProject.project_id, task.task_id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "审核启动失败"); setActionState("error"); }
  };

  const pollTask = async (projectId: string, taskId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/validation-tasks/${taskId}`);
      const current = (await response.json()) as Task;
      if (!response.ok) throw new Error((current as unknown as { message?: string }).message || "任务状态读取失败");
      setTask(current);
      if (current.status === "completed") {
        const reportResponse = await fetch(`/api/projects/${projectId}/admission-reports/${taskId}/json`);
        const reportPayload = await reportResponse.json();
        if (!reportResponse.ok) throw new Error(reportPayload.message || "报告读取失败");
        setReport(reportPayload as Report); setView("report"); return;
      }
      if (current.status === "manual_review" || current.status === "cancelled") return;
      window.setTimeout(() => void pollTask(projectId, taskId), 350);
    } catch (error) { setMessage(error instanceof Error ? error.message : "任务状态读取失败"); setActionState("error"); }
  };

  const cancelTask = async () => {
    if (!selectedProject || !task) return;
    setActionState("loading");
    const response = await fetch(`/api/projects/${selectedProject.project_id}/validation-tasks/${task.task_id}`, { method: "DELETE" });
    const payload = (await response.json()) as Task;
    if (response.ok) { setTask(payload); setActionState("ready"); setMessage("审核任务已取消，临时结果不会作为正式报告展示。"); }
    else { setActionState("error"); setMessage((payload as unknown as { message?: string }).message || "取消失败"); }
  };

  const statusLabel: Record<Report["admission_status"], string> = { approved: "通过", conditional_approval: "有条件通过", rejected: "不通过", manual_review: "待人工确认" };
  const filteredFindings = report?.findings.filter((finding) => findingFilter === "all" || finding.status === findingFilter) ?? [];

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">IPD / 产品资料审核</p><h1>视觉准入审核</h1></div>
        <div className="topbar-actions"><span className="local-tag">本地运行</span>{task && <nav className="view-nav" aria-label="审核阶段"><button className={view === "input" ? "active" : ""} onClick={() => setView("input")}>输入</button><button className={view === "progress" ? "active" : ""} onClick={() => setView("progress")}>进度</button><button className={view === "report" ? "active" : ""} onClick={() => setView("report")} disabled={!report}>报告</button></nav>}</div>
      </header>
      <section className="content" aria-live="polite">
        {state === "loading" && <p className="state-message">正在加载审核项目...</p>}
        {state === "error" && <div className="state-block"><p>无法加载项目数据。</p><button type="button" onClick={() => void load()}>重试</button></div>}
        {state === "ready" && view === "input" && <div className="workspace">
          <section className="panel"><h2>创建审核项目</h2><div className="form-row"><input aria-label="项目名称" placeholder="项目名称" value={projectName} onChange={(event) => setProjectName(event.target.value)} /><button type="button" onClick={() => void createProject()} disabled={actionState === "loading" || !projectName.trim()}>创建项目</button></div></section>
          <section className="panel"><h2>审核任务输入</h2><select aria-label="选择项目" value={selectedProject?.project_id ?? ""} onChange={(event) => setSelectedProject(projects.find((project) => project.project_id === event.target.value) ?? null)}><option value="">选择项目</option>{projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select><input aria-label="上传 Excel" type="file" accept=".xlsx" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /><select aria-label="Skill 版本" value={selectedSkill} onChange={(event) => setSelectedSkill(event.target.value)}><option value="">选择 Skill 版本</option>{skills.map((skill) => <option key={skill.skill_id} value={skill.skill_id}>{skill.name} / {skill.version}</option>)}</select><button type="button" onClick={() => void uploadAndStart()} disabled={actionState === "loading" || !selectedProject || !selectedFile || !selectedSkill}>启动审核</button>{message && <p className="form-message">{message}</p>}</section>
          {projects.length === 0 && <div className="empty-state"><h2>尚无审核项目</h2><p>创建项目并上传固定模板 Excel 后，可开始资料准入审核。</p></div>}
        </div>}
        {state === "ready" && view === "progress" && task && <section className="workspace"><div className="panel progress-panel"><div className="section-heading"><div><p className="eyebrow">任务 {task.task_id}</p><h2>{task.status === "manual_review" ? "待人工确认" : task.status === "cancelled" ? "已取消" : "审核进行中"}</h2></div><button type="button" onClick={() => void cancelTask()} disabled={actionState === "loading" || ["completed", "cancelled", "manual_review"].includes(task.status)}>取消任务</button></div><div className="progress-track"><span style={{ width: `${task.progress}%` }} /></div><div className="progress-meta"><strong>{task.progress}%</strong><span>当前阶段：{task.stage}</span></div>{task.error_code && <p className="form-message">错误：{task.error_code}</p>}{task.status === "manual_review" && <p className="form-message">系统无法完成可验证的审核，请人工复核来源、产品范围或输出格式。</p>}</div></section>}
        {state === "ready" && view === "report" && report && <section className="report-view"><div className={`report-status status-${report.admission_status}`}><div><p className="eyebrow">报告 {report.review_id}</p><h2>{statusLabel[report.admission_status]}</h2></div><span>来源 {report.source_path.length} 条</span></div><div className="metric-grid"><div><span>营销资料</span><strong>{report.completeness.marketing_score.toFixed(1)} / 80</strong></div><div><span>产品说明书</span><strong>{report.completeness.manual_score.toFixed(1)} / 15</strong></div><div><span>审计完整度</span><strong>{report.completeness.audited_completeness_percent.toFixed(1)}%</strong></div></div><section className="report-section"><h3>一票退回检查</h3>{report.hard_fail_checks.map((check) => <div className="hard-fail-row" key={check.rule_id}><strong>{check.rule_id}</strong><span>{check.hard_fail ? "命中" : "未命中"}</span><p>{check.finding}</p><small>{check.source_refs.length ? check.source_refs.join("；") : "无法进一步定位"}</small></div>)}</section><section className="report-section"><div className="section-heading"><h3>问题明细</h3><select aria-label="筛选问题状态" value={findingFilter} onChange={(event) => setFindingFilter(event.target.value)}><option value="all">全部状态</option><option value="pass">通过</option><option value="risk">风险</option><option value="fail">失败</option><option value="uncertain">待复核</option><option value="difficult">展示困难</option></select></div>{filteredFindings.length === 0 ? <p className="form-message">当前筛选条件下暂无问题。</p> : <div className="findings-list">{filteredFindings.map((finding, index) => <article className="finding-row" key={`${finding.category}-${index}`}><div className="finding-title"><strong>{finding.category}</strong><span className={`finding-status finding-${finding.status}`}>{finding.status}</span></div><p>{finding.finding}</p><small>必需动作：{finding.required_action || "无"}；责任角色：{finding.owner_role || "未指定"}</small><small>来源：{finding.source_refs.length ? finding.source_refs.join("；") : "无法进一步定位"}</small></article>)}</div>}</section></section>}
      </section>
    </main>
  );
}
