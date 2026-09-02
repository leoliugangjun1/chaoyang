# AI Image Workbench Handoff

## Current Continuation: Model Action Variation (2026-08-27)

This section supersedes earlier statements in this document that describe Action variation as future work.

### Delivered Scope

- The sidebar item in the "生图工作台" area is named "模特动作裂变" and opens `/action-variation.html`.
- The page creates 12 fixed action candidates for each of two providers. A normal submission creates 24 independent image-generation tasks: 12 `image2` tasks and 12 `nano_banana` tasks.
- Each task has one action and `outputCount: 1`. Do not merge actions or ask an image provider for a grid, collage, contact sheet, multiple poses, or multiple images in one prompt.
- The action result state is held in `Map<jobId, Job>` in the browser. Each Job independently has `pending`, `loading`, `success`, or `error` status, its result URL, and its error value.
- A failed card retries only its own `jobId`. The retry API creates exactly one new one-image task for the same provider and action; it must never regenerate the other 23 jobs.
- The result area has a `生成中 x/24` progress bar and two views: "按 Provider 分组" and "按动作对比". The comparison view renders 12 rows, each with Provider A and Provider B results side by side.
- Image previews use `object-fit: contain` and are not cropped.

### Key Files

- `public/action-variation.html`: standalone page entry.
- `public/action-variation.js`: page state, polling, Job rendering, view switching, and `retrySingleJob(jobId)`.
- `public/action-variation.css` and `public/action-variation-results.css`: page and result-area styles.
- `server/action-candidates.js`: 12 fixed `ACTION_CANDIDATES` and `createGenerationJobs(userImage, providers)`.
- `server/runtime.js`: `createActionVariationBatch`, Job-to-task submission, batch hydration, and `retryActionVariationJob`.
- `server/index.js`: action-variation batch and per-Job retry routes.
- `tests/action-candidates.test.js`, `tests/action-variation-batch.test.js`, and `tests/action-variation-static.test.js`: regression coverage.

### API Contract

```text
POST /api/action-variation/batches
GET  /api/action-variation/batches/:batchId
POST /api/action-variation/jobs/:jobId/retry
```

The batch response exposes `jobs`, where each Job includes `jobId`, `provider`, `actionId`, `actionName`, `fullPrompt`, `status`, `result`, and `error`.

### Non-Negotiable Rules

1. The target is 12 actions x 2 providers = 24 independent Jobs and 24 initial provider requests.
2. Every image prompt describes exactly one action in one image. The prompt factory rejects known multi-action, multi-image, grid, collage, contact-sheet, and Chinese "宫格" instructions in supplemental text.
3. Keep image-provider credentials separate from LLM credentials. Do not edit `.env` files or print credential values.
4. Do not modify Basic image generation unless a task explicitly scopes it.
5. Preserve unrelated dirty worktree changes and local `data/` runtime files.

### Verification Completed

```powershell
npm.cmd test
npm.cmd run typecheck
```

The latest verification passed 26 Node tests and type checking. The action-variation batch test asserts 12 calls to `generateWithImage2` and 12 calls to `generateWithNanoBanana`; after retrying one `image2` Job, the counts become 13 and 12 respectively.

### Current Local State

- A fresh server for this work was started at `http://127.0.0.1:4193`. Do not assume it remains running next week. The default port `4189` was already in use by another local process.
- The worktree is dirty. The Action variation files are partly untracked, so inspect `git status --short` before staging or committing.
- No live paid provider request was made during this feature verification. Request-count assertions use mocked provider methods.

### Recommended Next Work

1. Perform an approved live end-to-end batch only when provider credentials and spending authorization are available; confirm 24 initial image-provider requests in browser/network and server logs.
2. Decide whether the legacy editable action-template controls should be removed or re-scoped. The current backend always uses the fixed 12 standard actions, while the page still requires a template selection before submission for compatibility.
3. Clean up legacy, now-unused action-result helper functions in `public/action-variation.js` only as a scoped refactor with regression coverage. Do not alter the 24-Job behavior.

## Completed Stage

The completed baseline includes **Basic image generation** and **Virtual model composition**. Basic image generation remains the protected Stable Baseline; virtual model composition is an independent business page inside the same application.

## Application Shape

This is one application with one browser shell and left navigation. The business modules are Basic image generation, Virtual model composition, Action variation, and Generation history. Basic image generation and Virtual model composition currently have working browser pages. Action variation and a standalone Generation history page remain future work.

## Current Main Page and Components

- The main page is served from `public/index.html` and rendered by `public/app.js`.
- Basic image generation supports prompt entry, up to seven reference-image uploads with drag reordering, provider selection, output count `1/2/4/10`, Quality, Background, and a visual `AspectRatioSelector`.
- `AspectRatioSelector` offers `auto`, `1:1`, `4:3`, `3:4`, `3:2`, `2:3`, `16:9`, and `9:16`.
- Resolution is a business tier: `1K`, `2K`, or `4K`. It is not a promise of identical native output pixels across providers.
- The result panel presents task status, generated assets, preview, download, retry, history, and task metadata.

