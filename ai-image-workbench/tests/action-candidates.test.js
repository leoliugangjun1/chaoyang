import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_CANDIDATES, createGenerationJobs } from '../server/action-candidates.js';

test('standard action candidates define twelve independent single-action prompts', () => {
  assert.equal(ACTION_CANDIDATES.length, 12);
  assert.deepEqual(ACTION_CANDIDATES.map((action) => action.id), Array.from({ length: 12 }, (_, index) => `action-${String(index + 1).padStart(2, '0')}`));
  for (const action of ACTION_CANDIDATES) {
    assert.equal(typeof action.name, 'string');
    assert.equal(typeof action.promptSuffix, 'string');
    assert.doesNotMatch(action.promptSuffix, /12|grid|collage|contact sheet|multiple frames/i);
  }
});

test('generation job factory creates one job per action and provider', () => {
  const jobs = createGenerationJobs({ extraPrompt: 'pure white background' }, ['image2', 'nano_banana']);
  assert.equal(jobs.length, 24);
  assert.equal(new Set(jobs.map((job) => job.jobId)).size, 24);
  assert.equal(jobs.filter((job) => job.provider === 'image2').length, 12);
  assert.equal(jobs.filter((job) => job.provider === 'nano_banana').length, 12);
  for (const job of jobs) {
    assert.match(job.actionId, /^action-\d{2}$/);
    assert.equal(job.status, 'pending');
    assert.equal(job.result, null);
    assert.equal(job.error, null);
    assert.match(job.fullPrompt, /Create exactly one pose/);
    assert.doesNotMatch(job.fullPrompt, /12-grid|contact sheet|collage/i);
  }
});

test('generation job factory rejects a user instruction that requests multiple actions', () => {
  assert.throws(() => createGenerationJobs({ extraPrompt: 'Generate 12 actions in a grid.' }, ['image2', 'nano_banana']), /one action only/);
});
