import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiCompatibleLlmClient } from '../server/llm-client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = await fs.readFile(path.join(root, '.env'), 'utf8');
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const client = OpenAiCompatibleLlmClient.fromEnvironment();
const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J/OYAAAAASUVORK5CYII=';
if (process.argv.includes('--openlux-example')) {
  const response = await fetch(client.baseUrl, { method: 'POST', headers: { Authorization: `Bearer ${client.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: client.model, messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: [{ type: 'text', text: 'What is in this image? Reply with exactly: OK' }, { type: 'image_url', image_url: { url: 'https://lsky.zhongzhuan.chat/i/2024/10/17/6711068a14527.png' } }] }], stream: true }), signal: AbortSignal.timeout(30000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Chat Completions API ${response.status}: ${body.slice(0, 300)}`);
  console.log(JSON.stringify({ ok: true, api: 'chat_completions_stream', streamContentPresent: /data:\s*[^\r\n\s]/.test(body), responseBytes: body.length }));
} else if (process.argv.includes('--responses')) {
  const endpoint = client.baseUrl.replace(/\/chat\/completions\/?$/, '/responses');
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${client.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: client.model, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Return exactly this JSON: {"ok":true}' }, { type: 'input_image', image_url: imageUrl, detail: 'auto' }] }], max_output_tokens: 300 }), signal: AbortSignal.timeout(30000) });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(data?.error?.message || `Responses API ${response.status}`);
  const outputText = typeof data?.output_text === 'string' ? data.output_text : '';
  console.log(JSON.stringify({ ok: true, api: 'responses', topLevelFields: Object.keys(data).sort(), outputTextLength: outputText.length }));
} else {
  const data = await client.createCompletion([{ role: 'user', content: [{ type: 'text', text: 'Return exactly this JSON: {"ok":true}' }, { type: 'image_url', image_url: { url: imageUrl } }] }], { temperature: 0, max_completion_tokens: 300, signal: AbortSignal.timeout(30000) });
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  console.log(JSON.stringify({ ok: true, api: 'chat_completions', choiceFields: Object.keys(choice).sort(), messageFields: Object.keys(message).sort(), contentLength: typeof message.content === 'string' ? message.content.length : 0, reasoningLength: typeof message.reasoning_content === 'string' ? message.reasoning_content.length : 0 }));
}
