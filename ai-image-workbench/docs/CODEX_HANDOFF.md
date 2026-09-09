# AI Image Workbench Handoff

## Snapshot

Date: 2026-09-09

Repository branch: `feature/action-variation`

This is one local AI image-generation application with a shared browser shell and navigation. Basic image generation is the protected baseline. Virtual model composition and Action variation are independent business pages that reuse shared server capabilities.

## Current Modules

| Module | Browser entry | Business owner | Status |
| --- | --- | --- | --- |
| Basic image generation | `public/index.html`, `public/app.js` | Basic generation prompt, upload, settings, task display | Complete and protected |
| Virtual model composition | `public/virtual-model.html`, `public/virtual-model.js` | Composition inputs, prompts, two-provider round state | Active independent module |
| Action variation | `public/action-variation.html`, `public/action-variation.js` | Template selection, action planning, 12-plan batch rendering, per-Job retry | Active independent module |

## Action Variation State

Action variation uses selected templates and a source image to request exactly 12 distinct, single-pose plans from the LLM. Each plan creates one task for each enabled provider. With both providers enabled, a batch has 24 independent Jobs.

Current LLM visual-input path:

```text
Local reference image
-> server/image-data-url.js
-> data:<mime>;base64,...
-> Chat Completions messages: text + image_url
-> streamed LLM action plan
-> validated 12 action plans
-> one image task per plan and provider
```

Action variation no longer depends on Uguu or another external image host to enter LLM planning. `server/temporary-image-host.js` remains in the repository for other potential consumers and is not part of this path.

Action-planning logs use these phases without storing the Base64 payload:

1. `action-variation.reference-image-loaded`
2. `action-variation.reference-image-encoded`
3. `action-variation.llm-vision-planning-started`
4. `action-variation.llm-vision-planning-response-received`
5. `action-variation.action-plan-parsed`
6. `action-variation.generated-actions-count`

When the vision LLM returns HTTP 429, the action batch records `LLM upstream overloaded` rather than an image-host error.

## Provider Status

- GPT/Image2 implementation: `server/runtime.js`, `generateWithImage2`.
- Google/Nano Banana implementation: `server/runtime.js`, `generateWithNanoBanana`.
- OpenAI-compatible LLM implementation: `server/llm-client.js`.
- Action planner: `server/action-variation-planner.js`.

Verified probes in the current phase:

- LLM text-only Chat Completions request returned the expected response.
- LLM vision Chat Completions request accepted a synthetic Base64 image Data URL and returned HTTP 200.
- GPT Image 2.5 Sunburst minimal generation probe returned HTTP 200 with an image result when directly using the supplied configuration block.
- A public HTTPS image vision probe previously returned an upstream-saturated HTTP 429. Treat this as provider capacity, not a Base64 formatting failure.

## LAN Runtime

The workbench service is configured to run through the Windows scheduled task `AI Image Workbench LAN` on `192.168.66.140:8081`. Xiaopi Nginx exposes the LAN proxy entry at `http://192.168.66.140:8082/`.

`启动局域网服务.cmd` starts or verifies the scheduled task and Xiaopi proxy, then checks the two health endpoints. It does not edit project configuration.

## Current Tests

The current stable worktree passed:

```text
npm.cmd test          30 passing
npm.cmd run typecheck passed
npm.cmd run build     passed
```

Relevant regression coverage:

- `tests/action-variation-batch.test.js`: Base64 Data URL reaches the planner, six planning stages are logged, 12 plans and 24 provider tasks remain intact, and single-Job retry remains scoped.
- `tests/action-variation-planner.test.js`: planner accepts HTTPS and image Data URL inputs, validates plan count and source-template references.
- `tests/image-data-url.test.js`: local image Data URL encoding and clear read failure behavior.

## Git Handoff

Before staging, inspect `git status --short --branch`. The parent repository contains unrelated dirty files and untracked projects. Stage only `ai-image-workbench` files that belong to the requested work.

The Basic image generation baseline remains protected. Do not modify `public/app.js`, Basic image-generation browser behavior, or its tests without explicit scope.

## Next Work

1. Run an approved live Action variation planning request after confirming provider capacity. Check the six action-planning log phases and confirm 12 plans are parsed.
2. If a live vision request returns `LLM upstream overloaded`, treat it as an upstream capacity issue and retry later; do not reintroduce Uguu as a workaround.
3. Keep further Action variation work scoped to its page, planner, and batch runtime path.
