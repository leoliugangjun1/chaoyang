# 服装视觉设计分析智能体 ARCHITECTURE

## 1. 文档定位

本文档面向 Vibe Coding Agent 和开发人员，定义服装视觉设计分析智能体的技术边界、数据结构、服务层、AI 调用机制、Skill 插口、文件版本管理和不可破坏的逻辑。

## 2. 总体架构

```text
Web 前端
  -> 项目与文件服务
  -> 异步任务服务
  -> Agent 编排服务
      -> 产品理解 Agent
      -> 市场分析 Agent
      -> 视觉策略 Agent
  -> Skill 注册与版本服务
      -> 产品事实校验 Skill
      -> 联网调研 Skill
      -> 图片搜索 Skill
      -> 视觉策划 Skill
  -> 项目版本存储
  -> PDF 和图片 ZIP 导出服务
```

三个 Agent 的输入、处理和输出由对应 Skill 规则定义。主系统负责阶段控制、数据保存、人工确认、结构化校验和结果渲染，不把具体品类规则写死。

## 3. 技术栈要求

第一版只要求本地运行，具体框架由实现 Agent 选择，但必须满足以下约束：

- 前端和后端边界清晰；
- 支持异步任务和进度查询；
- 支持本地文件保存；
- 支持项目和版本持久化；
- 支持结构化 Skill 调用；
- 支持网页看板渲染；
- 支持 PDF 导出；
- 支持图片 ZIP 导出；
- 支持 OpenAI 兼容 API；
- 后续可迁移到团队服务器。

推荐实现方向：

- 前端：React + TypeScript + Vite；
- 后端：Python FastAPI 或 Node.js；
- 本地数据库：SQLite；
- 文件存储：项目目录 + 数据库元数据；
- 异步任务：后端任务队列或后台任务表；
- PDF：浏览器渲染或后端 PDF 渲染方案；
- 配置：`.env` 和 `.env.example`。

## 4. 建议目录结构

```text
app/
  frontend/
    src/
      pages/
        ProjectInputPage/
        ValidationResearchPage/
        VisualBoardPage/
      components/
        FileUploader/
        RuleSelector/
        ProgressPanel/
        FactTable/
        EvidenceTable/
        WeightEditor/
        ImageReviewModal/
        VisualBoardRenderer/
        VersionSwitcher/
      services/
      types/
      styles/
  backend/
    app/
      api/
      agents/
        product-understanding/
        market-analysis/
        visual-strategy/
      skills/
        registry/
        adapters/
      services/
        project-service/
        file-service/
        version-service/
        task-service/
        evidence-service/
        export-service/
      models/
      schemas/
      storage/
      workers/
  projects/
    {project_id}/
      versions/
  rules/
    active/
    archived/
  .env
  .env.example
  .gitignore
```

## 5. 项目和版本目录

```text
projects/{project_id}/versions/{version_id}/
  source/
    original.md
    confirmed.md
    source.xlsx
    uploads/
  rules/
    rule-bindings.json
  research/
    screenshots/
    image-candidates.json
    selected-images.json
    source-index.json
    research-results.json
  product/
    product-facts.json
    selling-point-evidence.json
  outputs/
    market-analysis.json
    visual-dashboard.json
    visual-dashboard-edited.json
    visual-dashboard.pdf
    visual-dashboard-images.zip
```

取消任务时，本次运行中的临时结果和进度记录不保留；原有项目版本、原始文件和已完成版本不受影响。

## 6. 数据模型

### 6.1 Project

```json
{
  "project_id": "",
  "name": "用户自定义名称",
  "created_at": "",
  "updated_at": "",
  "current_version_id": ""
}
```

### 6.2 ProjectVersion

```json
{
  "version_id": "",
  "project_id": "",
  "version_number": "1.0",
  "status": "active",
  "created_at": "",
  "source_files": [],
  "rule_bindings": {},
  "weights": {
    "markdown": 8,
    "web": 2
  }
}
```

### 6.3 Rule

```json
{
  "rule_id": "",
  "name": "",
  "type": "product_validation|image_search|visual_planning",
  "version": "",
  "source_markdown_path": "",
  "status": "active|archived",
  "created_at": "",
  "effective_at": ""
}
```

每个项目每种规则类型只绑定一条规则。旧规则停用但不删除，历史项目仍保留原规则绑定。

### 6.4 ProductFacts

