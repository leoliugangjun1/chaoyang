import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkbenchRuntime } from '../server/runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('plugin manager isolates lifecycle changes without losing discovery', async () => {
  const runtime = new WorkbenchRuntime(root);
  await runtime.initialize();
  const key = 'provider.example@1.0.0';
  assert.equal(runtime.pluginManager.get(key).status, 'ready');
  await runtime.pluginManager.action(key, 'disable');
  assert.equal(runtime.pluginManager.get(key).status, 'disabled');
  assert.equal(runtime.pluginManager.provider('image.generate'), null);
  await runtime.pluginManager.action(key, 'enable');
  assert.equal(runtime.pluginManager.get(key).health, 'healthy');
  assert.equal(runtime.pluginManager.provider('image.generate').key, key);
});
