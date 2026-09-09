import { PlatformError } from '../src/shared/protocol.js';

const planError = (message) => new PlatformError('ACTION_PLAN_INVALID', message);
export const ACTION_CANDIDATE_COUNT = 12;

const responseText = (data) => {
  const content = data?.output_text || data?.choices?.[0]?.message?.content || data?.output?.flatMap((item) => item?.content || []).map((part) => part?.text || '').join('');
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('');
  return '';
};

const parsePlan = (text) => {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(candidate); } catch { throw planError('LLM did not return valid JSON action plans.'); }
};

export const generationPromptFor = ({ subjectProfile, actionGuidance, userRules = '' }) => [
  'Subject consistency profile:', subjectProfile,
  'Action guidance:', actionGuidance,
  userRules.trim() ? `Additional user rules: ${userRules.trim()}` : '',
  'Generate a new image from the reference image. Preserve the subject identity, face, hairstyle, body proportions, clothing, and visual quality. Apply the action guidance exactly.',
].filter(Boolean).join('\n\n');

export async function planActionVariation({ client, imageUrl, templates, extraPrompt = '' }) {
  if (!/^https:\/\//i.test(imageUrl || '') && !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(imageUrl || '')) throw planError('A HTTPS or image Data URL source is required for action planning.');
  if (!Array.isArray(templates) || !templates.length) throw planError('At least one action template is required.');
  const templateRules = templates.map(({ id, name, prompt }) => ({ templateId: id, name, rule: prompt }));
  let data;
  try { data = await client.createCompletionStream([
    { role: 'system', content: `You are an image-action planner. Inspect the supplied subject image, first extract a concise subjectProfile that captures identity, face, hairstyle, body proportions, clothing, visual style, and consistency constraints. Then turn the selected template rules into exactly ${ACTION_CANDIDATE_COUNT} distinct action candidates. Return JSON only: {"subjectProfile":"...","actionPlans":[{"templateId":"...","name":"...","actionGuidance":"..."}]}. Return exactly ${ACTION_CANDIDATE_COUNT} actionPlans, even when one template contains all action rules. Every templateId must refer to a selected templateId; a templateId may appear in more than one actionPlan. Each actionGuidance must describe exactly one pose for one output image. Never combine multiple poses, a pose sequence, a collage, a contact sheet, a grid, or multiple people. Do not describe an action list, a numbered series, or multiple frames. Each actionGuidance must contain only the new pose, limb relationships, framing, camera and composition directions; do not restate subject identity or clothing.` },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ templateRules, additionalRules: extraPrompt }) }, { type: 'image_url', image_url: { url: imageUrl } }] },
  ], { signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || 180000)) }); } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw planError('LLM action planning timed out.');
    throw error;
  }
  const parsed = parsePlan(responseText(data));
  const plans = parsed?.actionPlans;
  if (!Array.isArray(plans) || plans.length !== ACTION_CANDIDATE_COUNT) throw planError(`LLM must return exactly ${ACTION_CANDIDATE_COUNT} action plans.`);
  const expectedIds = new Set(templates.map((template) => template.id));
  if (plans.some((plan) => !expectedIds.has(plan?.templateId))) throw planError('LLM action plans reference an unavailable template.');
  const subjectProfile = typeof parsed.subjectProfile === 'string' ? parsed.subjectProfile.trim() : '';
  if (!subjectProfile) throw planError('LLM returned an empty subject profile.');
  if (plans.some((plan) => typeof plan.actionGuidance !== 'string' || !plan.actionGuidance.trim())) throw planError('LLM returned empty action guidance.');
  if (plans.some((plan) => /\b\d+[-\s]*(?:frame|pose|action)s?\b|contact sheet|collage|\bgrid\b|\u5bab\u683c|\u8fde\u62cd/i.test(plan.actionGuidance))) throw planError('An action plan combines multiple poses.');
  return { subjectProfile, actionPlans: plans.map((plan) => {
    const actionGuidance = plan.actionGuidance.trim();
    return { templateId: plan.templateId, name: typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : templates.find((template) => template.id === plan.templateId).name, actionGuidance, generationPrompt: generationPromptFor({ subjectProfile, actionGuidance, userRules: extraPrompt }) };
  }) };
}