```json
{
  "project_id": "",
  "version_id": "",
  "items": [
    {
      "field": "fabric",
      "value": "",
      "source": "",
      "evidence_type": "fact|inference|assumption|design_advice",
      "status": "missing|pending_confirmation|confirmed",
      "user_note": ""
    }
  ],
  "status": "pending_user_confirmation|confirmed"
}
```

字段来源于产品事实规则 Skill，主程序不得硬编码必填字段。

### 6.5 SellingPointEvidence

```json
{
  "rank": 1,
  "name": "",
  "product_view": "",
  "user_view": "",
  "evidence": [],
  "source": "markdown",
  "status": "pending_confirmation|confirmed"
}
```

`rank` 必须保留 Markdown 中的原始顺序。联网数据不能重排 `rank`。

### 6.6 ResearchResult

```json
{
  "data": [],
  "conclusions": [],
  "sources": [],
  "captured_at": "",
  "screenshots": [],
  "missing_items": [],
  "evidence_labels": []
}
```

### 6.7 ImageCandidate

```json
{
  "image_id": "",
  "project_id": "",
  "version_id": "",
  "category": "competitor|industry|scene|ugc|user_upload",
  "source_type": "amazon|independent_site|image_search|user_upload",
  "source_url": "",
  "search_query": "",
  "local_path": "",
  "page_type": "",
  "related_claims": [],
  "ai_reason": "",
  "captured_at": "",
  "evidence_status": "available|insufficient",
  "review_status": "pending|selected|rejected",
  "user_note": ""
}
```

只有 `review_status = selected` 的图片可以传入视觉策划 Agent。

### 6.8 VisualDashboard

```json
{
  "project_id": "",
  "version_id": "",
  "layout_schema": {},
  "sections": [],
  "selected_images": [],
  "editable_fields": [],
  "pdf_payload": {}
}
```

视觉策划 Skill 定义 `layout_schema`、`sections` 和 `editable_fields`。主系统负责结构校验和渲染。

## 7. 服务层设定

### 7.1 ProjectService

负责：

- 创建项目；
- 更新项目名称；
- 查询历史项目；
- 切换当前版本；
- 获取项目详情。

### 7.2 FileService

负责：

- 保存 Markdown、Excel 和图片；
- Excel 转 Markdown；
- 保存原始文件和转换文件；
- 生成文件元数据；
- 保证文件不被新版本覆盖。

### 7.3 RuleService

负责：

- 上传规则 Markdown；
- 保存规则名称、类型和版本；
- 管理当前规则和历史规则；
- 每种类型绑定一条当前规则；
- 查看历史项目使用的规则原文。

上传规则时不校验 Markdown 内容格式。规则执行失败时，返回规则名称、版本、错误位置和失败原因。

### 7.4 TaskService

负责：

- 创建阶段任务；
- 手动启动任务；
- 保存阶段和步骤进度；
- 查询任务状态；
- 处理取消任务；
- 规则失败后的自动重新执行；
- 阶段完成完整性检查。

用户侧只显示取消任务，不显示暂停和手动重试。

### 7.5 AgentOrchestrator

负责：

- 按阶段调用 Agent；
- 检查前置人工确认状态；
- 绑定当前版本的 Skill；
- 传递结构化输入；
- 校验结构化输出；
- 将结果写入对应版本目录。

### 7.6 EvidenceService

负责：

- 保存来源链接；
- 保存采集时间；
- 保存截图路径；
- 关联结论和图片；
- 标记数据不足；
- 为 SaaS 页面提供动态证据展示。

### 7.7 ExportService

负责：

- 根据当前视觉看板生成 PDF；
- 仅导出第三页正式内容；
- 排除来源、权重、版本、事实标签和任务状态；
- 收集当前看板使用的图片；
- 生成视觉看板图片 ZIP；
- 保存 PDF 和 ZIP 到当前版本。

## 8. AI 应用机制

### 8.1 产品理解 Agent

输入：

- 原始 Markdown；
- Excel 转换后的 Markdown；
- 用户上传图片；
- 产品事实校验 Skill；
- 项目基础信息。

处理和输出完全遵循产品事实校验 Skill。主程序只负责传入资料、校验结果结构和保存结果。

输出至少包含：

- 产品事实表；
- 卖点证据表；
- 缺失信息；
- 图片理解结果；
- 解析状态。

产品事实表和卖点证据表必须等待用户确认。