## Generation Call Chain

```text
Basic image generation UI
-> settings { mode, aspectRatio, resolutionTier, quality, background }
-> POST /api/generate
-> WorkbenchRuntime.createGeneration
-> generation queue
-> provider adapter in server/runtime.js
-> local data/results asset and task history
-> browser polling and result display
```

Reference-image order is the current `state.files` order. The same order is submitted as `referenceAssetIds` and recorded on the task.

## Provider Status

### Google / Nano Banana

- Provider code: `server/runtime.js`, `generateWithNanoBanana`.
- Request endpoint: derived from `OPENLUX_BASE_URL` as `/v1beta/models/<OPENLUX_IMAGE_MODEL>:generateContent`.
- Request configuration: Gemini `generationConfig.imageConfig`, using business `aspectRatio` and `resolutionTier` as `aspectRatio` and `imageSize`.
- Response parser: reads Gemini `candidates[].content.parts[].inlineData.data`, while retaining compatibility with Markdown-wrapped image data URLs.
- Verified: a real Google text-to-image request completed with `aspectRatio: 16:9` and `imageSize: 1K`.

### GPT / Image2

- Provider code: `server/runtime.js`, `generateWithImage2`.
- Text-to-image uses the configured OpenAI-compatible `/images/generations` JSON endpoint.
- Image-to-image uses the configured `/images/edits` multipart endpoint and preserves reference image order.
- The provider maps business `aspectRatio` and `resolutionTier` to the closest configured legal `size` from `OPENAI_IMAGE_SIZE_*`.
- Verified request construction: `16:9 + 2K` produced `size: 2048x1152`. The most recent real GPT provider call timed out after 180 seconds; this was a provider timeout after correct request construction.

## Environment Contract

All configuration is server-side. Never record a real key in this document.

- Google/OpenLux: `OPENLUX_API_KEY`, `OPENLUX_BASE_URL`, `OPENLUX_IMAGE_MODEL`.
- GPT/Image2: `OPENAI_API_KEY`, `LLM_BASE_URL`, `OPENAI_IMAGE_MODEL`, optional `OPENAI_IMAGE_GENERATION_URL`, and optional `OPENAI_IMAGE_EDIT_URL`.
- Runtime: `MAX_CONCURRENCY`, `GENERATION_CONCURRENCY`, `PROVIDER_TIMEOUT_MS`, `HOST`, `PORT`, and `DEFAULT_IMAGE_PROVIDER`.
- GPT size allowlist and validation: `OPENAI_IMAGE_SIZE_*`, `IMAGE_MAX_EDGE_PX`, `IMAGE_SIZE_MULTIPLE_PX`, and `IMAGE_MAX_ASPECT_RATIO`.
- Compatibility fallbacks: `GOOGLE_API_KEY` and `GOOGLE_IMAGE_MODEL`.

The user alone edits `.env` files. Agents provide proposed values and execution guidance only.

## Key Directories

- `public/`: browser shell and Basic image generation UI.
- `server/`: HTTP API, runtime, queue, provider adapters, and plugin manager.
- `src/shared/`: platform protocol and errors.
- `modules/`: declarative versioned modules.
- `tests/`: Node regression suite.
- `scripts/`: build and validation commands.
- `data/`: ignored local runtime state, assets, history, templates, and logs.
- `docs/`: architecture and handoff material.

## Verification Snapshot

The current baseline passed:

```text
npm.cmd test            12 passing tests
npm.cmd run typecheck   passed
npm.cmd run build       passed
```

Browser verification confirmed that all eight ratio options render and are selectable, and that selecting `16:9` stores the business value `aspectRatio: "16:9"` before generation.

## Known Issues

1. The virtual model page stores its browser workspace snapshot and selected-result state in `localStorage`; task and asset records remain server-side.
2. A virtual model generation round is represented in the browser as two provider tasks. The server does not currently expose a native parent-round entity.
3. The main page navigation still has placeholder entries for Action variation and Generation history. Virtual model navigation is available through its page entry, while the main-shell navigation integration should be handled as a separate scoped task.
4. The most recent GPT text-to-image validation request reached the configured provider timeout after sending the correct mapped request. The task records the provider timeout.

## Basic Image Generation Protection

Do not modify the Basic image generation UI, prompt and upload flow, reference-image ordering, output count, queue, result display, download flow, provider mappings, or related tests unless a task explicitly scopes Basic image generation.

## Next Stage: Virtual Model Composition

Virtual model composition is a new business module inside this application, not a second independent application. It must appear in the existing left navigation alongside Basic image generation, Action variation, and Generation history.

It may reuse the existing provider adapters, API client, asset upload API, task persistence, history, and application shell. Its business rules, inputs, task construction, and module workflow must remain independent from Basic image generation.
