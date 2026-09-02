import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchRuntime } from '../server/runtime.js';

test('configured image sizes are validated and selected exactly', () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    OPENAI_IMAGE_SIZE_AUTO: 'auto',
    OPENAI_IMAGE_SIZE_2K_SQUARE: '2048x2048',
    OPENAI_IMAGE_SIZE_4K_LANDSCAPE: '3840x2160',
    OPENAI_IMAGE_SIZE_INVALID: '4000x2000',
    IMAGE_MAX_EDGE_PX: '3840',
    IMAGE_SIZE_MULTIPLE_PX: '16',
    IMAGE_MAX_ASPECT_RATIO: '3',
  });
  const runtime = new WorkbenchRuntime(process.cwd());
  assert.deepEqual(runtime.imageSizeOptions().map(({ id, size }) => ({ id, size })), [
    { id: 'auto', size: 'auto' },
    { id: '2k_square', size: '2048x2048' },
    { id: '4k_landscape', size: '3840x2160' },
  ]);
  assert.equal(runtime.sizeFor('1:1', '4k_landscape'), '3840x2160');
  process.env = saved;
});

test('generation task records result metadata from its effective settings', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    OPENAI_IMAGE_MODEL: 'gpt-image-2-c',
    OPENAI_IMAGE_SIZE_2K_LANDSCAPE: '2048x1152',
  });
  const runtime = new WorkbenchRuntime(process.cwd());
  runtime.generationQueue = { add: (job) => job() };
  runtime.persistTask = async () => {};
  runtime.generateImage = async () => ({ assetId: 'result', url: '/api/assets/result', mimeType: 'image/png' });
  const task = await runtime.createGeneration({ provider: 'image2', prompt: 'test', settings: { resolution: '2k_landscape' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const finished = runtime.tasks.get(task.taskId);
  assert.equal(finished.resolution, '2048x1152');
  assert.equal(finished.imageRatio, '16:9');
  assert.equal(finished.model, 'gpt-image-2-c');
  assert.ok(finished.durationMs >= 0);
  process.env = saved;
});

test('a 2K image2 request preserves the requested business ratio', () => {
  const saved = { ...process.env };
  Object.assign(process.env, { OPENAI_IMAGE_SIZE_2K_LANDSCAPE: '2048x1152', OPENAI_IMAGE_SIZE_2K_SQUARE: '2048x2048' });
  const runtime = new WorkbenchRuntime(process.cwd());
  assert.equal(runtime.gptSizeFor({ aspectRatio: '4:3', resolutionTier: '2K' }), '2048x1536');
  assert.equal(runtime.gptSizeFor({ aspectRatio: '3:4', resolutionTier: '2K' }), '1536x2048');
  process.env = saved;
});

test('image2 maps 2K portrait business ratio to a 3:4 provider size', () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    OPENAI_IMAGE_SIZE_2K_SQUARE: '2048x2048',
    OPENAI_IMAGE_SIZE_2K_LANDSCAPE: '2048x1152',
    IMAGE_MAX_EDGE_PX: '3840',
    IMAGE_SIZE_MULTIPLE_PX: '16',
    IMAGE_MAX_ASPECT_RATIO: '3',
  });
  const runtime = new WorkbenchRuntime(process.cwd());
  assert.equal(runtime.gptSizeFor({ aspectRatio: '3:4', resolutionTier: '2K' }), '1536x2048');
  process.env = saved;
});

