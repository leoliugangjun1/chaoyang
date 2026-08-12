# IPD 产品视觉准入审核智能体 ARCHITECTURE

## 1. 文档定位

本文档面向 Vibe Coding Agent、开发人员和测试人员，定义 IPD 产品视觉准入审核智能体的系统边界、处理阶段、数据模型、LLM/Skill 契约、任务可靠性和接口约定。

业务规则唯一来源为 `ipd-visual-admission-review V1.0` 中的 `SKILL.md`、`references/audit-rules.md`、`references/processing-contract.md`、`references/llm-task-templates.md`、`references/report-schema.json` 和 `references/evaluation-cases.md`。

系统判断资料是否具备进入视觉制作的条件，不承担产品真实性、法律合规或质量认证的最终责任。

## 2. 系统边界

系统负责接收固定模板 Excel 或上游 `excel_parser` 结果，保存原始文件、解析快照、规则版本和任务记录，按规则分块调用 LLM，校验结构化 JSON，计算完整度和准入状态，生成符合 `report-schema.json` 的 JSON 及 Markdown 报告，并展示报告、证据定位、责任角色和必需动作。

系统不负责支持未配置的任意 Excel 模板，不把完整工作簿、图片二进制或历史对话直接发送给 LLM，不创造产品事实、检测结果、来源定位或证据编号，不用视觉建议、竞品资料、VOC 或行业常识替代本产品证据，也不修改原始 Excel、已发布 Skill 或历史报告。

## 3. 总体架构

```text
Web 前端
  -> 项目与文件服务
  -> 异步任务服务
  -> Excel Parser 适配器
  -> Agent 编排服务
      -> A 资料定位
      -> B 一票退回检查
      -> C 完整度检查
      -> D 卖点与证据检查
      -> E 展示方案检查
      -> F 场景与 Slogan 检查
      -> G 报告汇总
  -> Skill 注册与版本服务
  -> 报告与导出服务
  -> 本地项目版本存储
```

固定处理链：

```text
Excel 上传 -> excel_parser 预处理 -> document_index / content_chunks
-> A 资料定位 -> B 一票退回 -> C 完整度
-> D USP/VOC、功能验证、证据范围、流量词
-> E 展示方案 -> F 场景与 Slogan -> G AdmissionReport
-> JSON / Markdown 展示与导出
```

## 4. 技术栈要求

- 本机运行，前端使用 React + TypeScript。
- 后端使用 Python 或 Node.js，提供 HTTP API。
- 本地持久化使用 SQLite 或等价嵌入式数据库。
- Excel 预处理必须通过 `excel_parser` 适配器完成。
- LLM 使用兼容 OpenAI Chat Completions 的接口。
- 阶段协议使用 JSON Schema，不使用 Markdown 作为机器间协议。
- 大文件审核使用后台任务，不在上传请求内同步执行全部 LLM 调用。

## 5. 处理阶段与边界

### 5.1 A 资料定位

输入为 `catalog_or_chunk`。只识别资料属于 `marketing_package`、`manual` 或 `other`，映射可识别字段并记录来源定位，输出 `DocumentIndex`。不得判断卖点真实性或功能成立性。无法识别时保留 `other`，置信度为 `low`，允许继续并在报告中记录。

### 5.2 B 一票退回检查

必须分别调用 `model_version`、`core_claim_evidence`、`cross_document_conflict` 各一次。输入只包含当前规则所需字段、USP、卖点顺序、本产品证据、VOC/竞品片段和跨资料字段片段。确认命中时 `hard_fail=true`；信息不足时 `manual_review=true`。任一规则确认命中后最终状态必须为 `rejected`，但仍继续 C-F 阶段。

### 5.3 C 完整度检查

只检查字段是否存在、非空、可读且与所属条目关联，不评价质量、真实性或卖点成立性。产品营销资料对接包满分 `80`，产品说明书满分 `15`，其他资料 `5` 分但本版不纳入审核。

```text
raw_score = marketing_score + manual_score
audited_completeness_percent = round(raw_score / 95 * 100, 1)
unreviewed_weight = 5
```

