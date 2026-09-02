import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiCompatibleLlmClient } from '../server/llm-client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const loadEnvFile = async () => {
  const text = await fs.readFile(path.join(root, '.env'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
};

await loadEnvFile();
const client = OpenAiCompatibleLlmClient.fromEnvironment();
const data = await client.createCompletion([{ role: 'user', content: 'Reply with exactly: OK' }], { max_tokens: 8 });
const content = data?.choices?.[0]?.message?.content;
console.log(JSON.stringify({
  ok: true,
  model: process.env.OPENAI_LLM_MODEL,
  choicesPresent: Array.isArray(data?.choices),
  messagePresent: Boolean(data?.choices?.[0]?.message),
  contentPresent: Boolean(content),
}));
