import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('HTTP plugin catalog requires a session and supports rescan', async () => {
  const port = 4191;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server startup timeout')), 5000);
      child.stdout.on('data', (chunk) => { if (chunk.toString().includes('running at')) { clearTimeout(timer); resolve(); } });
      child.on('error', reject);
    });
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/plugins`);
    assert.equal(unauthorized.status, 401);
    const response = await fetch(`http://127.0.0.1:${port}/api/plugins/rescan`, { method: 'POST', headers: { 'x-workbench-session': health.sessionToken, 'content-type': 'application/json' }, body: '{}' });
    const catalog = await response.json();
    assert.equal(response.status, 200);
    assert.equal(catalog.plugins[0].key, 'provider.example@1.0.0');
  } finally {
    child.kill();
  }
});
