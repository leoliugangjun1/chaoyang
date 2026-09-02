const root = document.querySelector('#action-variation-app');
const TEMPLATE_CATEGORY = 'action-variation';
const STORAGE_KEY = 'ai-image-workbench.action-variation.workspace.v1';
const RATIO_OPTIONS = ['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'];
const PROVIDERS = ['image2', 'nano_banana'];
const EXPECTED_JOB_COUNT = 24;

let sessionToken = '';
let editingTemplateId = null;
const imageUrls = new Map();
const state = {
  sourceAsset: null,
  sourceInfo: null,
  templates: [],
  selectedTemplateIds: [],
  extraPrompt: '',
  providers: { image2: true, nano_banana: true },
  outputCount: 1,
  aspectRatio: 'auto',
  resolutionTier: '2K',
  batches: [],
  jobsById: new Map(),
  resultsView: 'provider',
  selectedResultIds: [],
  notice: null,
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const isActiveTask = (task) => ['queued', 'running', 'processing'].includes(task?.status);
const sourceUrl = (asset) => asset?.url || (asset?.assetId ? `/api/assets/${asset.assetId}` : '');
const selectedTemplates = () => state.selectedTemplateIds.map((id) => state.templates.find((template) => template.id === id)).filter(Boolean);

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', 'x-workbench-session': sessionToken, ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '请求失败。');
  return data;
}

function snapshotAsset(asset) {
  return asset?.assetId ? { assetId: asset.assetId, name: asset.name, mimeType: asset.mimeType } : null;
}

