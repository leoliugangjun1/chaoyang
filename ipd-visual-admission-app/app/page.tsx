"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";

// Prototype question: can a designer judge an IPD admission result from a Markdown file in one screen?
type AdmissionResult = "通过" | "有条件通过" | "不通过";
type Severity = "blocker" | "warning";
type Priority = "high" | "medium" | "low";
type NoteType = "info" | "warning" | "danger";
type ReturnReason = { issue_id: string; title: string; reason: string; severity: Severity; source_ref?: string; required_action?: string };
type Advice = { advice_id: string; title: string; content: string; priority?: Priority; related_issue_id?: string };
type Note = { note_id: string; type: NoteType; content: string };
type Source = { source_id: string; source_name: string; source_type?: string; weight?: number; status?: string };
type DashboardData = { schema_version?: string; product_id?: string; reviewed_at?: string; report_title?: string; admission_result?: string; decision_summary?: string; return_reasons: ReturnReason[]; completeness_score?: number; visual_advice: Advice[]; notes: Note[]; source_summary: Source[]; unknown_fields: Record<string, unknown> };

const example = `---
schema_version: ipd-admission-v1
product_id: CYA001
reviewed_at: 2026-08-19
---

# CYA001 | report_title
抓绒内衬保暖被视觉准入审核报告

## CYA002 | admission_result
有条件通过

## CYA003 | decision_summary
核心产品信息基本完整，可进入视觉制作；但具体保暖温度缺少可追溯证据，视觉表达需避免量化承诺。

## CYA004 | return_reasons
- issue_id: IPD-003
  title: 保暖温度缺少证据
  reason: 当前资料出现具体温度承诺，但未提供可追溯测试依据，不建议直接用于视觉宣传。
  severity: blocker
  source_ref: 产品营销资料对接区 / 卖点 04
  required_action: 补充测试报告，或删除具体温度数字。

## CYA005 | completeness_score
92

## CYA006 | visual_advice
- advice_id: VA-001
  title: 保暖属性
  content: 通过绒里特写、冬季穿搭和材质细节证明保暖感，避免直接使用未经验证的温度数字。
  priority: high
  related_issue_id: IPD-003
- advice_id: VA-002
  title: 塑形表达
  content: 可展示高腰结构和自然穿着轮廓，不使用医疗化或保证效果式表达。
  priority: medium

## CYA007 | notes
- note_id: NOTE-001
  type: warning
  content: 所有对外视觉卖点必须能回溯至已确认产品事实。

## SYS003 | source_summary
- source_id: SRC-001
  source_name: 产品营销资料对接区
  source_type: primary
  weight: 80
  status: used
- source_id: SRC-002
  source_name: 产品说明书
  source_type: secondary
  weight: 15
  status: used`;

const fieldMap: Record<string, keyof DashboardData> = { CYA001: "report_title", CYA002: "admission_result", CYA003: "decision_summary", CYA004: "return_reasons", CYA005: "completeness_score", CYA006: "visual_advice", CYA007: "notes", SYS003: "source_summary" };
const arrays = new Set(["return_reasons", "visual_advice", "notes", "source_summary"]);

