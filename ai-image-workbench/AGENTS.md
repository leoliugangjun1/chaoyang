# AI Image Workbench

## Product Scope

This repository is one local AI image-generation application. It has one browser shell and one left navigation. Business modules share the shell, HTTP API, asset storage, task queue, provider adapters, result assets, and history, while each module owns its own inputs, prompts, orchestration, and UI state.

Current modules:

- Basic image generation
- Virtual model composition
- Action variation
- Generation history entry in the shared navigation

## Directory Map

- `public/`: browser application shell and module pages.
  - Basic image generation: `index.html`, `app.js`, `styles.css`.
  - Virtual model composition: `virtual-model.html`, `virtual-model.js`, `virtual-model.css`.
  - Action variation: `action-variation.html`, `action-variation.js`, `action-variation.css`, `action-variation-results.css`.
- `server/`: HTTP API, runtime state, queue, provider adapters, LLM client, action planner, and local asset handling.
  - Routes: `server/index.js`.
  - Shared runtime and image providers: `server/runtime.js`.
  - GPT/Image2 adapter: `WorkbenchRuntime.generateWithImage2` in `server/runtime.js`.
  - Google/Nano Banana adapter: `WorkbenchRuntime.generateWithNanoBanana` in `server/runtime.js`.
  - OpenAI-compatible LLM client: `server/llm-client.js`.
  - Action planning: `server/action-variation-planner.js`.
  - Action-variation reference-image Data URL encoder: `server/image-data-url.js`.
- `src/shared/`: protocol types, platform errors, and capability definitions.
- `modules/`: declarative module-contract placeholders. Browser behavior remains in `public/` until a versioned declarative workflow is introduced.
- `tests/`: Node regression tests.
- `scripts/`: build and module/plugin validation scripts.
- `data/`: ignored local runtime state: uploads, assets, results, task history, action batches, templates, registry, and logs.
- `docs/`: architecture and handoff documents.

## Module Boundaries

### Basic Image Generation

Basic image generation is complete and protected. Its business behavior is owned by `public/app.js` and its main-page styling. It uses shared runtime services in `server/runtime.js`.

Do not change its UI behavior, prompt flow, upload flow, reference-image ordering, output count, queue behavior, result display, download behavior, provider mapping, or related tests unless a task explicitly scopes Basic image generation.

### Virtual Model Composition

Virtual model composition is an independent page module. Keep its composition inputs, prompt rules, and round orchestration in `public/virtual-model.*`. It may reuse only shared application services.

### Action Variation

Action variation is an independent page module. A submission selects templates and sends a reference image to the LLM action planner. The planner creates exactly 12 single-pose action plans. Each plan creates one task per enabled provider, normally 12 x 2 = 24 independent tasks.

For LLM visual planning, action variation reads the local source image and sends it as an image Data URL through Chat Completions. Do not reintroduce a mandatory external image host into this path. Keep task retries scoped to one Job.

## Provider and Credential Rules

Browser code never receives provider credentials. Never print, commit, log, or edit real keys.

Never create, modify, overwrite, delete, rename, or otherwise update `.env`, `.env.*`, or `*.env` files. Provide exact proposed values and manual execution guidance when configuration changes are needed.

Use one entry per environment variable. The runtime preserves process variables and otherwise reads the first matching `.env` entry. Later duplicate entries are ignored.

Image generation and LLM credentials are separate:

- `OPENAI_API_KEY`: GPT/Image2 provider only.
- `LLM_BASE_URL`: GPT/Image2 OpenAI-compatible base URL.
- `OPENAI_IMAGE_MODEL`: GPT/Image2 model name.
- `OPENAI_IMAGE_GENERATION_URL`: optional GPT text-to-image endpoint override.
- `OPENAI_IMAGE_EDIT_URL`: optional GPT image-to-image endpoint override.
- `OPENLUX_API_KEY`: OpenLux/Google image provider only.
- `OPENLUX_BASE_URL`: OpenLux image API base URL.
- `OPENLUX_IMAGE_MODEL`: OpenLux/Google image model.
- `GOOGLE_API_KEY`, `GOOGLE_IMAGE_MODEL`: Google-compatible fallbacks when OpenLux variables are absent.
- `OPENAI_LLM_API_KEY`: OpenAI-compatible LLM calls only.
- `OPENAI_LLM_BASE_URL`: LLM Chat Completions URL.
- `OPENAI_LLM_MODEL`: LLM model name.
- `OPENAI_LLM_RESPONSES_URL`: optional explicit LLM Responses URL.
- `MAX_CONCURRENCY`, `GENERATION_CONCURRENCY`: image task concurrency.
- `PROVIDER_TIMEOUT_MS`: per-provider request timeout.
- `LLM_TIMEOUT_MS`: action-planning LLM timeout.
- `HOST`, `PORT`: local server bind address and port.
- `DEFAULT_IMAGE_PROVIDER`: default image provider.
- `OPENAI_IMAGE_SIZE_*`: GPT size allowlist.
- `IMAGE_MAX_EDGE_PX`, `IMAGE_SIZE_MULTIPLE_PX`, `IMAGE_MAX_ASPECT_RATIO`: GPT size validation limits.
- `WORKBENCH_PLUGIN_ROOT`: optional external plugin root.

Before an external LLM call, confirm it uses `OPENAI_LLM_API_KEY`. For OpenLux vision and action planning, use Chat Completions with `messages`, `image_url`, and `stream: true`. Action variation uses an in-memory Data URL and must not log the Base64 payload.

## Development Rules

- Read the current code, runtime configuration shape, and relevant logs before changing behavior.
- Keep changes within the requested module and ownership boundary. Do not bundle unrelated refactors or features.
- New business modules must keep business logic isolated from Basic image generation while reusing shared services where appropriate.
- Use business-layer `aspectRatio` and `resolutionTier`; provider adapters perform provider-specific translation.
- Preserve `data/` and unrelated dirty worktree changes.
- For bugs, establish a focused, red-capable reproduction before changing behavior.
- Add targeted regression coverage for changed behavior and run the applicable repository commands.

## Validation Commands

Run from this repository root:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run validate:module
npm.cmd run validate:plugin
```
