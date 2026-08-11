const app = document.querySelector("#app");
const state = { projects: [], project: null, rules: [], loading: true, error: "" };

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
}[character]));

function currentStage() {
  return new URLSearchParams(location.hash.slice(1)).get("stage") || "input";
}

function selectedProjectId() {
  return new URLSearchParams(location.hash.slice(1)).get("project") || "";
}

function setRoute(stage, projectId = selectedProjectId()) {
  const params = new URLSearchParams({ stage });
  if (projectId) params.set("project", projectId);
  location.hash = params.toString();
}

async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `请求失败（${response.status}）`);
  return body;
}

async function loadProjects() {
  state.loading = true;
  state.error = "";
  render();
  try {
    const data = await request("/api/projects");
    state.projects = data.projects;
    state.rules = (await request("/api/rules")).rules;
    const projectId = selectedProjectId();
    state.project = projectId ? await request(`/api/projects/${projectId}`) : null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "无法读取本地项目";
  } finally {
    state.loading = false;
    render();
  }
}

function navItem(stage, label, index) {
  const active = currentStage() === stage;
  const locked = stage !== "input" && !state.project;
  return `<button class="stage-link ${active ? "active" : ""}" data-stage="${stage}" ${locked ? "disabled" : ""}>
    <span>${index}</span>${label}${locked ? "<small>需要项目</small>" : ""}
  </button>`;
}

function projectSummary() {
  if (!state.project) return `<div class="sidebar-empty">尚未选择项目</div>`;
  const version = state.project.versions.find((item) => item.version_id === state.project.current_version_id);
  return `<div class="project-summary"><strong>${escapeHtml(state.project.name)}</strong><span>版本 ${escapeHtml(version?.version_number || "-")}</span><span>${state.project.files.length} 个文件</span></div>`;
}

