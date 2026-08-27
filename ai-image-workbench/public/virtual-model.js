const root = document.querySelector('#virtual-model-app');
const INSTRUCTION_STORAGE_KEY = 'ai-image-workbench.virtual-model.instructions.v1';
const WORKSPACE_STORAGE_KEY = 'ai-image-workbench.virtual-model.workspace.v1';
const DEFAULT_FUSION_PROMPT = 'Create a natural fusion of the two reference images, combining their most attractive features into one cohesive person. Preserve the body proportions, pose, and composition of reference image 1 as the foundation. Blend the facial features and hairstyle from reference image 2 with the attractive facial and overall appearance characteristics of reference image 1. Harmonize the identity, facial structure, hairstyle, skin tone, proportions, and visual characteristics so the result looks like a naturally unified person. Do not simply copy or swap the face from either reference. The final person should feel like a seamless combination of the strongest visual features from both images. Keep the pose, body structure, and composition of reference image 1 unchanged unless explicitly instructed otherwise.';

let sessionToken = '';
let editingInstructionId = null;
let viewerItems = [];
let viewerIndex = 0;
const imageCache = new Map();
const state = {
  primaryAsset: null,
  primaryImageInfo: null,
  secondaryAsset: null,
  prompt: '',
  instructions: loadInstructions(),
  selectedInstructionIds: [],
  selectedResultIds: [],
  providers: { image2: true, nano_banana: true },
  generatedBatches: [],
  generatedBatch: null,
  promptPreview: '',
  alert: null,
};

function loadInstructions() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(INSTRUCTION_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveInstructions() {
  window.localStorage.setItem(INSTRUCTION_STORAGE_KEY, JSON.stringify(state.instructions));
}

function templateToInstruction(template) {
  return { id: template.id, name: template.name, content: template.prompt, createdAt: template.createdAt, updatedAt: template.updatedAt };
}

async function syncInstructions({ migrateLocal = false } = {}) {
  const data = await api('/api/templates');
  let templates = (data.templates || []).filter((template) => template.category === 'virtual-model').sort((left, right) => (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER));
  if (!templates.length && migrateLocal && state.instructions.length) {
    for (const instruction of state.instructions) await api('/api/templates', { method: 'POST', body: JSON.stringify({ category: 'virtual-model', name: instruction.name, prompt: instruction.content }) });
    templates = ((await api('/api/templates')).templates || []).filter((template) => template.category === 'virtual-model').sort((left, right) => (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER));
  }
  state.instructions = templates.map(templateToInstruction);
  state.selectedInstructionIds = state.selectedInstructionIds.filter((id) => state.instructions.some((instruction) => instruction.id === id));
  saveInstructions();
}

function savedAsset(asset) {
  if (!asset?.assetId) return null;
  return { assetId: asset.assetId, name: asset.name, mimeType: asset.mimeType };
}

function savedBatch(batch) {
  return { id: batch.id, label: batch.label, primary: savedAsset(batch.primary), secondary: savedAsset(batch.secondary), finalPrompt: batch.finalPrompt, createdAt: batch.createdAt, providerTaskIds: Object.fromEntries(Object.entries(batch.providerTasks || {}).map(([provider, task]) => [provider, task?.taskId]).filter(([, taskId]) => taskId)) };
}

function persistWorkspace() {
  const snapshot = {
    primaryAsset: savedAsset(state.primaryAsset),
    primaryImageInfo: state.primaryImageInfo,
    secondaryAsset: savedAsset(state.secondaryAsset),
    prompt: state.prompt,
    selectedInstructionIds: state.selectedInstructionIds,
    selectedResultIds: state.selectedResultIds,
    providers: state.providers,
    generatedBatches: state.generatedBatches.map(savedBatch),
  };
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
}

function clearWorkspace() {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-workbench-session': sessionToken, ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
}

async function restoreAsset(asset) {
  if (!asset?.assetId) return null;
  const source = `/api/assets/${asset.assetId}`;
  const response = await fetch(source, { headers: { 'x-workbench-session': sessionToken } });
  if (!response.ok) return null;
  const preview = URL.createObjectURL(await response.blob());
  imageCache.set(source, preview);
  return { ...asset, url: source, preview };
}

async function restoreWorkspace() {
  let snapshot;
  try { snapshot = JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || 'null'); } catch { clearWorkspace(); return; }
  if (!snapshot) return;
  state.primaryAsset = await restoreAsset(snapshot.primaryAsset);
  state.primaryImageInfo = snapshot.primaryImageInfo || null;
  state.secondaryAsset = await restoreAsset(snapshot.secondaryAsset);
  state.prompt = snapshot.prompt || '';
  state.selectedInstructionIds = (snapshot.selectedInstructionIds || []).filter((id) => state.instructions.some((instruction) => instruction.id === id));
  state.selectedResultIds = Array.isArray(snapshot.selectedResultIds) ? snapshot.selectedResultIds : [];
  state.providers = { image2: snapshot.providers?.image2 !== false, nano_banana: snapshot.providers?.nano_banana !== false };
  const savedBatches = snapshot.generatedBatches || (snapshot.generatedBatch ? [snapshot.generatedBatch] : []);
  state.generatedBatches = (await Promise.all(savedBatches.map(async (batch) => {
    const providerTasks = {};
    await Promise.all(Object.entries(batch.providerTaskIds || {}).map(async ([provider, taskId]) => { try { const data = await api(`/api/tasks/${taskId}`); if (data.task) providerTasks[provider] = data.task; } catch {} }));
    if (!Object.keys(providerTasks).length) return null;
    return { ...batch, id: batch.id || crypto.randomUUID(), primary: state.primaryAsset || await restoreAsset(batch.primary), secondary: state.secondaryAsset || await restoreAsset(batch.secondary), providerTasks };
  }))).filter(Boolean);
  state.generatedBatch = state.generatedBatches[0] || null;
}

