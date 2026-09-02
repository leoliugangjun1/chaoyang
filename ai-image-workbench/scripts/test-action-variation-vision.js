import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiCompatibleLlmClient } from '../server/llm-client.js';
import { TemporaryImageHost } from '../server/temporary-image-host.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = await fs.readFile(path.join(root, '.env'), 'utf8');
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const imagePath = path.join(os.tmpdir(), `action-variation-vision-${Date.now()}.png`);
const image = process.argv.includes('--sample') ? Buffer.from(await (await fetch('https://lsky.zhongzhuan.chat/i/2024/10/17/6711068a14527.png', { signal: AbortSignal.timeout(30000) })).arrayBuffer()) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J/OYAAAAASUVORK5CYII=', 'base64');
await fs.writeFile(imagePath, image);
const host = new TemporaryImageHost();
let upload;
try {
  upload = await host.upload({ localPath: imagePath, mimeType: 'image/png' });
  const hosted = await fetch(upload.url, { signal: AbortSignal.timeout(30000) });
  const hostedBytes = Buffer.from(await hosted.arrayBuffer());
  const pngHeader = hostedBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (process.argv.includes('--host-only')) {
    console.log(JSON.stringify({ ok: hosted.ok && pngHeader, temporaryUpload: true, hostedStatus: hosted.status, contentType: hosted.headers.get('content-type') || '', pngHeader, byteLength: hostedBytes.length }));
    process.exit(0);
  }
  const client = OpenAiCompatibleLlmClient.fromEnvironment();
  const result = await client.createCompletionStream([{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }, { type: 'image_url', image_url: { url: upload.url } }] }], { signal: AbortSignal.timeout(30000) });
  console.log(JSON.stringify({ ok: true, temporaryUpload: true, streamContentPresent: Boolean(result.output_text) }));
} finally {
  await host.remove(upload);
  await fs.rm(imagePath, { force: true });
}
