# 影像实验室 · AI 生图工作台

Online-deployable AI image workbench MVP. The browser only talks to this server; provider keys remain in the server-side `.env`. It supports reference-image uploads, prompt-controlled image generation, image2, Nano Banana configuration, and 1/2/4 candidate tasks.

```powershell
cd ai-image-workbench
npm.cmd run dev
```

Open `http://127.0.0.1:4189`. Without `OPENAI_API_KEY`, the bundled demo fallback creates an inspectable SVG result. With the key configured, image2 calls the real image API.

## Online deployment

1. Run `npm ci` on the server.
2. Copy `.env.example` to `.env` and set provider keys and a persistent `data/` volume.
3. Run `npm start` behind HTTPS and an authentication layer. Set `HOST=0.0.0.0` only behind that protected reverse proxy; the application session token is not a substitute for production authentication.
4. Persist `data/uploads`, `data/results`, `data/history`, and `data/templates.json` across deploys.

## Plugin platform

Place a versioned plugin in the sibling package directory `ai-workbench-plugins/<plugin-id>/<version>/` with `plugin.manifest.json`, `capabilities.json`, and `config.schema.json`. The workbench product and plugin packages are intentionally separate: the product contains runtime code and local data, while the sibling directory contains independently versioned plugin packages. Set `WORKBENCH_PLUGIN_ROOT` when using another package root. The service discovers valid plugins at startup; `POST /api/plugins/rescan` refreshes the catalog after adding one. The UI exposes health checks and enable/disable controls. Invalid or unavailable plugins are isolated and do not prevent the workbench from starting. Each task records the exact provider plugin and version selected at task creation.