function selectedInstructions() {
  return state.selectedInstructionIds.map((id) => state.instructions.find((item) => item.id === id)).filter(Boolean);
}

async function syncInstructionOrder() {
  await Promise.all(state.instructions.map((instruction, index) => api(`/api/templates/${instruction.id}`, { method: 'PATCH', body: JSON.stringify({ category: 'virtual-model', sortOrder: index }) })));
}

function formatPrompt() {
  const userPrompt = state.prompt.trim();
  const instructionPrompts = selectedInstructions().map((item) => item.content.trim()).filter(Boolean);
  const parts = userPrompt ? [userPrompt, ...instructionPrompts] : instructionPrompts.length ? instructionPrompts : [DEFAULT_FUSION_PROMPT];
  return parts
    .filter(Boolean)
    .filter((item, index, values) => index === 0 || values[index - 1] !== item)
    .join('\n\n');
}

function aspectRatioForImage(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const target = image.naturalWidth / image.naturalHeight;
      const candidates = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'];
      const aspectRatio = candidates.reduce((best, candidate) => {
        const [width, height] = candidate.split(':').map(Number);
        return Math.abs(Math.log((width / height) / target)) < Math.abs(Math.log((best.split(':').map(Number)[0] / best.split(':').map(Number)[1]) / target)) ? candidate : best;
      }, '1:1');
      resolve({ width: image.naturalWidth, height: image.naturalHeight, aspectRatio });
    };
    image.onerror = () => resolve({ aspectRatio: '1:1' });
    image.src = source;
  });
}

