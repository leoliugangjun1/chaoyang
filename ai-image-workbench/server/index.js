import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WorkbenchRuntime } from './runtime.js';
import { PlatformError } from '../src/shared/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const runtime = new WorkbenchRuntime(root); const sessionToken = crypto.randomBytes(24).toString('hex'); const port = Number(process.env.PORT || 4189); const host = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const respond = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const body = async (req) => JSON.parse(await new Promise((resolve, reject) => { let value = ''; req.on('data', (chunk) => value += chunk); req.on('end', () => resolve(value || '{}')); req.on('error', reject); }));
await runtime.initialize();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/health') return respond(res, 200, { status: 'ok', platformVersion: '1.0.0', sessionToken });
    if (url.pathname.startsWith('/api/') && req.headers['x-workbench-session'] !== sessionToken) return respond(res, 401, { code: 'SESSION_INVALID', message: 'Local session token required.' });
    if (req.method === 'GET' && url.pathname === '/api/platform') return respond(res, 200, { version: '1.0.0', modules: runtime.modules.length, quarantined: runtime.quarantine.length });
    if (req.method === 'GET' && url.pathname === '/api/config') return respond(res, 200, runtime.config());
    if (req.method === 'GET' && url.pathname === '/api/templates') return respond(res, 200, { templates: runtime.templates });
    if (req.method === 'POST' && url.pathname === '/api/templates') return respond(res, 201, { template: await runtime.createTemplate(await body(req)) });
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/templates/')) return respond(res, 200, { template: await runtime.updateTemplate(url.pathname.split('/').pop(), await body(req)) });
    if (req.method === 'POST' && url.pathname === '/api/assets') return respond(res, 201, { asset: await runtime.createUpload(await body(req)) });
    if (req.method === 'POST' && url.pathname === '/api/action-variation/batches') return respond(res, 202, { batch: await runtime.createActionVariationBatch(await body(req)) });
    if (req.method === 'GET' && url.pathname.startsWith('/api/action-variation/batches/')) return respond(res, 200, { batch: runtime.actionVariationBatch(url.pathname.split('/').pop()) });
    if (req.method === 'POST' && /^\/api\/action-variation\/jobs\/[^/]+\/retry$/.test(url.pathname)) return respond(res, 202, { batch: await runtime.retryActionVariationJob(url.pathname.split('/')[4]) });
    if (req.method === 'POST' && url.pathname === '/api/generate') return respond(res, 202, { task: await runtime.createGeneration(await body(req)) });
    if (req.method === 'POST' && url.pathname.startsWith('/api/results/') && url.pathname.endsWith('/retry')) return respond(res, 202, { task: await runtime.retryResult(url.pathname.split('/')[3]) });
    if (req.method === 'GET' && url.pathname === '/api/modules') return respond(res, 200, { modules: runtime.listModules(), quarantine: runtime.quarantine });
    if (req.method === 'GET' && url.pathname === '/api/plugins') return respond(res, 200, runtime.listPlugins());
    if (req.method === 'POST' && url.pathname === '/api/plugins/rescan') return respond(res, 200, await runtime.refreshPlugins());
    if (req.method === 'POST' && url.pathname.startsWith('/api/plugins/') && url.pathname.endsWith('/action')) return respond(res, 200, { plugin: await runtime.pluginManager.action(url.pathname.split('/')[3], (await body(req)).action) });
    if (req.method === 'POST' && url.pathname === '/api/tasks') return respond(res, 202, { task: await runtime.createTask(await body(req)) });
    if (req.method === 'GET' && url.pathname.startsWith('/api/tasks/')) return respond(res, 200, { task: runtime.tasks.get(url.pathname.split('/').pop()) || null });
    if (req.method === 'POST' && url.pathname.endsWith('/cancel')) return respond(res, 200, { task: await runtime.cancelTask(url.pathname.split('/')[3]) });
    if (req.method === 'GET' && url.pathname === '/api/history') { const page = runtime.history({ offset: url.searchParams.get('offset'), limit: url.searchParams.get('limit') }); return respond(res, 200, { history: page.items, total: page.total, offset: page.offset, limit: page.limit, hasMore: page.hasMore }); }
    if (req.method === 'GET' && url.pathname.startsWith('/api/assets/')) { const asset = await runtime.asset(url.pathname.split('/').pop()); const data = await fs.readFile(asset.localPath); res.writeHead(200, { 'Content-Type': asset.mimeType, 'Content-Disposition': 'inline' }); return res.end(data); }
    if (req.method === 'GET') {
      const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
      const relativePath = decodeURIComponent(requestPath).replace(/^[/\\]+/, '');
      const publicRoot = path.resolve(root, 'public');
      const file = path.resolve(publicRoot, relativePath);
      if (file !== publicRoot && !file.startsWith(`${publicRoot}${path.sep}`)) throw new PlatformError('FORBIDDEN', 'Invalid file path.');
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      return res.end(data);
    }
    respond(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
  } catch (error) { const platform = error instanceof PlatformError ? error.toJSON() : { code: 'UNKNOWN_ERROR', message: 'Request failed.', retryable: false }; respond(res, platform.code === 'LOCAL_FILE_NOT_FOUND' ? 404 : 400, platform); }
});
server.listen(port, host, () => console.log(`AI Image Workbench running at http://${host}:${port}`));