### 5.4 D 卖点与证据检查

针对每个 `claim_id` 与 `usp_voc`、`functional_validation`、`evidence_scope`、`usp_keyword` 分别调用。输出 `ClaimCheck`，包含事实、推断、证据等级、来源、风险、必需动作、责任角色和置信度。

证据等级固定为：A（本产品检测、质检或专业报告）、B（本产品说明书、规格表、实测或可定位实拍）、C（未验证的本产品营销描述）、D（VOC、竞品或行业常识）、`none`。A/B 可支持产品功能结论，C 只能作为主张线索，D 只能支持市场相关性。

### 5.5 E 展示方案检查

输入为单条基础卖点、已确认事实和证据。输出必须包含真实展示对象、镜头或版式、辅助图示或测量、支持结论和限制条件。不得创造证据、伪造前后对比或把无法验证的效果写成确定结论。

### 5.6 F 场景与 Slogan 检查

`scene_dilution` 只判断场景是否稀释 USP；`slogan_perceptibility` 只判断核心承诺能否由真实产品图、使用图、结构图、测量图或检测可视化直接感知。视觉建议不得写成产品事实。

### 5.7 G 报告汇总

只允许使用阶段 JSON 摘要、来源索引和已确认的 `hard_fail_checks`，不得重新读取原始资料。输出必须符合 `report-schema.json`；不得覆盖已确认的 `hard_fail=true`，不得增加阶段结果中不存在的来源、编号或结论。

## 6. 数据模型

### 6.1 DocumentIndex 与 ContentChunk

```json
{
  "documents": [{
    "doc_type": "marketing_package|manual|other",
    "module": "",
    "source_refs": [],
    "field_map": {},
    "missing_fields": [],
    "confidence": "high|medium|low"
  }]
}
```

```json
{
  "source_id": "marketing-claim-001",
  "chunk_id": "chunk-018",
  "sheet_name": "GTM",
  "headers": [],
  "rows": [{"row": 12, "cells": {}}],
  "source_refs": []
}
```

同一 `claim_id` 被拆为多个块时，先按确定性顺序聚合最小必要块，再提交 LLM，不得合并整个产品的全部资料。

### 6.2 SourceRef 与 ProductScope

```json
{
  "file_name": "",
  "sheet_name": "",
  "range": "",
  "row": 0,
  "column": "",
  "cell_address": "",
  "chunk_id": ""
}
```

无法定位时使用 `[]`，相关结果的 `confidence` 必须为 `low`，不得构造路径。ProductScope 保存型号、SKU、版本、责任人和范围确认状态；无法确认时进入 `manual_review`。

### 6.3 HardFailCheck

```json
{
  "rule_id": "model_version|core_claim_evidence|cross_document_conflict",
  "hard_fail": false,
  "finding": "",
  "source_refs": []
}
```

### 6.4 CompletenessCheck

```json
{
  "module": "",
  "field_results": [{
    "field": "",
    "status": "present|missing|unreadable",
    "score": 0,
    "source_refs": []
  }],
  "notes": []
}
```

### 6.5 ClaimCheck

```json
{
  "claim_id": "",
  "rule_id": "usp_voc|functional_validation|evidence_scope|usp_keyword",
  "status": "pass|risk|fail|uncertain",
  "facts": [],
  "inference": "",
  "evidence_grade": "A|B|C|D|none",
  "source_refs": [],
  "risk": "",
  "required_action": "",
  "owner_role": "",
  "confidence": "high|medium|low"
}
```

VisualizationCheck 与 CommunicationCheck 分别保存展示方案或通信检查结果、来源、风险、必需动作、责任角色和置信度。

### 6.6 ValidationTask

```json
{
  "task_id": "",
  "project_id": "",
  "version_id": "",
  "skill_id": "ipd-visual-admission-review",
  "skill_version": "V1.0",
  "stage": "queued|parsing|locating|hard_fail|completeness|claims|visualization|communication|aggregating|completed|failed|cancelled|manual_review",
  "progress": 0,
  "attempts": 0,
  "error_code": ""
}
```