function taskImages(task) { return task?.images || task?.results || []; }
async function openOriginal(image) { const dialog = document.querySelector('#imageViewerDialog'); const taskRow = image.closest('.vm-task-row'); const references = [...(taskRow?.querySelectorAll('.vm-task-reference img') || [])]; document.querySelector('#imageViewerReferences').innerHTML = references.map((reference, index) => `<img src="${escapeHtml(reference.src)}" alt="参考图 ${index + 1}">`).join(''); const group = image.closest('.vm-provider-cell')?.querySelectorAll('[data-asset-url]'); viewerItems = [...(group || [image])]; viewerIndex = Math.max(0, viewerItems.indexOf(image)); dialog.showModal(); await showViewerItem(); }
async function showViewerItem() { const image = viewerItems[viewerIndex]; const viewer = document.querySelector('#imageViewer'); if (!image || !viewer) return; const source = image.dataset.assetUrl; let objectUrl = imageCache.get(source); if (!objectUrl) { try { const response = await fetch(source, { headers: { 'x-workbench-session': sessionToken } }); if (!response.ok) throw new Error('asset unavailable'); objectUrl = URL.createObjectURL(await response.blob()); imageCache.set(source, objectUrl); } catch { return; } } viewer.src = objectUrl; viewer.alt = image.alt || '生成结果'; document.querySelector('#imageViewerIndex').textContent = `${viewerIndex + 1} / ${viewerItems.length}`; const selectButton = document.querySelector('#toggleImageSelection'); const selected = state.selectedResultIds.includes(image.dataset.resultId); selectButton.textContent = selected ? '取消选中' : '选中'; selectButton.classList.toggle('is-selected', selected); document.querySelector('#prevImage').disabled = viewerIndex === 0; document.querySelector('#nextImage').disabled = viewerIndex === viewerItems.length - 1; }
function toggleViewerSelection() { const image = viewerItems[viewerIndex]; if (!image) return; const id = image.dataset.resultId; if (state.selectedResultIds.includes(id)) state.selectedResultIds = state.selectedResultIds.filter((item) => item !== id); else state.selectedResultIds = [...state.selectedResultIds, id]; persistWorkspace(); document.querySelectorAll(`[data-result-id="${CSS.escape(id)}"]`).forEach((item) => item.closest('.vm-result-card')?.classList.toggle('is-selected', state.selectedResultIds.includes(id))); showViewerItem(); }
function taskActive(task) { return ['queued', 'running', 'processing'].includes(task?.status); }
function providerStatus(task) { if (!task) return '等待提交'; if (task.status === 'completed') return '已完成'; if (task.status === 'partial') return '部分完成'; if (task.status === 'failed') return '生成失败'; return '生成中'; }
function providerResults(task) { const images = taskImages(task); const placeholders = Math.max(0, 4 - images.length); return [...images, ...Array.from({ length: placeholders }, (_, index) => ({ id: `waiting-${index}`, status: 'waiting' }))].map((result) => { if (result.assetId || result.url) { const selected = state.selectedResultIds.includes(result.id); return `<figure class="vm-result-card ${selected ? 'is-selected' : ''}"><img data-asset-url="${escapeHtml(result.url || `/api/assets/${result.assetId}`)}" data-result-id="${escapeHtml(result.id)}" alt="生成结果"><figcaption>候选 ${result.index + 1}${selected ? ' · 已选中' : ''}</figcaption></figure>`; } if (result.status === 'failed') return '<div class="vm-result-card vm-result-error">生成失败</div>'; return `<div class="vm-result-card vm-result-wait">${taskActive(task) ? '生成中' : '等待生成'}</div>`; }).join(''); }
function shortlistedResults(batch) { const results = Object.values(batch.providerTasks || {}).flatMap((task) => taskImages(task)); return results.filter((result) => (result.assetId || result.url) && state.selectedResultIds.includes(result.id)).map((result) => `<figure class="vm-shortlist-card"><img data-asset-url="${escapeHtml(result.url || `/api/assets/${result.assetId}`)}" data-result-id="${escapeHtml(result.id)}" alt="已选中结果"><figcaption>已选中</figcaption></figure>`).join(''); }
async function downloadSelected(batchId) { const batch = state.generatedBatches.find((item) => item.id === batchId); if (!batch) return; const results = Object.values(batch.providerTasks || {}).flatMap((task) => taskImages(task)).filter((result) => state.selectedResultIds.includes(result.id) && (result.assetId || result.url)); for (const [index, result] of results.entries()) { const source = result.url || `/api/assets/${result.assetId}`; let objectUrl = imageCache.get(source); if (!objectUrl) { const response = await fetch(source, { headers: { 'x-workbench-session': sessionToken } }); if (!response.ok) continue; objectUrl = URL.createObjectURL(await response.blob()); imageCache.set(source, objectUrl); } const link = document.createElement('a'); link.href = objectUrl; link.download = `virtual-model-${batch.label}-${index + 1}.png`; link.click(); } }
async function hydrateResultImages() { for (const image of document.querySelectorAll('[data-asset-url]')) { image.ondblclick = () => openOriginal(image); const source = image.dataset.assetUrl; if (imageCache.has(source)) { image.src = imageCache.get(source); continue; } try { const response = await fetch(source, { headers: { 'x-workbench-session': sessionToken } }); if (!response.ok) throw new Error('asset unavailable'); const objectUrl = URL.createObjectURL(await response.blob()); imageCache.set(source, objectUrl); image.src = objectUrl; } catch { image.closest('.vm-result-card')?.classList.add('vm-result-error'); } } }
async function pollProvider(batchId, provider) { const batch = state.generatedBatches.find((item) => item.id === batchId); const task = batch?.providerTasks?.[provider]; if (!task) return; try { const data = await api(`/api/tasks/${task.taskId}`); if (!batch) return; batch.providerTasks[provider] = data.task; const providers = Object.values(batch.providerTasks); if (providers.every((item) => ['completed', 'partial', 'failed'].includes(item.status))) state.alert = { type: providers.some((item) => item.status === 'failed') ? 'error' : 'notice', message: providers.every((item) => item.status === 'completed') ? '本轮 8 张生成已完成。' : '本轮生成已结束，部分 Provider 或候选失败。' }; persistWorkspace(); if (!document.querySelector('dialog[open]')) render(); if (taskActive(data.task)) setTimeout(() => pollProvider(batchId, provider), 1000); } catch (error) { showAlert(error.message); } }

