# IPD 产品视觉准入审核智能体

本目录是独立的本地审核应用。产品、架构和界面规范在 `docs/产品事实校验/`。

## 本地启动

```powershell
py -m backend.server
```

默认地址为 `http://127.0.0.1:4180`。可使用 `APP_PORT` 改写端口。

前端源代码位于 `app/`，使用 React + TypeScript；构建后的静态文件输出至 `out/`，由 Python 服务提供。