function inputPage() {
  return `<section class="page-grid">
    <aside class="control-panel">
      <p class="panel-label">项目控制</p>
      ${projectSummary()}
      <label class="select-label">切换项目<select id="project-select"><option value="">选择已有项目</option>${state.projects.map((item) => `<option value="${item.project_id}" ${item.project_id === state.project?.project_id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
    </aside>
    <div class="main-panel">
      <header class="page-header"><p class="eyebrow">第一阶段</p><h1>产品需求输入</h1><p>建立本地项目，保存产品资料并准备产品理解。</p></header>
      <section class="work-section"><h2>创建项目</h2><form id="project-form" class="inline-form"><input name="name" required maxlength="100" placeholder="项目名称" aria-label="项目名称" /><button>创建项目</button></form></section>
      <section class="work-section ${state.project ? "" : "disabled-section"}"><h2>产品资料</h2><p>支持 Markdown、Excel 和图片。上传会生成新的项目版本。</p><form id="upload-form"><input id="file-input" name="files" type="file" multiple accept=".md,.markdown,.xlsx,.jpg,.jpeg,.png,.webp,.gif" ${state.project ? "" : "disabled"}/><button ${state.project ? "" : "disabled"}>保存资料</button></form>${state.project ? fileList() : ""}</section>
      <section class="work-section ${state.project ? "" : "disabled-section"}"><h2>当前规则</h2><p>规则原文按版本保存。每类规则只可选择一条。</p>${ruleControls()}</section>
    </div>
  </section>`;
}

const ruleTypes = [
  ["product_validation", "产品事实校验"],
  ["image_search", "图片搜索"],
  ["visual_planning", "视觉策划"],
];

function ruleControls() {
  const bindings = state.project?.rule_bindings || {};
  return `<form id="rule-binding-form" class="rule-grid">${ruleTypes.map(([type, label]) => `<label>${label}<select name="${type}" ${state.project ? "" : "disabled"}><option value="">暂不选择</option>${state.rules.filter((rule) => rule.rule_type === type).map((rule) => `<option value="${rule.rule_id}" ${bindings[type]?.rule_id === rule.rule_id ? "selected" : ""}>${escapeHtml(rule.name)} · ${escapeHtml(rule.version)}</option>`).join("")}</select></label>`).join("")}<button ${state.project ? "" : "disabled"}>保存规则绑定</button></form><form id="rule-upload-form" class="inline-form rule-upload"><input name="name" required maxlength="100" placeholder="规则名称" ${state.project ? "" : "disabled"}/><select name="rule_type" ${state.project ? "" : "disabled"}>${ruleTypes.map(([type, label]) => `<option value="${type}">${label}</option>`).join("")}</select><input name="file" type="file" accept=".md,.markdown" required ${state.project ? "" : "disabled"}/><button ${state.project ? "" : "disabled"}>保存新规则</button></form>`;
}

function fileList() {
  if (!state.project.files.length) return `<p class="empty-copy">当前版本尚未保存资料。</p>`;
  return `<ul class="file-list">${state.project.files.map((file) => `<li><span>${escapeHtml(file.original_name)}</span><small>${escapeHtml(file.kind)} · ${file.size_bytes} B</small></li>`).join("")}</ul>`;
}

function lockedPage(stage) {
  const label = stage === "research" ? "规则校验与设计调研" : "视觉看板";
  return `<section class="placeholder-page"><p class="eyebrow">${stage === "research" ? "第二阶段" : "第三阶段"}</p><h1>${label}</h1><p>${state.project ? "此阶段将在后续任务中实现，并保持手动启动。" : "请先在第一阶段创建或选择项目。"}</p><button data-stage="input">返回产品需求输入</button></section>`;
}

function render() {
  const stage = currentStage();
  const body = state.loading ? `<div class="loading">正在读取本地项目</div>` : state.error ? `<div class="error-state"><h2>无法读取本地服务</h2><p>${escapeHtml(state.error)}</p><button id="retry">重新连接</button></div>` : stage === "input" ? inputPage() : lockedPage(stage);
  app.innerHTML = `<header class="topbar"><a class="brand" href="#stage=input">服装视觉设计分析</a><nav>${navItem("input", "产品输入", "01")}${navItem("research", "规则校验与调研", "02")}${navItem("board", "视觉看板", "03")}</nav><div class="top-status">${state.project ? "本地已保存" : "等待项目"}</div></header><main>${body}</main>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-stage]").forEach((button) => button.addEventListener("click", () => setRoute(button.dataset.stage)));
  document.querySelector("#retry")?.addEventListener("click", loadProjects);
  document.querySelector("#project-select")?.addEventListener("change", (event) => setRoute("input", event.target.value));
  document.querySelector("#project-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button"); button.disabled = true; button.textContent = "正在创建";
    try { const project = await request("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: new FormData(event.currentTarget).get("name") }) }); setRoute("input", project.project_id); } catch (error) { state.error = error.message; render(); }
  });
  document.querySelector("#upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const formData = new FormData(event.currentTarget); const button = event.currentTarget.querySelector("button");
    if (!formData.getAll("files").some((file) => file.size)) { state.error = "请选择至少一个文件"; render(); return; }
    button.disabled = true; button.textContent = "正在保存";
    try { await request(`/api/projects/${state.project.project_id}/files`, { method: "POST", body: formData }); await loadProjects(); } catch (error) { state.error = error.message; render(); }
  });
  document.querySelector("#rule-binding-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button"); button.disabled = true; button.textContent = "正在保存";
    const bindings = Object.fromEntries([...new FormData(event.currentTarget).entries()].filter(([, value]) => value));
    try { await request(`/api/projects/${state.project.project_id}/rules`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bindings }) }); await loadProjects(); } catch (error) { state.error = error.message; render(); }
  });
  document.querySelector("#rule-upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get("file"); const button = event.currentTarget.querySelector("button"); button.disabled = true; button.textContent = "正在保存";
    try { await request("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), rule_type: form.get("rule_type"), content: await file.text() }) }); await loadProjects(); } catch (error) { state.error = error.message; render(); }
  });
}

window.addEventListener("hashchange", loadProjects);
loadProjects();