function imageCard(role, asset, description) {
  const image = asset ? `<img src="${escapeHtml(asset.preview)}" alt="${role}">` : '<span class="vm-upload-icon">+</span><strong>上传图片</strong><small>jpg、jpeg、png、webp</small>';
  const action = asset ? '更换图片' : '上传图片';
  return `<section class="vm-image-card" data-role="${role === '图片 1' ? 'primary' : 'secondary'}">
    <div class="vm-image-title"><b>${role}</b><span>${description}</span><button type="button" class="vm-image-remove" data-clear-role="${role === '图片 1' ? 'primary' : 'secondary'}" aria-label="删除${role}">×</button></div>
    <div class="vm-image-preview ${asset ? 'has-image' : ''}">${image}</div>
    <input type="file" accept="image/jpeg,image/png,image/webp" hidden>
    <button type="button" class="vm-image-action">${action}</button>
  </section>`;
}

function instructionRows() {
  const selected = new Set(state.selectedInstructionIds);
  if (!state.instructions.length) return '<p class="vm-empty-copy">尚未添加指令</p>';
  return state.instructions.map((instruction) => `<div class="vm-instruction-row ${selected.has(instruction.id) ? 'selected' : ''}" data-instruction-id="${instruction.id}">
    <label><input type="checkbox" ${selected.has(instruction.id) ? 'checked' : ''}><span>${escapeHtml(instruction.name)}</span></label>
    <div class="vm-row-actions"><button type="button" data-action="move-up" title="上移">↑</button><button type="button" data-action="move-down" title="下移">↓</button><button type="button" data-action="edit" title="编辑">✎</button><button type="button" data-action="delete" title="删除">×</button></div>
  </div>`).join('');
}

function batchRows() {
  if (!state.generatedBatches.length) return `<div class="vm-results-empty"><span class="vm-empty-mark">✦</span><h2>等待生成任务</h2><p>上传两张参考图后，即可开始虚拟模特融合。</p></div>`;
  return state.generatedBatches.map((batch) => batchRow(batch)).join('');
}