### 8.2 市场分析 Agent

输入、处理和输出完全遵循当前市场分析及联网调研 Skill。主程序只负责：

- 提供已确认的产品事实；
- 提供 Markdown 资料；
- 提供联网调研 Skill 结果；
- 提供图片搜索 Skill；
- 提供 Markdown/联网权重；
- 保存结构化结果。

联网调研入口至少包括：

- Google 搜索指数；
- 竞品独立站；
- Amazon 相似数据和热搜前三页；
- 用户评论和历史页面资料。

每个联网 Skill 必须返回数据、结论、来源链接、采集时间、截图路径、数据不足项和信息类型标签。

### 8.3 视觉策略 Agent

输入、处理和输出完全遵循视觉策划 Skill。主程序只传入：

- 已确认产品事实；
- 已确认卖点证据；
- Markdown 调研资料；
- 联网调研结果；
- 用户选择为「采用」的图片；
- 当前视觉策划规则；
- 应用后的权重。

主程序不固定视觉方案的模块数量、顺序、图片数量和陈列方式。

## 9. Skill 插口协议

### 9.1 产品事实校验 Skill

定义：

- Markdown 必填字段；
- 字段格式；
- 信息缺失处理；
- 产品事实解析规则；
- 卖点证据结构。

主程序不写死字段清单。

### 9.2 联网调研 Skill

统一输出：

```json
{
  "data": [],
  "conclusions": [],
  "sources": [],
  "captured_at": "",
  "screenshots": [],
  "missing_items": [],
  "evidence_labels": []
}
```

具体搜索方法由后续 Skill 定义，主程序只负责调用和保存。

### 9.3 图片搜索 Skill

主程序提供：

- 已确认的产品事实；
- Markdown 调研资料；
- 联网调研结果；
- 当前权重；
- 项目和版本 ID。

Skill 返回候选图片、来源索引、搜索日志、数据不足项和用户确认入口所需字段。

### 9.4 视觉策划 Skill

Skill 返回可渲染的视觉看板结构化数据。未知模块不得静默丢弃，应返回结构化错误。

## 10. 权重机制

默认配置：

```json
{
  "markdown": 8,
  "web": 2
}
```

约束：

- 两个权重总和固定为 `10`；
- 用户可在第二页编辑；
- 点击「应用权重」后才重新计算；
- 权重影响文字结论排序、证据强度和图片候选推荐；
- 权重不修改原始资料；
- 权重保存到项目版本。

权重不能改变 Markdown 已有卖点顺序，只改变补充资料的展示和合并结果。

## 11. 页面技术边界

### 第一页

负责：项目创建、文件上传、Excel 转换、规则选择和第一阶段启动。

### 第二页

负责：产品事实编辑、卖点证据编辑、Markdown/联网资料展示、权重应用、图片确认弹窗和第二阶段启动。

### 第三页

负责：视觉看板渲染、版本切换、导出前编辑、PDF 导出和图片 ZIP 导出。

前端不得将页面状态作为唯一数据源。用户确认、版本、文件、规则绑定和看板编辑结果必须写入后端存储。

## 12. 任务和可靠性

任务流程：

```text
创建任务
  -> 记录阶段和步骤
  -> 执行 Skill/Agent
  -> 保存结构化结果
  -> 校验结果完整性
  -> 更新进度
  -> 等待用户确认或进入下一个手动阶段
```

可靠性要求：

- 阶段拆分为可恢复步骤；
- 模型输出必须进行结构化校验；
- 联网请求设置超时和备用处理；
- 单一来源失败不阻断其他来源；
- 无法访问时标记数据不足；
- 规则执行失败时自动重新执行；
- 阶段完成前执行完整性检查。

取消任务后：

- 停止当前运行任务；
- 不保留本次运行中的中间结果和进度记录；
- 保留原有项目文件和已完成版本；
- 后续可以重新启动当前阶段。

## 13. 版本和规则绑定

重新上传 Markdown 时：

- 直接采用新 Markdown；
- 不执行旧文件和新文件差异确认；
- 生成新的文件版本和分析版本；
- 旧 Markdown、旧结果和旧看板保留；
- 新版本作为当前版本；
- 历史版本可切换查看。

每个项目版本必须记录：

- 使用的校验规则名称和版本；
- 使用的图片搜索规则名称和版本；
- 使用的视觉策划规则名称和版本；
- 当前权重；
- 原始文件和确认文件路径。

