# AI Image Workbench Handoff

## Completed Stage

The completed and frozen stage is **Basic image generation**. It is the stable baseline for this application.

## Application Shape

This is one application with one browser shell and left navigation. The business modules are Basic image generation, Virtual model composition, Action variation, and Generation history. Only Basic image generation is currently implemented as a verified workflow; the other navigation entries are not separate applications.

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

1. Google reference images are not currently included in the native Gemini request body. This is the real remaining Google image-to-image limitation.
2. The most recent GPT text-to-image validation request reached the configured provider timeout after sending the correct mapped request. The task records the provider timeout.
3. Current navigation entries for Virtual model composition, Action variation, and Generation history are not implemented as independent verified business workflows.

## Basic Image Generation Protection

Do not modify the Basic image generation UI, prompt and upload flow, reference-image ordering, output count, queue, result display, download flow, provider mappings, or related tests unless a task explicitly scopes Basic image generation.

## Next Stage: Virtual Model Composition

Virtual model composition is a new business module inside this application, not a second independent application. It must appear in the existing left navigation alongside Basic image generation, Action variation, and Generation history.

It may reuse the existing provider adapters, API client, asset upload API, task persistence, history, and application shell. Its business rules, inputs, task construction, and module workflow must remain independent from Basic image generation.
