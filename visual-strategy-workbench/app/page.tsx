"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Play,
  Plus,
  RefreshCcw,
  Trash2,
  Upload
} from "lucide-react";
import type { Project, ProjectFile, RunRecord, StepKey, StepResult } from "@/lib/types";

const steps: Array<{ key: StepKey; label: string; description: string; index: string }> = [
  { key: "productFacts", label: "产品事实判断", description: "从资料中整理事实、卖点与风险。", index: "01" },
  { key: "marketAnalysis", label: "市场分析", description: "判断用户、动机、顾虑与竞品方向。", index: "02" },
  { key: "visualStrategy", label: "视觉策略", description: "生成可直接用于跑图的视觉策略。", index: "03" }
];

function latestRun(project: Project | null, step?: StepKey) {
  if (!project) return undefined;
  const runs = step ? project.runs.filter((run) => run.step === step) : project.runs;
  return [...runs].reverse()[0];
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败。");
  return payload as T;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState("");
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningStep, setRunningStep] = useState<StepKey | "">("");
  const [message, setMessage] = useState("");

  const selectedRun = latestRun(activeProject);
  const files = useMemo(() => activeProject?.files ?? [], [activeProject]);
  const readableFiles = files.filter((file) => file.kind !== "unsupported");
  const imageFiles = readableFiles.filter((file) => file.kind === "image");
  const textFiles = readableFiles.filter((file) => file.kind !== "image");

  async function refreshProjects(nextActiveId?: string) {
    const payload = await jsonFetch<{ projects: Project[] }>("/api/projects");
    setProjects(payload.projects);
    const id = nextActiveId || activeId || payload.projects[0]?.id || "";
    setActiveId(id);
    if (id) {
      const detail = await jsonFetch<{ project: Project }>(`/api/projects/${id}`);
      setActiveProject(detail.project);
    } else setActiveProject(null);
  }

  useEffect(() => {
    refreshProjects().catch((error) => setMessage(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId) return;
    jsonFetch<{ project: Project }>(`/api/projects/${activeId}`)
      .then((payload) => setActiveProject(payload.project))
      .catch((error) => setMessage(error.message));
  }, [activeId]);

  async function createProject() {
    setLoading(true);
    setMessage("");
    try {
      const payload = await jsonFetch<{ project: Project }>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `视觉策略工作台 ${new Date().toLocaleDateString("zh-CN")}` })
      });
      await refreshProjects(payload.project.id);
      setMessage("工作台已创建，请上传资料包。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败。");
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`确认删除“${project.name}”吗？项目资料和运行结果也会被删除。`)) return;
    setLoading(true);
    setMessage("");
    try {
      const nextProject = projects.find((item) => item.id !== project.id);
      await jsonFetch<{ deleted: boolean }>(`/api/projects/${project.id}`, { method: "DELETE" });
      await refreshProjects(nextProject?.id);
      setMessage("工作台已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setLoading(false);
    }
  }

  async function uploadArchive(file?: File) {
    if (!activeProject || !file) return;
    setLoading(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("archive", file);
      const payload = await jsonFetch<{ project: Project }>(`/api/projects/${activeProject.id}/upload`, {
        method: "POST",
        body: formData
      });
      setActiveProject(payload.project);
      await refreshProjects(payload.project.id);
      setMessage("资料包已解析，资料卡片已更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败。");
    } finally {
      setLoading(false);
    }
  }

  async function uploadRule(step: StepKey, file?: File) {
    if (!activeProject || !file) return;
    setLoading(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("step", step);
      formData.append("rule", file);
      const payload = await jsonFetch<{ project: Project }>(`/api/projects/${activeProject.id}/rules`, {
        method: "POST",
        body: formData
      });
      setActiveProject(payload.project);
      await refreshProjects(payload.project.id);
      setMessage("规则已启用。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "规则上传失败。");
    } finally {
      setLoading(false);
    }
  }

  async function removeRule(step: StepKey) {
    if (!activeProject) return;
    setLoading(true);
    try {
      const payload = await jsonFetch<{ project: Project }>(`/api/projects/${activeProject.id}/rules`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step })
      });
      setActiveProject(payload.project);
      await refreshProjects(payload.project.id);
      setMessage("规则已移除，下一次运行将使用默认规则。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setLoading(false);
    }
  }

  async function runStep(step: StepKey) {
    if (!activeProject) return;
    setRunningStep(step);
    setMessage("");
    try {
      const payload = await jsonFetch<{ project: Project; run: RunRecord }>(
        `/api/projects/${activeProject.id}/run`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step }) }
      );
      setActiveProject(payload.project);
      await refreshProjects(payload.project.id);
      setMessage(`${steps.find((item) => item.key === step)?.label}已完成。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "运行失败。");
      await refreshProjects(activeProject.id).catch(() => undefined);
    } finally {
      setRunningStep("");
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">VS</div>
          <div><h1>视觉策略 AI</h1><p>资料驱动的视觉工作台</p></div>
        </div>
        <button className="primaryButton newWorkspace" onClick={createProject} disabled={loading}>
          <Plus size={17} /> 新建工作台
        </button>
        <div className="sidebarLabel">最近工作台</div>
        <section className="projectList">
          {projects.map((project) => (
            <div className={`projectItem ${project.id === activeId ? "active" : ""}`} key={project.id}>
              <button className="projectSelect" onClick={() => setActiveId(project.id)} disabled={loading}>
                <span>{project.name}</span><small>{project.archiveName || "等待资料包"}</small>
              </button>
              <button className="projectDelete" aria-label={`删除${project.name}`} title="删除工作台" onClick={() => deleteProject(project)} disabled={loading}><Trash2 size={15} /></button>
            </div>
          ))}
          {!projects.length ? <p className="sidebarEmpty">新建一个工作台开始。</p> : null}
        </section>
        <div className="sidebarNote">项目和结果保存在本机。资料包是唯一的产品信息入口。</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">工作台</p><h2>{activeProject?.name || "选择或新建工作台"}</h2></div>
          <button className="iconButton" onClick={() => refreshProjects(activeProject?.id)} aria-label="刷新工作台" title="刷新工作台"><RefreshCcw size={18} /></button>
        </header>
        {message ? <div className="notice">{message}</div> : null}

        {!activeProject ? (
          <div className="emptyWorkspace">
            <Archive size={32} /><h3>从资料包开始</h3><p>新建工作台后上传一个 `.zip`，产品信息、图片和文本都会自动进入资料区。</p>
            <button className="primaryButton" onClick={createProject} disabled={loading}><Plus size={17} /> 新建工作台</button>
          </div>
        ) : (
          <div className="contentGrid">
            <section className="mainColumn">
              <section className="uploadCard">
                <div className="uploadIntro"><div className="sectionKicker">INPUT / 01</div><h3>产品资料包</h3><p>{activeProject.archiveName || "上传压缩包，系统将自动读取可用资料。"}</p></div>
                <label className="uploadBox"><Archive size={22} /><span>{activeProject.archiveName || "上传 .zip 资料包"}</span><small>支持 Markdown、TXT 和图片</small><input type="file" accept=".zip" disabled={loading} onChange={(event) => uploadArchive(event.target.files?.[0])} /></label>
              </section>

              <section className="cardSection">
                <div className="sectionHeading"><div><div className="sectionKicker">MATERIALS / {String(readableFiles.length).padStart(2, "0")}</div><h3>资料可视化</h3></div><span className="sectionMeta">{imageFiles.length} 张图片 · {textFiles.length} 份文本</span></div>
                {files.length ? <div className="fileGrid">{files.map((file) => <FileCard key={file.id} file={file} projectId={activeProject.id} />)}</div> : <div className="emptyFiles"><FileText size={20} /><span>上传资料包后，这里会显示文件卡片。</span></div>}
              </section>

              <section className="cardSection">
                <div className="sectionHeading"><div><div className="sectionKicker">WORKFLOW / 03</div><h3>判断流程</h3></div><span className="sectionMeta">每一步都可单独重跑</span></div>
                <div className="steps">{steps.map((step) => <StepCard key={step.key} step={step} project={activeProject} loading={loading} runningStep={runningStep} onRun={runStep} onUploadRule={uploadRule} onRemoveRule={removeRule} />)}</div>
              </section>
            </section>
            <aside className="resultColumn"><ResultPanel project={activeProject} selectedRun={selectedRun} /></aside>
          </div>
        )}
      </section>
    </main>
  );
}

function FileCard({ file, projectId }: { file: ProjectFile; projectId: string }) {
  const isImage = file.kind === "image";
  return <article className={`fileCard ${isImage ? "imageFile" : "textFile"}`}>
    {isImage ? <img src={`/api/projects/${projectId}/files/${file.id}`} alt={file.name} /> : <div className="fileIcon"><FileText size={22} /></div>}
    <div className="fileInfo"><strong title={file.name}>{file.name.split("/").pop()}</strong><span>{file.kind === "markdown" ? "Markdown" : isImage ? "图片" : "文本"} · {formatSize(file.size)}</span></div>
  </article>;
}

function StepCard({ step, project, loading, runningStep, onRun, onUploadRule, onRemoveRule }: { step: typeof steps[number]; project: Project; loading: boolean; runningStep: StepKey | ""; onRun: (step: StepKey) => void; onUploadRule: (step: StepKey, file?: File) => void; onRemoveRule: (step: StepKey) => void }) {
  const rule = project.rules[step.key];
  const run = latestRun(project, step.key);
  const busy = runningStep === step.key;
  return <article className="stepCard"><div className="stepNumber">{step.index}</div><div className="stepBody"><div className="stepHeader"><div><h3>{step.label}</h3><p>{step.description}</p></div><button className="runButton" disabled={runningStep !== "" || !project.files.length} onClick={() => onRun(step.key)}>{busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}{run ? "重跑" : "运行"}</button></div><div className="ruleConsole"><div className="ruleName"><span className={`status ${rule?.enabled ? "enabled" : ""}`} /><strong>{rule?.enabled ? rule.fileName : "默认规则"}</strong></div><div className="ruleActions"><label className="smallButton"><Upload size={15} />上传 .md<input type="file" accept=".md" disabled={loading} onChange={(event) => onUploadRule(step.key, event.target.files?.[0])} /></label><button className="iconButton" aria-label="移除规则" title="移除规则" disabled={!rule?.enabled} onClick={() => onRemoveRule(step.key)}><Trash2 size={15} /></button></div></div>{rule?.enabled && rule.content ? <details className="rulePreview"><summary>查看当前规则</summary><pre>{rule.content}</pre></details> : null}{run ? <div className={`runSummary ${run.status}`}><span>{run.status === "completed" ? "已完成" : "失败"}</span><p>{run.summary}</p></div> : null}</div></article>;
}

function ResultPanel({ project, selectedRun }: { project: Project | null; selectedRun?: RunRecord }) {
  const result = selectedRun?.result as StepResult | undefined;
  const finalRun = latestRun(project, "visualStrategy");
  const visual = (finalRun?.result as StepResult | undefined)?.visualStrategy;
  return <div className="resultCard"><div className="resultHeader"><div><div className="sectionKicker">OUTPUT / AI</div><h3>{selectedRun ? selectedRun.step : "等待运行"}</h3></div>{result ? <span className={`confidence ${result.confidence}`}>{result.confidence}</span> : null}</div>{!selectedRun ? <div className="resultEmpty"><CheckCircle2 size={22} /><p>上传资料并运行任一步骤，AI 判断结果会显示在这里。</p></div> : null}{result ? <><section className="resultBlock"><h4>摘要</h4><p>{result.summary}</p></section><section className="resultBlock"><h4>缺失项</h4><List items={result.missingItems} empty="无" /></section><section className="resultBlock"><h4>冲突项</h4><List items={result.conflictItems} empty="无" /></section><section className="resultBlock"><h4>结构化数据包</h4><pre>{JSON.stringify(result.dataPackage || {}, null, 2)}</pre></section></> : null}{visual ? <section className="visualResult"><h4>最终视觉策略</h4><dl><dt>目标用户</dt><dd>{visual.targetUser}</dd><dt>购买动机</dt><dd>{visual.purchaseMotivation}</dd><dt>购买顾虑</dt><dd>{visual.purchaseConcerns}</dd><dt>差异化视觉定位</dt><dd>{visual.differentiatedVisualPositioning}</dd></dl><h5>跑图执行策略</h5><List items={visual.executionStrategy} empty="无" /></section> : null}</div>;
}

function List({ items, empty }: { items?: string[]; empty: string }) { if (!items?.length) return <p className="muted">{empty}</p>; return <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>; }
