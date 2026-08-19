# IPD 视觉准入看板

本地单页 Web 工具：读取符合 `ipd-admission-v1` 协议的 Markdown 或 JSON 结论文件，将其解析、校验并渲染为响应式视觉准入看板。

## 启动

```powershell
npm.cmd install
npm.cmd run dev
```

默认访问 `http://localhost:3000`。生产构建：

```powershell
npm.cmd run build
```

## 输入协议

- 接受本地 `.md` 和 `.json` 文件。
- Markdown frontmatter 或 JSON 顶层必须包含 `schema_version: ipd-admission-v1`。
- Markdown 正文根据稳定字段 ID 解析，例如 `## CYA002 | admission_result`；JSON 直接读取协议顶层字段。
- 支持的结果为：`通过`、`有条件通过`、`不通过`。
- UI 不从摘要推断结果、不计算完整度评分、不重排数组，也不补充业务结论。

可使用 [示例输入](public/example-ipd-admission.md) 验证页面。

## 目录

```text
app/
  page.tsx       输入解析、校验和固定看板组件
  styles.css     设计令牌与响应式样式
public/
  example-ipd-admission.md
```
