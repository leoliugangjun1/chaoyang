"use client";

import { useEffect, useState } from "react";

type Project = { project_id: string; name: string; file_count: number };
type Skill = { skill_id: string; name: string; version: string };
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
    } catch (error) { setMessage(error instanceof Error ? error.message : "审核启动失败"); setActionState("error"); }
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">IPD / 产品资料审核</p><h1>视觉准入审核</h1></div>
        <span className="local-tag">本地运行</span>
      </header>
      <section className="content" aria-live="polite">
        {state === "loading" && <p className="state-message">正在加载审核项目...</p>}
        {state === "error" && <div className="state-block"><p>无法加载项目数据。</p><button type="button" onClick={() => void load()}>重试</button></div>}
        {state === "ready" && <div className="workspace">
          <section className="panel"><h2>创建审核项目</h2><div className="form-row"><input aria-label="项目名称" placeholder="项目名称" value={projectName} onChange={(event) => setProjectName(event.target.value)} /><button type="button" onClick={() => void createProject()} disabled={actionState === "loading" || !projectName.trim()}>创建项目</button></div></section>
          <section className="panel"><h2>审核任务输入</h2><select aria-label="选择项目" value={selectedProject?.project_id ?? ""} onChange={(event) => setSelectedProject(projects.find((project) => project.project_id === event.target.value) ?? null)}><option value="">选择项目</option>{projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select><input aria-label="上传 Excel" type="file" accept=".xlsx" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /><select aria-label="Skill 版本" value={selectedSkill} onChange={(event) => setSelectedSkill(event.target.value)}><option value="">选择 Skill 版本</option>{skills.map((skill) => <option key={skill.skill_id} value={skill.skill_id}>{skill.name} / {skill.version}</option>)}</select><button type="button" onClick={() => void uploadAndStart()} disabled={actionState === "loading" || !selectedProject || !selectedFile || !selectedSkill}>启动审核</button>{message && <p className="form-message">{message}</p>}</section>
          {projects.length === 0 && <div className="empty-state"><h2>尚无审核项目</h2><p>创建项目并上传固定模板 Excel 后，可开始资料准入审核。</p></div>}
        </div>}
      </section>
    </main>
  );
}