function batchRow(batch) {
  const image2 = batch.providerTasks.image2; const google = batch.providerTasks.nano_banana;
  const shortlist = shortlistedResults(batch); const selectedCount = Object.values(batch.providerTasks || {}).flatMap((task) => taskImages(task)).filter((result) => state.selectedResultIds.includes(result.id)).length;
  return `<article class="vm-task-row"><div class="vm-task-info"><div><b>任务 ${batch.label}</b><span>${providerStatus(image2)} / ${providerStatus(google)}</span><p>${escapeHtml(batch.createdAt)}</p><button type="button" data-show-prompt="${batch.id}">查看最终指令</button></div><div class="vm-task-reference"><img src="${escapeHtml(batch.primary.preview)}" alt="主参考图"><img src="${escapeHtml(batch.secondary.preview)}" alt="补充参考图"></div></div><div class="vm-provider-cell"><b>image2 候选（4）</b><div class="vm-candidate-grid">${providerResults(image2)}</div></div><div class="vm-provider-cell"><b>Google 候选（4）</b><div class="vm-candidate-grid">${providerResults(google)}</div></div><div class="vm-shortlist-cell"><span>${selectedCount ? `已入围 ${selectedCount} 张` : '尚未选中'}</span><div class="vm-shortlist-grid">${shortlist || '<small>双击结果图后可选中</small>'}</div><button type="button" class="vm-download-selected" data-download-batch="${batch.id}" ${selectedCount ? '' : 'disabled'}>下载选中</button></div></article>`;
}

function render() {
  const selectedCount = state.selectedInstructionIds.length;
  const promptLength = state.prompt.length;
  root.innerHTML = `<header class="topbar"><div class="brand"><span class="brand-mark">✦</span><div><strong>影像实验室</strong><small>VIRTUAL MODEL WORKBENCH</small></div></div><div class="top-status"><span class="online-dot"></span> 服务在线 <button class="ghost" type="button">设置</button><span class="avatar">A</span></div></header>
    <div class="shell"><aside class="sidebar"><div class="side-title">生图工作台</div><a class="nav" href="/">⌘ <span>基础生图</span></a><a class="nav active" href="/virtual-model.html" aria-current="page">♢ <span>虚拟模特合成</span></a><button class="nav" type="button">◌ <span>动作裂变</span></button><button class="nav" type="button">▦ <span>生成历史</span></button></aside>
    <main class="vm-main"><aside class="vm-controls"><div class="vm-control-heading"><div><p class="eyebrow">VIRTUAL MODEL</p><h1>虚拟模特合成</h1></div></div>
      <div class="vm-images">${imageCard('图片 1', state.primaryAsset, '身材参考（主体）')}${imageCard('图片 2', state.secondaryAsset, '脸部/发型参考（补充）')}</div>
      <label class="vm-field-label" for="prompt">提示词 <span>可选</span></label><textarea id="prompt" maxlength="1000" placeholder="例如：清晨柔光，室内自然站，简约背景，自然肤色，高级质感…">${escapeHtml(state.prompt)}</textarea><div class="vm-count"><span>默认融合策略：主图身材与构图，补充图脸部与发型</span><span>${promptLength} / 1000</span></div>
      <div class="vm-instruction-head"><label class="vm-field-label">指令模板 <span>按选择顺序拼接</span></label><button type="button" id="openInstructionDialog">+ 添加指令</button></div><div class="vm-instruction-list">${instructionRows()}</div>
      <section class="vm-settings"><h2>生成设置</h2><div class="vm-settings-grid"><div><span>每个模型生成</span><b>4 张</b></div><div><span>画面比例</span><b>参考图片 1</b></div><div><span>分辨率</span><b>参考图片 1</b></div></div><div class="vm-provider-checks"><label><input type="checkbox" data-provider="image2" ${state.providers.image2 ? 'checked' : ''}> image2</label><label><input type="checkbox" data-provider="nano_banana" ${state.providers.nano_banana ? 'checked' : ''}> Google</label></div></section>
      <button type="button" class="vm-generate" id="generate"><span>▷</span> 开始生成</button><p class="vm-generate-note">预计生成 ${[state.providers.image2, state.providers.nano_banana].filter(Boolean).length * 4} 张：${state.providers.image2 ? 'image2 4 张' : ''}${state.providers.image2 && state.providers.nano_banana ? '，' : ''}${state.providers.nano_banana ? 'Google 4 张' : ''}</p>${state.alert ? `<p class="vm-alert ${state.alert.type}">${escapeHtml(state.alert.message)}</p>` : ''}</aside>
      <section class="vm-results"><header class="vm-results-header"><div><p class="eyebrow">GENERATION HISTORY</p><h2>生成任务</h2></div><div class="vm-toolbar"><button type="button" class="active">全部任务</button><button type="button">进行中</button><button type="button">已完成</button><button type="button">已收藏</button></div></header><div class="vm-table-head"><span>任务信息 / 图 1 / 图 2</span><span>image2 候选（4）</span><span>Google 候选（4）</span><span>已抽中 / 入图</span></div><div class="vm-task-list">${batchRows()}</div></section></main></div>
    <dialog class="vm-dialog" id="instructionDialog"><form method="dialog"><header><h2>${editingInstructionId ? '编辑指令' : '添加指令'}</h2><button type="button" id="closeInstructionDialog">×</button></header><label>名称<input id="instructionName" maxlength="40" placeholder="例如：自然光肤色"></label><label>指令内容<textarea id="instructionContent" maxlength="1000" placeholder="请输入需要按顺序拼入最终提示词的内容"></textarea></label><footer><button type="button" class="vm-dialog-cancel" id="cancelInstruction">取消</button><button type="submit" class="vm-dialog-submit">保存</button></footer></form></dialog>
    <dialog class="vm-dialog vm-prompt-dialog" id="promptDialog"><form method="dialog"><header><h2>本轮最终指令</h2><button type="button" id="closePromptDialog">×</button></header><pre>${escapeHtml(state.promptPreview)}</pre><footer><button type="submit" class="vm-dialog-submit">关闭</button></footer></form></dialog>
    <dialog class="vm-image-viewer" id="imageViewerDialog"><button type="button" class="vm-viewer-close" id="closeImageViewer" aria-label="关闭">×</button><div class="vm-viewer-references" id="imageViewerReferences"></div><button type="button" class="vm-viewer-nav vm-viewer-prev" id="prevImage" aria-label="上一张">‹</button><figure><img id="imageViewer" alt="生成结果"><figcaption id="imageViewerIndex"></figcaption></figure><button type="button" class="vm-viewer-nav vm-viewer-next" id="nextImage" aria-label="下一张">›</button><button type="button" class="vm-viewer-select" id="toggleImageSelection">选中</button></dialog>`;
  const settingValues = document.querySelectorAll('.vm-settings-grid b');
  settingValues[1].textContent = '参考图片 1';
  settingValues[2].textContent = '固定 2K';
  bind(); hydrateResultImages();
}

