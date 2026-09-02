import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchRuntime } from '../server/runtime.js';

test('action variation batch creates one independent image task for every plan and provider', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'action-batch-'));
  const originalImage2Key = process.env.OPENAI_API_KEY;
  const originalGoogleKey = process.env.OPENLUX_API_KEY;
  process.env.OPENAI_API_KEY = 'test-image2-key';
  process.env.OPENLUX_API_KEY = 'test-google-key';
  const runtime = new WorkbenchRuntime(root);
  await runtime.initialize();
  const providerCalls = { image2: 0, nano_banana: 0 };
  runtime.generateWithImage2 = async () => ({ assetId: `image2-${++providerCalls.image2}`, url: `/api/assets/image2-${providerCalls.image2}`, mimeType: 'image/png' });
  runtime.generateWithNanoBanana = async () => ({ assetId: `google-${++providerCalls.nano_banana}`, url: `/api/assets/google-${providerCalls.nano_banana}`, mimeType: 'image/png' });

  try {
    const source = await runtime.createUpload({ name: 'subject.png', mimeType: 'image/png', data: 'data:image/png;base64,aW1hZ2U=' });
    const batch = await runtime.createActionVariationBatch({
      sourceAssetId: source.assetId,
      providers: ['image2', 'nano_banana'],
      settings: { aspectRatio: '3:4', resolutionTier: '2K' },
      extraPrompt: 'pure white background',
    });

    assert.equal(batch.outputCount, 1);
    assert.equal(batch.actionPlans.length, 12);
    assert.equal(batch.jobs.length, 24);
    assert.equal(batch.jobs.filter((job) => job.provider === 'image2').length, 12);
    assert.equal(batch.jobs.filter((job) => job.provider === 'nano_banana').length, 12);
    assert.equal(batch.actionPlans.flatMap((plan) => Object.values(plan.providerTasks)).length, 24);
    assert.equal(Object.keys(batch.actionPlans[0].providerTasks).length, 2);
    assert.equal(batch.actionPlans[0].providerTasks.image2.resolution, '1536x2048');
    assert.equal(batch.actionPlans[0].providerTasks.image2.imageRatio, '3:4');
    assert.equal(batch.actionPlans[0].providerTasks.nano_banana.resolution, '2K');
    assert.equal(batch.actionPlans[0].providerTasks.nano_banana.imageRatio, '3:4');
    for (const plan of batch.actionPlans) for (const task of Object.values(plan.providerTasks)) {
      assert.equal(task.outputCount, 1);
      assert.equal(task.images.length, 1);
      assert.equal(task.actionBatchId, batch.batchId);
      assert.equal(task.actionPlanId, plan.actionPlanId);
      assert.equal(task.prompt, plan.generationPrompt);
      assert.match(task.prompt, /Create exactly one pose/);
      assert.doesNotMatch(task.prompt, /contact sheet|collage|\bgrid\b/i);
    }

    await waitForTasks(runtime, Object.values(batch.actionPlans[0].providerTasks).length ? batch.batchId : null);
    assert.equal(providerCalls.image2, 12);
    assert.equal(providerCalls.nano_banana, 12);

    const image2Job = runtime.actionVariationBatch(batch.batchId).jobs.find((job) => job.provider === 'image2');
    const retriedBatch = await runtime.retryActionVariationJob(image2Job.jobId);
    const retriedJob = retriedBatch.jobs.find((job) => job.jobId === image2Job.jobId);
    await waitForTask(runtime, retriedJob.taskId);
    assert.equal(providerCalls.image2, 13);
    assert.equal(providerCalls.nano_banana, 12);
  } finally {
    if (originalImage2Key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalImage2Key;
    if (originalGoogleKey === undefined) delete process.env.OPENLUX_API_KEY; else process.env.OPENLUX_API_KEY = originalGoogleKey;
  }
});

async function waitForTasks(runtime, actionBatchId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const tasks = [...runtime.tasks.values()].filter((task) => !actionBatchId || task.actionBatchId === actionBatchId);
    if (tasks.length === 24 && tasks.every((task) => ['completed', 'partial', 'failed'].includes(task.status))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for action variation tasks.');
}

async function waitForTask(runtime, taskId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = runtime.tasks.get(taskId);
    if (task && ['completed', 'partial', 'failed'].includes(task.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for task ${taskId}.`);
}
