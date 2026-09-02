import crypto from 'node:crypto';

export const ACTION_CANDIDATES = [
  { id: 'action-01', name: '正面自然站立', promptSuffix: 'Front-facing natural standing pose, arms relaxed at both sides, full-body product display.' },
  { id: 'action-02', name: '正面单手叉腰', promptSuffix: 'Front-facing standing pose with one hand on the hip and the other arm relaxed, confident posture.' },
  { id: 'action-03', name: '侧面曲线展示', promptSuffix: 'Side-view standing pose at a clean profile angle, body upright, arms relaxed, emphasizing the silhouette.' },
  { id: 'action-04', name: '侧面双手上举', promptSuffix: 'Side-view standing pose with both arms raised elegantly, elongated torso and stable full-body framing.' },
  { id: 'action-05', name: '背面自然站立', promptSuffix: 'Back-view standing pose, arms relaxed naturally, clean full-body composition showing the rear silhouette.' },
  { id: 'action-06', name: '背面回眸', promptSuffix: 'Back-view standing pose with the head turned gently toward the camera, one calm over-shoulder look.' },
  { id: 'action-07', name: '四分之三双手叉腰', promptSuffix: 'Three-quarter standing angle with both hands on hips, stable confident posture and centered composition.' },
  { id: 'action-08', name: '正面双手置于头后', promptSuffix: 'Front-facing pose with both hands placed behind the head, shoulders open, torso naturally extended.' },
  { id: 'action-09', name: '轻微转身动态', promptSuffix: 'Single graceful turning pose, body slightly rotated as if caught mid-turn, natural movement in one still image.' },
  { id: 'action-10', name: '侧面单手叉腰', promptSuffix: 'Side-view standing pose with one hand on the hip and the other arm relaxed, clean profile composition.' },
  { id: 'action-11', name: '正面双手轻扶大腿', promptSuffix: 'Front-facing pose with both hands lightly resting on the thighs, slight forward lean, balanced full-body framing.' },
  { id: 'action-12', name: '四分之三背面曲线', promptSuffix: 'Three-quarter back-view pose, one hand near the waist or hip, head slightly turned, single elegant stance.' },
];

const providerLabel = (provider) => provider === 'nano_banana' ? 'Google' : provider;

function userImagePrompt(userImage) {
  const extraPrompt = typeof userImage === 'string' ? userImage : userImage?.extraPrompt || userImage?.requirements || '';
  if (/\b\d+\s*(?:actions?|poses?|images?|frames?)\b|multiple\s+(?:actions?|poses?|images?|frames?)|grid|collage|contact sheet|\d+\s*个动作|多个动作|多动作|[一二三四五六七八九十12]+宫格/i.test(extraPrompt)) throw new Error('Action variation prompts must describe one action only.');
  return [
    'Generate one image from the uploaded reference image.',
    'Preserve the same person identity, face, hairstyle, body proportions, clothing details, and visual quality from the reference image.',
    'Create exactly one pose in this output image. Only one continuous single-subject stance should be visible.',
    extraPrompt.trim() ? `Additional user requirements: ${extraPrompt.trim()}` : '',
  ].filter(Boolean).join('\n\n');
}

export function createGenerationJobs(userImage, providers = []) {
  const uniqueProviders = [...new Set(providers)].filter(Boolean);
  const basePrompt = userImagePrompt(userImage);
  return ACTION_CANDIDATES.flatMap((action) => uniqueProviders.map((provider) => ({
    jobId: `${provider}-${action.id}-${crypto.randomUUID()}`,
    provider,
    providerName: providerLabel(provider),
    actionId: action.id,
    actionName: action.name,
    fullPrompt: `${basePrompt}\n\nAction: ${action.promptSuffix}`,
    status: 'pending',
    result: null,
    error: null,
  })));
}
