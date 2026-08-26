import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchRuntime } from '../server/runtime.js';
test('task records module and plugin versions and produces a local asset', async () => { const source = path.resolve('modules'); const plugins = path.resolve('../ai-workbench-plugins'); const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workbench-')); const pluginRoot = path.join(root, 'plugin-packages'); await fs.cp(source, path.join(root, 'modules'), { recursive: true }); await fs.cp(plugins, pluginRoot, { recursive: true }); const runtime = new WorkbenchRuntime(root, { pluginRoot }); await runtime.initialize(); const task = await runtime.createTask({ moduleKey: 'model.dress-change@1.0.0', input: { modelImage: { name: 'model.png' }, prompt: 'catalog shot' } }); await new Promise((resolve) => setTimeout(resolve, 800)); const finished = runtime.tasks.get(task.taskId); assert.equal(finished.status, 'completed'); assert.equal(finished.moduleVersion, '1.0.0'); assert.equal(finished.pluginId, 'provider.example'); assert.equal(finished.pluginVersion, '1.0.0'); assert.equal(finished.outputs.length, 1); });
