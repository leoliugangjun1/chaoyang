import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkbenchRuntime } from '../server/runtime.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('sample module satisfies the protocol', async () => { const runtime = new WorkbenchRuntime(root); const module = await runtime.loadModule(path.join(root, 'modules/model.dress-change/1.0.0')); assert.equal(module.key, 'model.dress-change@1.0.0'); });