function showAlert(message, type = 'error') {
  state.alert = { message, type };
  render();
}

async function upload(role, file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return showAlert('仅支持 jpg、jpeg、png、webp 图片。');
  const preview = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  try {
    const result = await api('/api/assets', { method: 'POST', body: JSON.stringify({ name: file.name, mimeType: file.type, data: preview }) });
    state[role === 'primary' ? 'primaryAsset' : 'secondaryAsset'] = { ...result.asset, preview };
    if (role === 'primary') state.primaryImageInfo = await aspectRatioForImage(preview);
    state.alert = null;
    persistWorkspace();
    render();
  } catch (error) {
    showAlert(error.message);
  }
}

function moveInstruction(id, direction) {
  const index = state.selectedInstructionIds.indexOf(id);
  if (index < 0) return;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= state.selectedInstructionIds.length) return;
  [state.selectedInstructionIds[index], state.selectedInstructionIds[nextIndex]] = [state.selectedInstructionIds[nextIndex], state.selectedInstructionIds[index]];
  persistWorkspace();
  render();
  syncInstructionOrder().catch(() => {});
}

function openInstructionDialog(instruction) {
  editingInstructionId = instruction?.id || null;
  const dialog = document.querySelector('#instructionDialog');
  dialog.querySelector('#instructionName').value = instruction?.name || '';
  dialog.querySelector('#instructionContent').value = instruction?.content || '';
  dialog.showModal();
}

