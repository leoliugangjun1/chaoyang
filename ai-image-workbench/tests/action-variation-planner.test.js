import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_CANDIDATE_COUNT, planActionVariation } from '../server/action-variation-planner.js';

test('planner sends the source image and produces one validated plan per template', async () => {
  let messages;
  let options;
  const plan = await planActionVariation({
    client: { createCompletionStream: async (value, requestOptions) => { messages = value; options = requestOptions; return { output_text: JSON.stringify({ subjectProfile: 'red jacket, short hair', actionPlans: Array.from({ length: ACTION_CANDIDATE_COUNT }, (_, index) => ({ templateId: 'one', name: `Action ${index + 1}`, actionGuidance: `single pose ${index + 1}, full body` })) }) }; } },
    imageUrl: 'https://host.test/source.png',
    templates: [{ id: 'one', name: 'One', prompt: 'twelve distinct pose rules' }],
    extraPrompt: 'keep the product visible',
  });
  assert.equal(messages[1].content[1].image_url.url, 'https://host.test/source.png');
  assert.match(messages[0].content, /exactly 12 actionPlans/);
  assert.equal(plan.actionPlans.length, ACTION_CANDIDATE_COUNT);
  assert.deepEqual(new Set(plan.actionPlans.map((item) => item.templateId)), new Set(['one']));
  assert.equal(plan.subjectProfile, 'red jacket, short hair');
  assert.match(plan.actionPlans[0].generationPrompt, /red jacket, short hair/);
  assert.match(plan.actionPlans[0].generationPrompt, /single pose 1, full body/);
});

test('planner rejects a plan that does not cover the selected templates', async () => {
  await assert.rejects(() => planActionVariation({
    client: { createCompletionStream: async () => ({ output_text: '{"subjectProfile":"subject","actionPlans":[]}' }) },
    imageUrl: 'https://host.test/source.png',
    templates: [{ id: 'one', name: 'One', prompt: 'rule' }],
  }), { code: 'ACTION_PLAN_INVALID' });
});

test('planner rejects one action plan that requests a twelve-frame composition', async () => {
  await assert.rejects(() => planActionVariation({
    client: { createCompletionStream: async () => ({ output_text: JSON.stringify({ subjectProfile: 'subject', actionPlans: Array.from({ length: ACTION_CANDIDATE_COUNT }, () => ({ templateId: 'one', name: 'Series', actionGuidance: 'Create a cohesive 12-frame studio series.' })) }) }) },
    imageUrl: 'https://host.test/source.png',
    templates: [{ id: 'one', name: 'One', prompt: 'rule' }],
  }), { code: 'ACTION_PLAN_INVALID' });
});
