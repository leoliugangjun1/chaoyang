import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiCompatibleLlmClient } from '../server/llm-client.js';
import { planActionVariation } from '../server/action-variation-planner.js';
import { TemporaryImageHost } from '../server/temporary-image-host.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = await fs.readFile(path.join(root, '.env'), 'utf8');
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const imagePath = path.join(os.tmpdir(), `action-variation-planning-${Date.now()}.png`);
await fs.writeFile(imagePath, Buffer.from(await (await fetch('https://lsky.zhongzhuan.chat/i/2024/10/17/6711068a14527.png', { signal: AbortSignal.timeout(30000) })).arrayBuffer()));
const host = new TemporaryImageHost();
let upload;
try {
  upload = await host.upload({ localPath: imagePath, mimeType: 'image/png' });
  const plan = await planActionVariation({ client: OpenAiCompatibleLlmClient.fromEnvironment(), imageUrl: upload.url, templates: [{ id: 'sample', name: 'Sample action', prompt: 'Standing pose with both arms relaxed.' }] });
  console.log(JSON.stringify({ ok: true, subjectProfilePresent: Boolean(plan.subjectProfile), actionGuidancePresent: Boolean(plan.actionPlans[0]?.actionGuidance), generationPromptPresent: Boolean(plan.actionPlans[0]?.generationPrompt) }));
} finally {
  await host.remove(upload);
  await fs.rm(imagePath, { force: true });
}