test('generation task preserves the submitted reference image order', async () => {
  const runtime = new WorkbenchRuntime(process.cwd());
  runtime.generationQueue = { add: (job) => job() };
  runtime.persistTask = async () => {};
  runtime.generateImage = async () => ({ assetId: 'result', url: '/api/assets/result', mimeType: 'image/png' });
  const task = await runtime.createGeneration({
    provider: 'image2',
    prompt: 'test',
    referenceAssetIds: ['asset_b', 'asset_a', 'asset_c'],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(runtime.tasks.get(task.taskId).referenceAssetIds, ['asset_b', 'asset_a', 'asset_c']);
});

test('reference image selects the nearest configured size only when resolution is auto', async () => {
  const saved = { ...process.env };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workbench-image-'));
  const imagePath = path.join(dir, 'reference.png');
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(1600, 16); png.writeUInt32BE(1000, 20); await fs.writeFile(imagePath, png);
  Object.assign(process.env, { OPENAI_IMAGE_SIZE_AUTO: 'auto', OPENAI_IMAGE_SIZE_1K_LANDSCAPE: '1536x1024', OPENAI_IMAGE_SIZE_2K_LANDSCAPE: '2048x1152', OPENAI_IMAGE_SIZE_2K_SQUARE: '2048x2048' });
  const runtime = new WorkbenchRuntime(process.cwd());
  runtime.generationQueue = { add: (job) => job() }; runtime.persistTask = async () => {}; runtime.generateImage = async () => ({ assetId: 'result', url: '/api/assets/result', mimeType: 'image/png' }); runtime.asset = async () => ({ localPath: imagePath, mimeType: 'image/png' });
  const automatic = await runtime.createGeneration({ provider: 'image2', prompt: 'test', referenceAssetIds: ['asset_1'], settings: { resolution: 'auto' } });
  const explicit = await runtime.createGeneration({ provider: 'image2', prompt: 'test', referenceAssetIds: ['asset_1'], settings: { resolution: '2k_square' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.tasks.get(automatic.taskId).settings.resolution, '1k_landscape');
  assert.equal(runtime.tasks.get(automatic.taskId).resolution, '1536x1024');
  assert.equal(runtime.tasks.get(explicit.taskId).settings.resolution, '2k_square');
  assert.equal(runtime.tasks.get(explicit.taskId).resolution, '2048x2048');
  process.env = saved; await fs.rm(dir, { recursive: true, force: true });
});

test('Google provider parses a Markdown-wrapped image data URL', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workbench-google-'));
  const output = path.join(dir, 'result.png');
  const runtime = new WorkbenchRuntime(process.cwd());
  await runtime.writeNanoBananaImage({ choices: [{ message: { content: '![image](data:image/png;base64,aGVsbG8=)' } }] }, output);
  assert.equal((await fs.readFile(output)).toString(), 'hello');
  await fs.rm(dir, { recursive: true, force: true });
});

test('providers map a business aspect ratio and resolution tier independently', async () => {
  const saved = { ...process.env };
  const savedFetch = globalThis.fetch;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workbench-provider-size-'));
  const output = path.join(dir, 'result.png');
  try {
    Object.assign(process.env, {
      OPENLUX_BASE_URL: 'https://api.openlux.ai/v1',
      OPENLUX_IMAGE_MODEL: 'gemini-3-pro-image',
      OPENAI_IMAGE_SIZE_1K_LANDSCAPE: '1536x1024',
      OPENAI_IMAGE_SIZE_2K_LANDSCAPE: '2048x1152',
      OPENAI_IMAGE_SIZE_4K_LANDSCAPE: '3840x2160',
    });
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const referencePath = path.join(dir, 'reference.png');
    await fs.writeFile(referencePath, Buffer.from('reference-image'));
    const runtime = new WorkbenchRuntime(process.cwd());
    runtime.asset = async () => ({ localPath: referencePath, mimeType: 'image/png' });
    assert.equal(runtime.gptSizeFor({ aspectRatio: '16:9', resolutionTier: '4K' }), '3840x2160');
    await runtime.generateWithNanoBanana({ prompt: 'test', referenceAssetIds: ['asset_primary', 'asset_secondary'], settings: { aspectRatio: '16:9', resolutionTier: '2K' } }, 'result', output);
    assert.equal(request.url, 'https://api.openlux.ai/v1beta/models/gemini-3-pro-image:generateContent');
    assert.deepEqual(request.body.generationConfig.imageConfig, { aspectRatio: '16:9', imageSize: '2K' });
    assert.deepEqual(request.body.contents[0].parts, [{ text: 'test' }, { inlineData: { mimeType: 'image/png', data: Buffer.from('reference-image').toString('base64') } }, { inlineData: { mimeType: 'image/png', data: Buffer.from('reference-image').toString('base64') } }]);
    assert.equal((await fs.readFile(output)).toString(), 'hello');
  } finally {
    globalThis.fetch = savedFetch;
    process.env = saved;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