function persistWorkspace() {
  const snapshot = {
    sourceAsset: snapshotAsset(state.sourceAsset),
    sourceInfo: state.sourceInfo,
    selectedTemplateIds: state.selectedTemplateIds,
    extraPrompt: state.extraPrompt,
    providers: state.providers,
    outputCount: 1,
    aspectRatio: state.aspectRatio,
    resolutionTier: state.resolutionTier,
    resultsView: state.resultsView,
    selectedResultIds: state.selectedResultIds,
    batches: state.batches.map((batch) => ({ id: batch.id })),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

async function restoreAsset(asset) {
  if (!asset?.assetId) return null;
  const url = sourceUrl(asset);
  const response = await fetch(url, { headers: { 'x-workbench-session': sessionToken } });
  if (!response.ok) return null;
  const preview = URL.createObjectURL(await response.blob());
  imageUrls.set(url, preview);
  return { ...asset, url, preview };
}

async function restoreWorkspace() {
  let snapshot;
  try { snapshot = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'); } catch { window.localStorage.removeItem(STORAGE_KEY); return; }
  if (!snapshot) return;
  state.sourceAsset = await restoreAsset(snapshot.sourceAsset);
  state.sourceInfo = snapshot.sourceInfo || null;
  state.extraPrompt = snapshot.extraPrompt || '';
  state.providers = { image2: snapshot.providers?.image2 !== false, nano_banana: snapshot.providers?.nano_banana !== false };
  state.outputCount = 1;
  state.aspectRatio = RATIO_OPTIONS.includes(snapshot.aspectRatio) ? snapshot.aspectRatio : 'auto';
  state.resolutionTier = ['1K', '2K', '4K'].includes(snapshot.resolutionTier) ? snapshot.resolutionTier : '2K';
  state.resultsView = snapshot.resultsView === 'action' ? 'action' : 'provider';
  state.selectedResultIds = Array.isArray(snapshot.selectedResultIds) ? snapshot.selectedResultIds : [];
  state.selectedTemplateIds = (snapshot.selectedTemplateIds || []).filter((id) => state.templates.some((template) => template.id === id));
  state.batches = (await Promise.all((snapshot.batches || []).map(async (batch) => {
    try { return batchFromApi((await api(`/api/action-variation/batches/${batch.id}`)).batch); } catch { return null; }
  }))).filter(Boolean);
}

async function syncTemplates() {
  const data = await api('/api/templates');
  state.templates = (data.templates || []).filter((template) => template.category === TEMPLATE_CATEGORY).sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  state.selectedTemplateIds = state.selectedTemplateIds.filter((id) => state.templates.some((template) => template.id === id));
}

function showNotice(message, type = 'error') {
  state.notice = { message, type };
  render();
}

function sourceCard() {
  const preview = state.sourceAsset ? `<img src="${escapeHtml(state.sourceAsset.preview)}" alt="主体参考图">` : '<span class="av-upload-mark">+</span><strong>上传主体参考图</strong><small>jpg、jpeg、png、webp</small>';
  return `<section class="av-source-card ${state.sourceAsset ? 'has-image' : ''}" id="sourceCard"><div class="av-section-label"><span>01</span><b>主体参考图</b><small>动作裂变的身份与服装基准</small></div><div class="av-source-preview">${preview}</div><input id="sourceInput" type="file" accept="image/jpeg,image/png,image/webp" hidden><div class="av-source-actions"><button type="button" id="chooseSource">${state.sourceAsset ? '替换图片' : '选择图片'}</button>${state.sourceAsset ? '<button type="button" class="av-text-button" id="clearSource">清除</button>' : ''}</div></section>`;
}

function templateList() {
  if (!state.templates.length) return '<p class="av-empty-templates">尚未建立动作模板。</p>';
  const selected = new Set(state.selectedTemplateIds);
  return state.templates.map((template) => `<article class="av-template ${selected.has(template.id) ? 'selected' : ''}" data-template-id="${escapeHtml(template.id)}"><label><input type="checkbox" ${selected.has(template.id) ? 'checked' : ''}><span><b>${escapeHtml(template.name)}</b><small>${escapeHtml(template.prompt)}</small></span></label><div class="av-template-actions"><button type="button" data-edit-template="${escapeHtml(template.id)}" title="编辑">编辑</button><button type="button" data-delete-template="${escapeHtml(template.id)}" title="删除">删除</button></div></article>`).join('');
}

function ratioOptions() {
  return RATIO_OPTIONS.map((ratio) => `<button type="button" class="av-ratio ${state.aspectRatio === ratio ? 'selected' : ''}" data-ratio="${ratio}"><i class="${ratio === 'auto' ? 'auto' : ''}"${ratio === 'auto' ? '' : ` style="aspect-ratio:${ratio}"`}></i><span>${ratio === 'auto' ? 'Auto' : ratio}</span></button>`).join('');
}

function jobFor(batch, row, provider) {
  return batch.jobIds.map((jobId) => state.jobsById.get(jobId)).find((job) => job?.actionId === row.actionId && job.provider === provider) || null;
}

function generationProgress(batch) {
  const jobs = batch.jobIds.map((jobId) => state.jobsById.get(jobId)).filter(Boolean);
  const completed = jobs.filter((job) => ['success', 'error'].includes(job.status)).length;
  return { completed, total: EXPECTED_JOB_COUNT, ratio: completed / EXPECTED_JOB_COUNT };
}

function jobStatusText(job) {
  if (job?.status === 'success') return '完成';
  if (job?.status === 'error') return '失败';
  return job?.status === 'loading' ? '生成中' : '等待生成';
}

function providerPresentation(provider) {
  return provider === 'image2' ? { label: 'Provider A', shortLabel: 'A' } : { label: 'Provider B', shortLabel: 'B' };
}

function actionResultCard(batch, row, provider, actionIndex) {
  const job = jobFor(batch, row, provider);
  const presentation = providerPresentation(provider);
  const actionNumber = job?.actionId?.slice(-2) || String(actionIndex + 1).padStart(2, '0');
  const status = jobStatusText(job);
  const statusClass = job?.status === 'error' ? 'failed' : job?.status === 'loading' ? 'working' : '';
  const details = `<figcaption><span class="av-result-number">#${escapeHtml(actionNumber)}</span><b>${escapeHtml(row.templateName)}</b><span class="av-provider-tag">${presentation.shortLabel}</span><span class="av-result-status ${statusClass}">${status}</span></figcaption>`;
  if (job?.result) return `<figure class="av-result av-provider-result ${state.selectedResultIds.includes(job.jobId) ? 'chosen' : ''}"><button type="button" class="av-preview-trigger" data-preview-result="${escapeHtml(job.jobId)}" data-source="${escapeHtml(job.result)}"><img data-asset-source="${escapeHtml(job.result)}" alt="#${escapeHtml(actionNumber)} ${escapeHtml(row.templateName)}"></button>${details}<button type="button" class="av-select-result" data-result-id="${escapeHtml(job.jobId)}">${state.selectedResultIds.includes(job.jobId) ? '取消选择' : '选择'}</button></figure>`;
  if (job?.status === 'error') return `<figure class="av-result av-provider-result failed"><div class="av-result-placeholder"><span class="av-status-icon" aria-hidden="true">!</span><span>生成失败</span></div>${details}<button type="button" class="av-retry-result" data-retry-job="${escapeHtml(job.jobId)}">重试</button></figure>`;
  return `<figure class="av-result av-provider-result pending"><div class="av-result-placeholder"><span class="av-loading-spinner" aria-hidden="true"></span><span>${status}</span></div>${details}</figure>`;
}

function providerResultSection(batch, provider) {
  const presentation = providerPresentation(provider);
  const rows = batch.actionRows.filter((row) => jobFor(batch, row, provider));
  const complete = rows.filter((row) => jobFor(batch, row, provider)?.status === 'success').length;
  return `<section class="av-provider-group" data-provider="${provider}"><header><div><p>${presentation.label.toUpperCase()}</p><h3>${presentation.label}</h3></div><span>${complete}/12 完成</span></header><div class="av-provider-result-grid">${rows.map((row, index) => actionResultCard(batch, row, provider, index)).join('')}</div></section>`;
}

function actionComparisonRows(batch) {
  return `<div class="av-action-compare-list">${batch.actionRows.map((row, index) => `<section class="av-action-compare-row"><header><span>#${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(row.templateName)}</b></header><div class="av-action-compare-cards">${actionResultCard(batch, row, 'image2', index)}${actionResultCard(batch, row, 'nano_banana', index)}</div></section>`).join('')}</div>`;
}

function resultsViewTabs() {
  return `<div class="av-results-tabs"><button type="button" data-results-view="provider" class="${state.resultsView === 'provider' ? 'active' : ''}">按 Provider 分组</button><button type="button" data-results-view="action" class="${state.resultsView === 'action' ? 'active' : ''}">按动作对比</button></div>`;
}

function batchRows() {
  if (!state.batches.length) return '<div class="av-results-empty"><span>+</span><h2>等待动作候选任务</h2><p>生成完成后将按 Provider 分组展示独立动作图片。</p></div>';
  return state.batches.map((batch) => {
    const progress = generationProgress(batch);
    const percent = Math.round(progress.ratio * 100);
    const content = state.resultsView === 'action' ? actionComparisonRows(batch) : `${providerResultSection(batch, 'image2')}${providerResultSection(batch, 'nano_banana')}`;
    return `<section class="av-result-batch"><header class="av-result-batch-header"><div><p class="eyebrow">ACTION CANDIDATES</p><h3>动作候选结果</h3></div><div class="av-batch-progress"><b>生成中 ${progress.completed}/24</b><div class="av-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="24" aria-valuenow="${progress.completed}"><i style="width:${percent}%"></i></div></div></header>${resultsViewTabs()}${content}</section>`;
  }).join('');
}

function render() {
  const enabledProviderCount = Object.values(state.providers).filter(Boolean).length;
  const selectedCount = state.selectedTemplateIds.length;
  const expected = selectedCount * enabledProviderCount * state.outputCount;
  root.innerHTML = `<header class="topbar"><div class="brand"><span class="brand-mark">*</span><div><strong>影像实验室</strong><small>VIRTUAL MODEL WORKBENCH</small></div></div><div class="top-status"><span class="online-dot"></span> 服务在线 <button class="ghost" type="button">设置</button><span class="avatar">A</span></div></header><div class="shell"><aside class="sidebar"><div class="side-title">生图工作台</div><a class="nav" href="/"><span>基础生图</span></a><a class="nav" href="/virtual-model.html"><span>虚拟模特合成</span></a><a class="nav active" href="/action-variation.html" aria-current="page"><span>模特动作裂变</span></a><button class="nav" type="button"><span>生成历史</span></button></aside><main class="av-main"><aside class="av-controls"><div class="av-heading"><p class="eyebrow">ACTION VARIATION / 03</p><h1>模特动作裂变</h1><p>围绕同一主体扩展可选动作。</p></div>${sourceCard()}<section class="av-template-panel"><div class="av-section-label"><span>02</span><b>动作模板</b><button type="button" class="av-add-template" id="openTemplateDialog">添加模板</button></div><p class="av-template-help">当前后端固定生成 12 个标准动作；模板选择用于兼容既有工作流。</p><div id="templateList">${templateList()}</div></section><section class="av-settings"><div class="av-section-label"><span>03</span><b>生成设置</b></div><label>补充动作要求<textarea id="extraPrompt" maxlength="1000" placeholder="例如：镜头略低，肢体舒展，保持面部与服装一致性。">${escapeHtml(state.extraPrompt)}</textarea></label><div class="av-settings-row"><label>候选数量<select id="outputCount">${[1].map((count) => `<option value="${count}" selected>${count} 张 / 动作 / Provider</option>`).join('')}</select></label><label>分辨率<select id="resolutionTier">${['1K', '2K', '4K'].map((tier) => `<option value="${tier}" ${state.resolutionTier === tier ? 'selected' : ''}>${tier}</option>`).join('')}</select></label></div><label>画幅比例<div class="av-ratio-grid">${ratioOptions()}</div></label><fieldset><legend>Provider</legend><label><input type="checkbox" data-provider="image2" ${state.providers.image2 ? 'checked' : ''}> image2</label><label><input type="checkbox" data-provider="nano_banana" ${state.providers.nano_banana ? 'checked' : ''}> Google</label></fieldset></section><button type="button" class="av-generate" id="generate">开始动作裂变</button><p class="av-estimate">已选择 ${selectedCount} 个模板，预计提交 ${selectedCount ? 12 * enabledProviderCount : 0} 项任务，生成 ${selectedCount ? 12 * enabledProviderCount : expected} 张候选。</p>${state.notice ? `<p class="av-notice ${state.notice.type}">${escapeHtml(state.notice.message)}</p>` : ''}</aside><section class="av-results"><header class="av-results-header"><div><p class="eyebrow">TASK RESULTS</p><h2>动作候选</h2></div><button type="button" id="downloadSelected" ${state.selectedResultIds.length ? '' : 'disabled'}>下载已选 ${state.selectedResultIds.length || ''}</button></header><div class="av-task-list">${batchRows()}</div></section></main></div><dialog class="av-dialog" id="templateDialog"><form method="dialog"><header><h2>${editingTemplateId ? '编辑动作模板' : '新建动作模板'}</h2><button type="button" id="closeTemplateDialog" aria-label="关闭">x</button></header><label>模板名称<input id="templateName" maxlength="40" placeholder="例如：自然行走"></label><label>动作指令<textarea id="templatePrompt" maxlength="1000" placeholder="描述姿势、肢体关系和镜头要求，并要求保持主体身份、服装与图像质量。"></textarea></label><footer><button type="button" id="cancelTemplate">取消</button><button type="submit">保存</button></footer></form></dialog><dialog class="av-preview" id="previewDialog"><button type="button" id="closePreview" aria-label="关闭">x</button><img id="previewImage" alt="生成结果预览"><footer><button type="button" id="toggleSelection">选中</button><button type="button" id="downloadPreview">下载</button></footer></dialog><dialog class="av-prompt" id="promptDialog"><header><h2>本动作最终指令</h2><button type="button" id="closePrompt" aria-label="关闭">x</button></header><pre id="promptContent"></pre></dialog>`;
  document.querySelector('#outputCount').disabled = true;
  bind();
  hydrateImages();
}

async function uploadSource(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return showNotice('仅支持 jpg、jpeg、png、webp 图片。', 'error');
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  try {
    const result = await api('/api/assets', { method: 'POST', body: JSON.stringify({ name: file.name, mimeType: file.type, data }) });
    state.sourceAsset = { ...result.asset, preview: data };
    const image = new Image();
    image.src = data;
    await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
    const ratio = image.naturalWidth && image.naturalHeight ? closestRatio(image.naturalWidth / image.naturalHeight) : 'auto';
    state.sourceInfo = { width: image.naturalWidth, height: image.naturalHeight, aspectRatio: ratio };
    if (state.aspectRatio === 'auto') state.aspectRatio = ratio;
    state.notice = null;
    persistWorkspace();
    render();
  } catch (error) { showNotice(error.message, 'error'); }
}

function closestRatio(value) {
  return RATIO_OPTIONS.slice(1).reduce((best, candidate) => {
    const [width, height] = candidate.split(':').map(Number);
    const [bestWidth, bestHeight] = best.split(':').map(Number);
    return Math.abs(Math.log((width / height) / value)) < Math.abs(Math.log((bestWidth / bestHeight) / value)) ? candidate : best;
  }, '1:1');
}

function batchFromApi(batch) {
  const jobs = batch.jobs || [];
  for (const job of jobs) state.jobsById.set(job.jobId, job);
  return {
    id: batch.batchId,
    createdAt: new Date(batch.createdAt).toLocaleString('zh-CN'),
    subjectProfile: batch.subjectProfile || '',
    jobIds: jobs.map((job) => job.jobId),
    actionRows: (batch.actionPlans || []).map((plan) => ({
      actionId: plan.templateId,
      templateId: plan.actionPlanId,
      templateName: plan.name,
      actionGuidance: plan.actionGuidance || '',
      prompt: plan.generationPrompt,
      providerTasks: plan.providerTasks || {},
    })),
  };
}

async function submitPlannedGeneration() {
  if (!state.sourceAsset) return showNotice('请先上传主体参考图。');
  const templates = selectedTemplates();
  if (!templates.length) return showNotice('请至少选择一个动作模板。');
  const providers = Object.entries(state.providers).filter(([, enabled]) => enabled).map(([provider]) => provider);
  if (!providers.length) return showNotice('请至少选择一个 Provider。');
  const button = document.querySelector('#generate');
  button.disabled = true;
  try {
    const settings = { mode: 'image_to_image', aspectRatio: state.aspectRatio, resolutionTier: state.resolutionTier, quality: 'auto', background: 'auto' };
    const data = await api('/api/action-variation/batches', { method: 'POST', body: JSON.stringify({ sourceAssetId: state.sourceAsset.assetId, templateIds: templates.map((template) => template.id), providers, settings, extraPrompt: state.extraPrompt }) });
    const batch = batchFromApi(data.batch);
    state.batches.unshift(batch);
    state.notice = { type: 'notice', message: `已创建 ${batch.actionRows.length} 个标准动作，并提交 ${batch.jobIds.length} 项独立任务。` };
    persistWorkspace();
    render();
    pollActionBatch(batch.id);
  } catch (error) { showNotice(error.message, 'error'); } finally { button.disabled = false; }
}

async function pollActionBatch(batchId) {
  try {
    const data = await api(`/api/action-variation/batches/${batchId}`);
    const index = state.batches.findIndex((batch) => batch.id === batchId);
    if (index === -1) return;
    state.batches[index] = batchFromApi(data.batch);
    persistWorkspace();
    if (!document.querySelector('dialog[open]')) render();
    const active = data.batch.actionPlans?.some((plan) => Object.values(plan.providerTasks || {}).some(isActiveTask));
    if (active) setTimeout(() => pollActionBatch(batchId), 1000);
  } catch (error) { showNotice(error.message, 'error'); }
}

async function hydrateImages() {
  for (const image of document.querySelectorAll('[data-asset-source]')) {
    const source = image.dataset.assetSource;
    if (imageUrls.has(source)) { image.src = imageUrls.get(source); continue; }
    try {
      const response = await fetch(source, { headers: { 'x-workbench-session': sessionToken } });
      if (!response.ok) throw new Error('asset unavailable');
      const url = URL.createObjectURL(await response.blob());
      imageUrls.set(source, url);
      image.src = url;
    } catch { image.closest('.av-result')?.classList.add('failed'); }
  }
}

function resultFor(jobId) {
  const job = state.jobsById.get(jobId);
  return job?.result ? { id: job.jobId, url: job.result } : null;
}

async function downloadResults(ids) {
  const results = ids.map(resultFor).filter(Boolean);
  for (const [index, result] of results.entries()) {
    const source = result.url;
    let url = imageUrls.get(source);
    if (!url) {
      const response = await fetch(source, { headers: { 'x-workbench-session': sessionToken } });
      if (!response.ok) continue;
      url = URL.createObjectURL(await response.blob());
      imageUrls.set(source, url);
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `action-variation-${String(index + 1).padStart(2, '0')}.png`;
    anchor.click();
  }
}

async function retrySingleJob(jobId) {
  const job = state.jobsById.get(jobId);
  if (!job || job.status === 'loading') return;
  const batch = state.batches.find((candidate) => candidate.jobIds.includes(jobId));
  if (!batch) return showNotice('未找到动作任务。', 'error');
  state.jobsById.set(jobId, { ...job, status: 'loading', result: null, error: null });
  render();
  try {
    const data = await api(`/api/action-variation/jobs/${jobId}/retry`, { method: 'POST', body: '{}' });
    const refreshed = batchFromApi(data.batch);
    const index = state.batches.findIndex((candidate) => candidate.id === batch.id);
    if (index !== -1) state.batches[index] = refreshed;
    persistWorkspace();
    render();
    pollActionBatch(batch.id);
  } catch (error) {
    state.jobsById.set(jobId, { ...job, status: 'error', error: error.message });
    render();
    showNotice(error.message, 'error');
  }
}

function openTemplateDialog(template) {
  editingTemplateId = template?.id || null;
  const dialog = document.querySelector('#templateDialog');
  dialog.querySelector('#templateName').value = template?.name || '';
  dialog.querySelector('#templatePrompt').value = template?.prompt || '';
  dialog.showModal();
}

function bind() {
  const sourceInput = document.querySelector('#sourceInput');
  document.querySelector('#chooseSource').onclick = () => sourceInput.click();
  sourceInput.onchange = () => uploadSource(sourceInput.files[0]);
  document.querySelector('#sourceCard').ondragover = (event) => event.preventDefault();
  document.querySelector('#sourceCard').ondrop = (event) => { event.preventDefault(); uploadSource(event.dataTransfer.files[0]); };
  document.querySelector('#clearSource')?.addEventListener('click', () => { state.sourceAsset = null; state.sourceInfo = null; persistWorkspace(); render(); });
  document.querySelector('#extraPrompt').oninput = (event) => { state.extraPrompt = event.target.value; persistWorkspace(); };
  document.querySelector('#resolutionTier').onchange = (event) => { state.resolutionTier = event.target.value; persistWorkspace(); };
  document.querySelectorAll('[data-ratio]').forEach((button) => { button.onclick = () => { state.aspectRatio = button.dataset.ratio; persistWorkspace(); render(); }; });
  document.querySelectorAll('[data-provider]').forEach((checkbox) => {
    checkbox.onchange = (event) => {
      const provider = event.target.dataset.provider;
      if (!event.target.checked && !PROVIDERS.some((name) => name !== provider && state.providers[name])) {
        event.target.checked = true;
        return showNotice('至少保留一个 Provider。');
      }
      state.providers[provider] = event.target.checked;
      persistWorkspace();
      render();
    };
  });
  document.querySelectorAll('[data-template-id]').forEach((row) => {
    row.querySelector('input').onchange = (event) => {
      const id = row.dataset.templateId;
      state.selectedTemplateIds = event.target.checked ? [...state.selectedTemplateIds, id] : state.selectedTemplateIds.filter((value) => value !== id);
      persistWorkspace();
      render();
    };
  });
  document.querySelector('#openTemplateDialog').onclick = () => openTemplateDialog();
  document.querySelectorAll('[data-edit-template]').forEach((button) => { button.onclick = () => openTemplateDialog(state.templates.find((template) => template.id === button.dataset.editTemplate)); });
  document.querySelectorAll('[data-delete-template]').forEach((button) => {
    button.onclick = async () => {
      try {
        await api(`/api/templates/${button.dataset.deleteTemplate}`, { method: 'PATCH', body: JSON.stringify({ category: `${TEMPLATE_CATEGORY}-deleted` }) });
        state.selectedTemplateIds = state.selectedTemplateIds.filter((id) => id !== button.dataset.deleteTemplate);
        await syncTemplates();
        persistWorkspace();
        render();
      } catch (error) { showNotice(error.message, 'error'); }
    };
  });
  const templateDialog = document.querySelector('#templateDialog');
  templateDialog.querySelector('#closeTemplateDialog').onclick = () => templateDialog.close();
  templateDialog.querySelector('#cancelTemplate').onclick = () => templateDialog.close();
  templateDialog.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const name = templateDialog.querySelector('#templateName').value.trim();
    const prompt = templateDialog.querySelector('#templatePrompt').value.trim();
    if (!name || !prompt) return;
    try {
      const payload = { category: TEMPLATE_CATEGORY, name, prompt };
      if (editingTemplateId) await api(`/api/templates/${editingTemplateId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/templates', { method: 'POST', body: JSON.stringify(payload) });
      await syncTemplates();
      persistWorkspace();
      templateDialog.close();
      render();
    } catch (error) { showNotice(error.message, 'error'); }
  };
  document.querySelector('#generate').onclick = submitPlannedGeneration;
  document.querySelectorAll('[data-results-view]').forEach((button) => { button.onclick = () => { state.resultsView = button.dataset.resultsView; persistWorkspace(); render(); }; });
  document.querySelectorAll('[data-result-id]').forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.resultId;
      state.selectedResultIds = state.selectedResultIds.includes(id) ? state.selectedResultIds.filter((value) => value !== id) : [...state.selectedResultIds, id];
      persistWorkspace();
      render();
    };
  });
  document.querySelectorAll('[data-retry-job]').forEach((button) => { button.onclick = () => retrySingleJob(button.dataset.retryJob); });
  document.querySelectorAll('[data-preview-result]').forEach((button) => {
    button.onclick = () => {
      const dialog = document.querySelector('#previewDialog');
      dialog.dataset.resultId = button.dataset.previewResult;
      dialog.dataset.source = button.dataset.source;
      dialog.querySelector('#previewImage').src = imageUrls.get(button.dataset.source) || '';
      dialog.querySelector('#toggleSelection').textContent = state.selectedResultIds.includes(button.dataset.previewResult) ? '取消选中' : '选中';
      dialog.showModal();
    };
  });
  document.querySelector('#downloadSelected').onclick = () => downloadResults(state.selectedResultIds).catch((error) => showNotice(error.message, 'error'));
  const preview = document.querySelector('#previewDialog');
  preview.querySelector('#closePreview').onclick = () => preview.close();
  preview.querySelector('#toggleSelection').onclick = () => {
    const id = preview.dataset.resultId;
    state.selectedResultIds = state.selectedResultIds.includes(id) ? state.selectedResultIds.filter((value) => value !== id) : [...state.selectedResultIds, id];
    persistWorkspace();
    preview.close();
    render();
  };
  preview.querySelector('#downloadPreview').onclick = () => downloadResults([preview.dataset.resultId]).catch((error) => showNotice(error.message, 'error'));
  document.querySelectorAll('[data-show-prompt]').forEach((button) => { button.onclick = () => { document.querySelector('#promptContent').textContent = button.dataset.prompt; document.querySelector('#promptDialog').showModal(); }; });
  document.querySelector('#closePrompt').onclick = () => document.querySelector('#promptDialog').close();
}

async function boot() {
  try {
    const health = await fetch('/api/health').then((response) => response.json());
    sessionToken = health.sessionToken;
    await syncTemplates();
    await restoreWorkspace();
    render();
    for (const batch of state.batches) {
      if (batch.jobIds.some((jobId) => ['pending', 'loading'].includes(state.jobsById.get(jobId)?.status))) pollActionBatch(batch.id);
    }
  } catch (error) { root.innerHTML = `<main class="offline"><h1>无法连接工作台</h1><p>${escapeHtml(error.message)}</p></main>`; }
}

boot();