function scalar(value: string) { return value.trim().replace(/^['"]|['"]$/g, ""); }
function yamlList(value: string) {
  const items: Record<string, string>[] = []; let current: Record<string, string> | null = null;
  for (const raw of value.split("\n")) { const line = raw.trim(); if (!line) continue; const first = line.match(/^-\s+([\w_]+):\s*(.*)$/); const pair = line.match(/^([\w_]+):\s*(.*)$/); if (first) { current = { [first[1]]: scalar(first[2]) }; items.push(current); } else if (pair && current) current[pair[1]] = scalar(pair[2]); }
  return items;
}
function numberedList(key: string, value: string) {
  const entries = value.split(/^\s*\d+\.\s+/m).map((entry) => entry.trim()).filter(Boolean);
  if (key === "return_reasons") return entries.map((entry, index) => { const lines = entry.split("\n").map((line) => line.trim()).filter(Boolean); const head = lines.shift() || ""; const match = head.match(/^\*\*(.+?)(?:\||｜)(.+?)\*\*[（(](blocker|warning)[）)]/); const action = lines.find((line) => line.startsWith("处理：")); return { issue_id: match?.[1]?.trim() || `ISSUE-${index + 1}`, title: match?.[2]?.trim() || head.replace(/\*\*/g, ""), severity: match?.[3] || "warning", reason: lines.filter((line) => !line.startsWith("处理：")).join(" "), required_action: action?.replace(/^处理：/, "") }; });
  if (key === "visual_advice") return entries.map((content, index) => ({ advice_id: `VA-${String(index + 1).padStart(3, "0")}`, title: `视觉建议 ${index + 1}`, content, priority: "medium" }));
  if (key === "notes") return entries.map((content, index) => ({ note_id: `NOTE-${String(index + 1).padStart(3, "0")}`, type: "warning", content }));
  if (key === "source_summary") return entries.map((content, index) => { const match = content.match(/^(.*?)（(.*?)，(\d+)%[，,](.*?)）$/); return { source_id: `SRC-${String(index + 1).padStart(3, "0")}`, source_name: match?.[1]?.trim() || content, source_type: match?.[2]?.trim(), weight: match?.[3] ? Number(match[3]) : undefined, status: match?.[4]?.trim() }; });
  return [];
}
function parseMarkdown(raw: string): DashboardData {
  const data: DashboardData = { return_reasons: [], visual_advice: [], notes: [], source_summary: [], unknown_fields: {} };
  const front = raw.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (front) for (const line of front[1].split("\n")) { const match = line.match(/^([\w_]+):\s*(.*)$/); if (!match) continue; const key = match[1] as keyof DashboardData; if (["schema_version", "product_id", "reviewed_at"].includes(key)) (data as Record<string, unknown>)[key] = scalar(match[2]); else data.unknown_fields[key] = scalar(match[2]); }
  const body = raw.slice(front ? front[0].length : 0);
  const headings = [...body.matchAll(/^#{1,6}\s+([A-Z]+\d+)\s*(?:\||｜)\s*[^\n]+$/gm)];
  for (let index = 0; index < headings.length; index += 1) { const match = headings[index]; const id = match[1]; const key = fieldMap[id]; const start = (match.index ?? 0) + match[0].length; const end = index + 1 < headings.length ? (headings[index + 1].index ?? body.length) : body.length; const content = body.slice(start, end).trim(); if (!key) { data.unknown_fields[id] = content; continue; } if (arrays.has(key)) (data as Record<string, unknown>)[key] = content.startsWith("-") ? yamlList(content) : numberedList(key, content); else if (key === "completeness_score") { const score = Number(content.match(/-?\d+(?:\.\d+)?/)?.[0]); if (Number.isFinite(score)) data.completeness_score = score; } else (data as Record<string, unknown>)[key] = scalar(content); }
  return data;
}
function parseJson(raw: string): DashboardData {
  let source: unknown;
  try { source = JSON.parse(raw); } catch { throw new Error("JSON 格式无效，请检查逗号、引号和括号。"); }
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("JSON 根节点必须是对象。");
  const record = source as Record<string, unknown>;
  const data: DashboardData = {
    schema_version: typeof record.schema_version === "string" ? record.schema_version : undefined,
    product_id: typeof record.product_id === "string" ? record.product_id : undefined,
    reviewed_at: typeof record.reviewed_at === "string" ? record.reviewed_at : undefined,
    report_title: typeof record.report_title === "string" ? record.report_title : undefined,
    admission_result: typeof record.admission_result === "string" ? record.admission_result : undefined,
    decision_summary: typeof record.decision_summary === "string" ? record.decision_summary : undefined,
    return_reasons: Array.isArray(record.return_reasons) ? record.return_reasons as ReturnReason[] : [],
    completeness_score: typeof record.completeness_score === "number" ? record.completeness_score : undefined,
    visual_advice: Array.isArray(record.visual_advice) ? record.visual_advice as Advice[] : [],
    notes: Array.isArray(record.notes) ? record.notes as Note[] : [],
    source_summary: Array.isArray(record.source_summary) ? record.source_summary as Source[] : [],
    unknown_fields: {},
  };
  const known = new Set(["schema_version", "product_id", "reviewed_at", "report_title", "admission_result", "decision_summary", "return_reasons", "completeness_score", "visual_advice", "notes", "source_summary"]);
  for (const [key, value] of Object.entries(record)) if (!known.has(key)) data.unknown_fields[key] = value;
  return data;
}
function validate(data: DashboardData) {
  const errors: string[] = []; const warnings: string[] = [];
  if (data.schema_version !== "ipd-admission-v1") errors.push("协议不兼容：仅支持 ipd-admission-v1。");
  for (const [id, key] of [["CYA001", "report_title"], ["CYA002", "admission_result"], ["CYA003", "decision_summary"], ["SYS003", "source_summary"]] as const) if (!data[key] || (Array.isArray(data[key]) && !data[key].length)) { console.warn(`Missing field ${id}`); warnings.push(`${id} 数据缺失`); }
  if (data.admission_result && !["通过", "有条件通过", "不通过"].includes(data.admission_result)) errors.push("准入状态异常：CYA002 不是支持的枚举值。");
  if (data.admission_result !== "通过" && data.admission_result && !data.return_reasons.length) errors.push("数据异常：当前结论需要问题明细，但 CYA004 为空。");
  if (data.completeness_score === undefined) { console.warn("Missing field CYA005"); warnings.push("CYA005 数据缺失"); }
  else if (data.completeness_score < 0 || data.completeness_score > 100) errors.push("完整度评分异常：CYA005 必须在 0 到 100 之间。");
  return { errors, warnings };
}

function Badge({ result }: { result?: string }) { const meta = result === "通过" ? ["success", "✓"] : result === "有条件通过" ? ["warning", "!"] : result === "不通过" ? ["danger", "×"] : ["muted", "?"]; return <span className={`admission-badge ${meta[0]}`}><b>{meta[1]}</b>{result || "数据缺失"}</span>; }
function Score({ score }: { score?: number }) { const label = score === undefined ? "未提供完整度评分" : score >= 90 ? "资料完整" : score >= 70 ? "基本完整" : score >= 50 ? "明显缺失" : "不具备制作条件"; return <article className="score-card"><p className="eyebrow">资料完整度</p><div className="score"><strong>{score ?? "--"}</strong><span>/100</span></div><p className="score-label">{label}</p><div className="progress"><i style={{ width: `${score ?? 0}%` }} /></div></article>; }

export default function HomePage() {
  const [data, setData] = useState<DashboardData | null>(null); const [errors, setErrors] = useState<string[]>([]); const [warnings, setWarnings] = useState<string[]>([]); const [dragging, setDragging] = useState(false); const [expanded, setExpanded] = useState(false); const input = useRef<HTMLInputElement>(null);
  const load = (raw: string, format: "markdown" | "json" = "markdown") => { try { const parsed = format === "json" ? parseJson(raw) : parseMarkdown(raw); const outcome = validate(parsed); setData(parsed); setErrors(outcome.errors); setWarnings(outcome.warnings); } catch (reason) { setData(null); setWarnings([]); setErrors([reason instanceof Error ? reason.message : "无法解析输入文件。"]); } };
  const accept = async (file?: File) => { if (!file) return; const name = file.name.toLowerCase(); if (!name.endsWith(".md") && !name.endsWith(".json")) { setErrors(["请选择 .md 或 .json 格式的结论文件。"]); return; } load(await file.text(), name.endsWith(".json") ? "json" : "markdown"); };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void accept(event.dataTransfer.files[0]); };
  if (!data) return <main className="upload-page"><header className="minimal-brand"><span>IPD</span><p>视觉准入看板</p></header><section className="upload-intro"><p className="eyebrow">IPD VISUAL ADMISSION</p><h1>导入 IPD 视觉准入结论</h1><p>上传符合 <code>ipd-admission-v1</code> 协议的 Markdown 或 JSON 文件，生成结构化审核看板。</p></section><section className={`dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}><div className="upload-icon">↑</div><h2>拖入 Markdown 或 JSON 文件</h2><p>或从本地选择一份审核结论</p><button onClick={() => input.current?.click()}>选择 .md / .json 文件</button><input ref={input} type="file" accept=".md,.json,text/markdown,application/json" onChange={(e: ChangeEvent<HTMLInputElement>) => void accept(e.target.files?.[0])} /><button className="example-link" onClick={() => load(example)}>加载示例结论</button></section>{errors.length > 0 && <p className="upload-error">{errors[0]}</p>}</main>;
  if (errors.some((error) => error.startsWith("协议不兼容"))) return <main className="error-page"><p className="eyebrow">INPUT CONTRACT ERROR</p><h1>协议不兼容</h1><p>{errors[0]}</p><button onClick={() => { setData(null); setErrors([]); }}>重新导入</button></main>;
  const issuesNeeded = data.admission_result !== "通过";
  const advice = expanded ? data.visual_advice : data.visual_advice.slice(0, 3);
  return <main className="page"><header className="topbar"><div className="minimal-brand"><span>IPD</span><p>视觉准入看板</p></div><button className="replace" onClick={() => { setData(null); setErrors([]); setWarnings([]); }}>更换文件</button></header><div className="container"><section className="hero"><p className="eyebrow">IPD VISUAL ADMISSION · PRODUCT FACT REVIEW</p><h1>{data.report_title || "数据缺失"}</h1><div className="meta"><span>产品 ID · {data.product_id || "--"}</span><span>审核时间 · {data.reviewed_at || "--"}</span></div><Badge result={data.admission_result} /><p className="hero-summary">{data.decision_summary || "数据缺失"}</p></section>{warnings.length > 0 && <aside className="data-warning">{warnings.join(" · ")}</aside>}<section className="section"><div className="section-head"><p className="eyebrow">结论摘要</p><h2>可用于后续制作的判断依据</h2></div><div className="summary-grid"><article className="summary-card"><p className="eyebrow">结论概述</p><p>{data.decision_summary || "数据缺失"}</p></article><Score score={data.completeness_score} /><article className="advice-card"><p className="eyebrow">视觉建议</p>{advice.length ? <div className="advice-list">{advice.map((item) => <div className="advice" key={item.advice_id}><span className={`priority ${item.priority || "low"}`}>{item.priority || "low"}</span><div><h3>{item.title}</h3><p>{item.content}</p></div></div>)}</div> : null}{data.visual_advice.length > 3 && <button className="show-more" onClick={() => setExpanded(!expanded)}>{expanded ? "收起建议" : `查看全部 ${data.visual_advice.length} 条建议`}</button>}</article></div></section>{issuesNeeded && <section className="section issues-section"><div className="section-head"><p className="eyebrow">问题 / 退回项</p><h2>下一步需要处理的内容</h2></div>{data.return_reasons.length ? <div className="issue-list">{data.return_reasons.map((item) => <article className={`issue ${item.severity}`} key={item.issue_id}><div className="issue-top"><code>{item.issue_id}</code><span>{item.severity === "blocker" ? "阻断项" : "需关注"}</span></div><h3>{item.title}</h3><p>{item.reason}</p>{item.required_action && <div className="action"><small>建议动作</small><p>{item.required_action}</p></div>}{item.source_ref && <details><summary>查看来源</summary><p>{item.source_ref}</p></details>}</article>)}</div> : <aside className="data-warning">数据异常：当前结论需要问题明细，但 CYA004 为空。</aside>}</section>}{data.notes.length > 0 && <section className="section"><div className="section-head"><p className="eyebrow">注意事项</p><h2>制作边界与提示</h2></div><div className="notice-list">{data.notes.map((note) => <aside className={`notice ${note.type}`} key={note.note_id}><b>{note.type === "danger" ? "重要提示" : note.type === "warning" ? "注意" : "说明"}</b><span>{note.content}</span></aside>)}</div></section>}<section className="section sources"><div className="section-head"><p className="eyebrow">数据来源 / 证据追溯</p><h2>审核依据</h2></div>{data.source_summary.length ? <div className="source-list">{data.source_summary.map((source) => <article key={source.source_id}><div><h3>{source.source_name}</h3><p>{source.source_type || "未标注类型"} · {source.status || "未标注状态"}</p></div>{source.weight !== undefined && <strong>{source.weight}<small>% 权重</small></strong>}</article>)}</div> : <aside className="data-warning">SYS003 数据缺失</aside>}</section></div></main>;
}
