import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiCompatibleLlmClient } from '../server/llm-client.js';

test('LLM client uses its dedicated key and Chat Completions endpoint', async () => {
  let request;
  const client = OpenAiCompatibleLlmClient.fromEnvironment({
    OPENAI_LLM_API_KEY: 'llm-key',
    OPENAI_LLM_BASE_URL: 'https://example.test/v1/chat/completions',
    OPENAI_LLM_MODEL: 'gpt-5.5',
  }, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
    },
  });

  const response = await client.createCompletion([{ role: 'user', content: 'ping' }]);

  assert.equal(request.url, 'https://example.test/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer llm-key');
  assert.deepEqual(JSON.parse(request.options.body), { model: 'gpt-5.5', messages: [{ role: 'user', content: 'ping' }] });
  assert.equal(response.choices[0].message.content, 'OK');
});

test('LLM client rejects a missing dedicated key', () => {
  assert.throws(() => OpenAiCompatibleLlmClient.fromEnvironment({
    OPENAI_LLM_BASE_URL: 'https://example.test/v1/chat/completions',
    OPENAI_LLM_MODEL: 'gpt-5.5',
  }), /OPENAI_LLM_API_KEY/);
});

test('LLM client sends Responses requests to the dedicated endpoint', async () => {
  let request;
  const client = OpenAiCompatibleLlmClient.fromEnvironment({
    OPENAI_LLM_API_KEY: 'llm-key',
    OPENAI_LLM_BASE_URL: 'https://example.test/v1/chat/completions',
    OPENAI_LLM_RESPONSES_URL: 'https://example.test/v1/responses',
    OPENAI_LLM_MODEL: 'gpt-5.5',
  }, { fetchImpl: async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 }); } });

  await client.createResponse([{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }], { max_output_tokens: 300 });

  assert.equal(request.url, 'https://example.test/v1/responses');
  assert.deepEqual(JSON.parse(request.options.body), { model: 'gpt-5.5', input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }], max_output_tokens: 300 });
});

test('LLM client collects text from a streamed Chat response', async () => {
  const client = OpenAiCompatibleLlmClient.fromEnvironment({ OPENAI_LLM_API_KEY: 'llm-key', OPENAI_LLM_BASE_URL: 'https://example.test/v1/chat/completions', OPENAI_LLM_MODEL: 'gpt-5.6-sol' }, { fetchImpl: async () => new Response('data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}\n\ndata: {"choices":[{"delta":{"content":"true}"}}]}\n\ndata: [DONE]\n', { status: 200 }) });
  const response = await client.createCompletionStream([{ role: 'user', content: 'ping' }]);
  assert.equal(response.output_text, '{"ok":true}');
});