## 14. 后端配置

使用 `.env` 保存敏感配置，代码不得硬编码密钥：

```env
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
SEARCH_API_KEY=
OCR_API_KEY=
```

同时提供 `.env.example`。`.env` 加入 `.gitignore`，不得写入前端、Markdown、数据库或导出文件。

## 15. 开发约束

实现顺序：

1. 项目、版本和文件存储；
2. 三页基础路由；
3. Skill 注册、选择和版本绑定；
4. 产品事实和卖点证据数据模型；
5. 第一阶段确认闸门；
6. 第二页资料、权重和图片确认；
7. 第三页结构化看板；
8. 导出前编辑、PDF 和图片 ZIP；
9. 任务进度、取消和异常处理；
10. 最后实现视觉样式优化。

开发 Agent 不得：

- 把产品事实必填字段写死在主流程；
- 把联网搜索方法写死在主流程；
- 把视觉策划图片数量和排序写死；
- 用联网资料覆盖 Markdown 卖点顺序；
- 让未确认图片进入视觉策划；
- 用前端状态代替后端项目和版本保存；
- 把规则 Skill 原文自动修改或覆盖；
- 取消任务后继续使用本次运行中间结果；
- 在 PDF 中输出 SaaS 调试信息。

## 16. 禁止破坏的逻辑

以下逻辑属于核心契约，任何功能开发不得破坏：

1. Markdown 是产品事实和卖点顺序的最高来源；
2. 联网资料权重默认是 Markdown `8`、联网 `2`，且可编辑；
3. 权重不能改变 Markdown 原始卖点顺序；
4. 产品事实和卖点证据必须人工确认；
5. 图片候选必须人工确认后才能进入视觉策划；
6. 每阶段手动启动，不自动跳转；
7. 每种规则类型一个项目只启用一条规则；
8. 历史规则只停用、不删除；
9. 新资料生成新版本，旧版本不覆盖；
10. 原始文件、确认文件、截图、来源和规则版本必须保留；
11. 用户取消任务时不保留本次运行中间结果；
12. PDF 只导出第三页视觉看板正式内容；
13. PDF 不包含来源、权重、状态和技术调试信息；
14. 图片 ZIP 只收集当前视觉看板使用的图片；
15. 动态 Skill 规则不得硬编码到主流程。

## 17. 接口约定

### 产品事实输出

```json
{
  "project_id": "",
  "version_id": "",
  "product_facts": [],
  "selling_point_evidence": [],
  "missing_items": [],
  "status": "pending_user_confirmation"
}
```

### 联网调研输出

```json
{
  "data": [],
  "conclusions": [],
  "sources": [],
  "captured_at": "",
  "screenshots": [],
  "missing_items": [],
  "evidence_labels": []
}
```

### 图片搜索输出

```json
{
  "image_candidates": [],
  "missing_sources": [],
  "search_log": [],
  "source_index": [],
  "next_action": "user_review"
}
```

### 视觉看板输出

```json
{
  "project_id": "",
  "version_id": "",
  "layout_schema": {},
  "sections": [],
  "selected_images": [],
  "editable_fields": [],
  "pdf_payload": {}
}
```

## 18. 架构验收标准

### 数据和版本

- 原始 Markdown、确认 Markdown、Excel、转换 Markdown 和图片均可追溯；
- 新分析版本不会覆盖旧结果；
- 历史版本绑定当时使用的规则；
- 规则原文和规则版本可查看。

### Agent 和 Skill

- 三个 Agent 按阶段边界运行；
- 产品事实字段来自校验规则 Skill；
- 市场分析输入、处理和输出遵循市场调研 Skill；
- 视觉策划输入、处理和输出遵循视觉策划 Skill；
- 联网搜索方法可以替换，不修改主流程；
- 视觉策划结构可以替换，不修改主渲染器协议。

### 任务和交互

- 每阶段可手动启动；
- 进度可以保存和查询；
- 用户可以取消任务；
- 规则失败有原因并自动重新执行；
- 单个来源失败不会导致整体数据伪造或静默失败。

### 输出

- 第三页可以渲染结构化视觉看板；
- 用户可以导出 PDF；
- 用户可以导出当前看板使用的图片 ZIP；
- PDF 不含 SaaS 动态信息；
- 未确认图片不会出现在视觉策划结果中。