### 6.7 AdmissionReport

报告必须符合 `references/report-schema.json`，至少包含 `review_id`、`admission_status`、`source_path`、`hard_fail_checks`、`completeness`、`usp_voc_brief` 和 `findings`，可选包含 `manual_review_reasons`。

## 7. 最终状态

1. 任一 `hard_fail=true`：`rejected`。
2. 无一票退回但存在关键证据缺失、功能验证缺失、展示困难、超证据结论或高风险通信问题：`conditional_approval`。
3. 检查完成且无高风险缺口：`approved`。
4. 解析失败、来源无法定位、产品范围无法确认或输出无法验证：`manual_review`。

## 8. 服务层

- FileService：保存原始 Excel、元数据和解析快照，不覆盖历史版本。
- ExcelParserService：调用 `excel_parser` 生成目录、字段映射、内容块和定位索引。
- RuleService：管理 Skill 文件、版本、发布状态和任务绑定。
- TaskService：创建异步任务、记录进度、重试无效输出、处理取消和错误。
- ValidationOrchestrator：按 A-G 顺序调用适配器，控制输入最小化并验证输出契约。
- ReportService：执行 Schema 校验、状态计算、报告持久化和 Markdown 渲染。
- ExportService：导出已保存的 JSON 和 Markdown，不加入 Prompt、调试日志或未确认建议。

## 9. LLM 与 Skill 契约

所有调用使用统一 system 约束：只依据输入资料块，不补充外部常识，不编造证据或定位，区分事实、推断和视觉建议，只输出 JSON。

每次调用只执行一个规则或一个 `claim_id`。A-G 输出协议分别对应资料定位、退回检查、完整度、卖点证据、展示方案、场景/Slogan 和报告汇总模板。跨块关联使用稳定的 `claim_id`、`evidence_id` 和 `source_id`。

## 10. 可靠性和失败处理

- LLM JSON 无效时使用相同任务重试一次。
- 第二次仍无效时记录 `LLM_OUTPUT_INVALID`，任务转 `manual_review`。
- 缺少资料时按优先级继续搜索并在报告记录缺失路径。
- 单个块失败不阻断其他块，但不得把缺失当作通过。
- 任务取消后停止当前运行，保留原文件、规则版本和历史报告。
- 网络超时和 API 错误必须包含阶段、规则编号和可重试原因。

## 11. 接口约定

```text
POST /api/projects
POST /api/projects/{project_id}/validation-tasks
GET  /api/projects/{project_id}/validation-tasks/{task_id}
POST /api/projects/{project_id}/validation-tasks/{task_id}/cancel
GET  /api/projects/{project_id}/admission-reports/{review_id}
GET  /api/projects/{project_id}/admission-reports/{review_id}/json
GET  /api/projects/{project_id}/admission-reports/{review_id}/markdown
```

创建任务时绑定 Excel 文件和已发布 Skill 版本；报告接口返回报告 JSON、规则版本、来源文件摘要和任务元数据。

## 12. 配置与禁止逻辑

```env
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
EXCEL_PARSER_FILES_ROOT=
APP_DATA_ROOT=
```

密钥不写入前端、Markdown、数据库报告或导出文件。

一票退回不能被覆盖为通过；完整度高不能覆盖证据缺失或参数冲突；VOC、竞品和行业资料不能证明本产品功能；视觉方案不能补齐产品证据；汇总器不能重新读取原始资料或发起事实判断；未知、无法定位和解析失败必须保持人工复核语义；原始 Excel、Skill 原文和历史报告不得覆盖；动态规则不得硬编码到主流程。

## 13. 架构验收标准

- A-G 每一阶段均有输入、输出、判断、失败处理和禁止事项。
- 每次 LLM 调用只处理一个规则或一个 `claim_id`。
- 结构化输出通过 Schema 校验并保留来源定位。
- 三组评估案例结果符合规则预期。
- 报告 JSON 与页面展示字段一致。
- 任务取消、LLM 重试和人工复核状态可追踪。
- 历史报告可根据文件版本和 Skill 版本复现。

