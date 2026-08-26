import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationTaskQueue } from '../server/generation-queue.js';

test('queue schedules ten jobs concurrently', async () => {
  const queue = new GenerationTaskQueue({ concurrency: 10 });
  let active = 0;
  let peak = 0;
  const jobs = Array.from({ length: 10 }, () => queue.add(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  }));

  await Promise.all(jobs);
  assert.equal(peak, 10);
});
