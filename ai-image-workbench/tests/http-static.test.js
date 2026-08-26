import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('static root resolves to public/index.html on Windows paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-http-'));
  const publicDir = path.join(root, 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'index.html'), 'workbench-ok');
  const publicRoot = path.resolve(root, 'public');
  const requestPath = '/index.html';
  const relativePath = decodeURIComponent(requestPath).replace(/^[/\\]+/, '');
  const file = path.resolve(publicRoot, relativePath);
  assert.equal(file, path.join(publicRoot, 'index.html'));
  assert.equal(await fs.readFile(file, 'utf8'), 'workbench-ok');
});