function bind() {
  document.querySelectorAll('.vm-image-card').forEach((card) => {
    const input = card.querySelector('input');
    card.querySelector('.vm-image-action').onclick = () => input.click();
    input.onchange = () => upload(card.dataset.role, input.files[0]);
    card.onclick = (event) => { if (!event.target.closest('button, input')) input.click(); };
    card.ondragover = (event) => { event.preventDefault(); card.classList.add('drag-over'); };
    card.ondragleave = () => card.classList.remove('drag-over');
    card.ondrop = (event) => { event.preventDefault(); card.classList.remove('drag-over'); upload(card.dataset.role, event.dataTransfer.files[0]); };
  });
  document.querySelectorAll('[data-clear-role]').forEach((button) => { button.onclick = (event) => { event.stopPropagation(); const role = button.dataset.clearRole; state[role === 'primary' ? 'primaryAsset' : 'secondaryAsset'] = null; if (role === 'primary') state.primaryImageInfo = null; persistWorkspace(); render(); }; });
  document.querySelector('#prompt').oninput = (event) => { state.prompt = event.target.value; persistWorkspace(); document.querySelector('.vm-count span:last-child').textContent = `${state.prompt.length} / 1000`; };
  document.querySelectorAll('[data-provider]').forEach((checkbox) => { checkbox.onchange = (event) => { const provider = event.target.dataset.provider; const otherEnabled = Object.entries(state.providers).some(([name, enabled]) => name !== provider && enabled); if (!event.target.checked && !otherEnabled) { event.target.checked = true; return showAlert('至少选择一个生图 Provider。', 'error'); } state.providers[provider] = event.target.checked; persistWorkspace(); render(); }; });
  document.querySelector('#openInstructionDialog').onclick = () => openInstructionDialog();
  document.querySelectorAll('.vm-instruction-row').forEach((row) => {
    const id = row.dataset.instructionId;
    row.querySelector('input').onchange = (event) => { state.selectedInstructionIds = event.target.checked ? [...state.selectedInstructionIds, id] : state.selectedInstructionIds.filter((item) => item !== id); persistWorkspace(); render(); };
    row.querySelectorAll('[data-action]').forEach((button) => { button.onclick = async () => { const instruction = state.instructions.find((item) => item.id === id); if (button.dataset.action === 'move-up') moveInstruction(id, -1); if (button.dataset.action === 'move-down') moveInstruction(id, 1); if (button.dataset.action === 'edit') openInstructionDialog(instruction); if (button.dataset.action === 'delete') { try { await api(`/api/templates/${id}`, { method: 'PATCH', body: JSON.stringify({ category: 'virtual-model-deleted' }) }); state.instructions = state.instructions.filter((item) => item.id !== id); state.selectedInstructionIds = state.selectedInstructionIds.filter((item) => item !== id); saveInstructions(); persistWorkspace(); render(); } catch (error) { showAlert(error.message); } } }; });
  });
  const instructionDialog = document.querySelector('#instructionDialog');
  instructionDialog.querySelector('#closeInstructionDialog').onclick = () => instructionDialog.close();
  instructionDialog.querySelector('#cancelInstruction').onclick = () => instructionDialog.close();
  instructionDialog.querySelector('form').onsubmit = async (event) => { event.preventDefault(); const name = instructionDialog.querySelector('#instructionName').value.trim(); const content = instructionDialog.querySelector('#instructionContent').value.trim(); if (!name || !content) return; try { const payload = { category: 'virtual-model', name, prompt: content }; const data = editingInstructionId ? await api(`/api/templates/${editingInstructionId}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api('/api/templates', { method: 'POST', body: JSON.stringify(payload) }); const instruction = templateToInstruction(data.template); if (editingInstructionId) Object.assign(state.instructions.find((item) => item.id === editingInstructionId), instruction); else state.instructions.unshift(instruction); await syncInstructionOrder(); saveInstructions(); instructionDialog.close(); render(); } catch (error) { showAlert(error.message); } };
  document.querySelector('#generate').onclick = async () => {
    if (!state.primaryAsset) return showAlert('请先上传图片 1：身材参考（主体）。');
    if (!state.secondaryAsset) return showAlert('请先上传图片 2：脸部/发型参考（补充）。');
    const button = document.querySelector('#generate'); button.disabled = true;
    try { const request = { prompt: formatPrompt(), outputCount: 4, referenceAssetIds: [state.primaryAsset.assetId, state.secondaryAsset.assetId], settings: { mode: 'image_to_image', aspectRatio: state.primaryImageInfo?.aspectRatio || '1:1', resolutionTier: '2K', quality: 'auto', background: 'auto' } }; const enabledProviders = Object.entries(state.providers).filter(([, enabled]) => enabled).map(([provider]) => provider); const results = await Promise.all(enabledProviders.map(async (provider) => [provider, await api('/api/generate', { method: 'POST', body: JSON.stringify({ ...request, provider }) })])); const providerTasks = Object.fromEntries(results.map(([provider, data]) => [provider, data.task])); const batch = { id: crypto.randomUUID(), label: String(Date.now()).slice(-4), primary: state.primaryAsset, secondary: state.secondaryAsset, finalPrompt: request.prompt, createdAt: new Date().toLocaleString('zh-CN'), providerTasks }; state.generatedBatches.unshift(batch); state.generatedBatch = batch; state.alert = { type: 'notice', message: `已提交真实生成：${enabledProviders.map((provider) => provider === 'nano_banana' ? 'Google' : provider).join('、')}，每路 4 张。` }; persistWorkspace(); render(); enabledProviders.forEach((provider) => pollProvider(batch.id, provider)); } catch (error) { showAlert(error.message); } finally { button.disabled = false; }
  };
  document.querySelectorAll('[data-show-prompt]').forEach((button) => { button.onclick = () => { state.promptPreview = state.generatedBatches.find((batch) => batch.id === button.dataset.showPrompt)?.finalPrompt || ''; const dialog = document.querySelector('#promptDialog'); dialog.querySelector('pre').textContent = state.promptPreview; dialog.showModal(); }; });
  document.querySelector('#closePromptDialog').onclick = () => document.querySelector('#promptDialog').close();
  document.querySelector('#closeImageViewer').onclick = () => { document.querySelector('#imageViewerDialog').close(); render(); };
  document.querySelector('#prevImage').onclick = () => { if (!viewerItems.length || viewerIndex === 0) return; viewerIndex -= 1; showViewerItem(); };
  document.querySelector('#nextImage').onclick = () => { if (!viewerItems.length || viewerIndex === viewerItems.length - 1) return; viewerIndex += 1; showViewerItem(); };
  document.querySelector('#toggleImageSelection').onclick = toggleViewerSelection;
  document.querySelectorAll('[data-download-batch]').forEach((button) => { button.onclick = () => downloadSelected(button.dataset.downloadBatch).catch((error) => showAlert(error.message)); });
  document.querySelector('#imageViewerDialog').onkeydown = (event) => { if (event.key === 'ArrowLeft') document.querySelector('#prevImage').click(); if (event.key === 'ArrowRight') document.querySelector('#nextImage').click(); };
}

async function boot() {
  try {
    const health = await fetch('/api/health').then((response) => response.json());
    sessionToken = health.sessionToken;
    await syncInstructions({ migrateLocal: true });
    await restoreWorkspace();
    render();
    const refreshInstructions = () => syncInstructions().then(() => { persistWorkspace(); if (!document.querySelector('dialog[open]')) render(); }).catch(() => {});
    window.addEventListener('focus', refreshInstructions);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshInstructions(); });
    for (const batch of state.generatedBatches) for (const provider of Object.keys(batch.providerTasks)) if (taskActive(batch.providerTasks[provider])) pollProvider(batch.id, provider);
  } catch (error) {
    root.innerHTML = `<main class="offline"><h1>无法连接工作台</h1><p>${escapeHtml(error.message)}</p></main>`;
  }
}

boot();
