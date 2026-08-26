# AI Image Workbench

## Product Boundary

This repository is one AI image-generation application. The left navigation contains business modules within the same application shell:

- Basic image generation
- Virtual model composition
- Action variation
- Generation history

They share the application shell, navigation, server API, provider integrations, uploads, task storage, and result assets. Each business module owns its own generation rules and workflow.

## Directory Map

- `public/`: browser application shell and Basic image generation UI. `public/app.js` owns the current Basic image generation interaction state; CSS files style the shell and views.
- `server/`: loopback HTTP API, runtime, generation queue, and plugin manager. `server/index.js` owns routes; `server/runtime.js` owns tasks, local persistence, and provider adapters.
- `src/shared/`: shared protocol, platform errors, and capability definitions.
- `modules/`: declarative, versioned business-module manifests. They do not contain browser executable code.
- `tests/`: Node test suite for runtime, HTTP, queue, module, plugin, and provider mappings.
- `scripts/`: build and module/plugin validation scripts.
- `data/`: runtime uploads, results, history, registry, templates, and logs. Runtime data is local and ignored by Git.
- `docs/`: architecture and current handoff records.

## Basic Image Generation Baseline

Basic image generation is complete and is the protected baseline. Its product code is primarily in `public/app.js`, `public/styles.css`, `server/index.js`, `server/runtime.js`, and `tests/`.

Do not change its UI behavior, prompt flow, uploads, reference-image ordering, generation count, task queue, result display, download behavior, provider request mapping, or tests unless a later task explicitly names Basic image generation as its scope.

New business modules must keep business logic separate from the Basic image generation workflow. They may reuse shared API, provider, upload, task, asset, history, and application-shell capabilities without copying or modifying the Basic image generation business flow.

## Provider Boundary

- GPT/Image2 is implemented in `server/runtime.js` and uses the configured OpenAI-compatible images endpoints. The provider maps business `aspectRatio` and `resolutionTier` to its supported `size`.
- Google/Nano Banana is implemented in `server/runtime.js` and uses the configured OpenLux Gemini native endpoint. The provider maps business `aspectRatio` and `resolutionTier` to Gemini `imageConfig.aspectRatio` and `imageConfig.imageSize`.
- Browser code must never receive provider API keys.

## Environment Contract

Never edit `.env`, `.env.*`, or `*.env` files. Provide exact proposed values and user execution guidance instead. Never record or print a real key.

Current server-side variable names:

- `OPENLUX_API_KEY`, `OPENLUX_BASE_URL`, `OPENLUX_IMAGE_MODEL`: Google/OpenLux authentication, base URL, and Gemini image model.
- `OPENAI_API_KEY`, `LLM_BASE_URL`, `OPENAI_IMAGE_MODEL`: GPT/Image2 authentication, OpenAI-compatible base URL, and image model.
- `OPENAI_IMAGE_GENERATION_URL`, `OPENAI_IMAGE_EDIT_URL`: optional GPT endpoint overrides.
- `GOOGLE_API_KEY`, `GOOGLE_IMAGE_MODEL`: Google-compatible fallbacks when OpenLux variables are absent.
- `MAX_CONCURRENCY`, `GENERATION_CONCURRENCY`: maximum concurrent image jobs.
- `PROVIDER_TIMEOUT_MS`: per-provider request timeout.
- `HOST`, `PORT`: local server bind address and port.
- `DEFAULT_IMAGE_PROVIDER`: default provider selection.
- `OPENAI_IMAGE_SIZE_*`: configured GPT legal size allowlist.
- `IMAGE_MAX_EDGE_PX`, `IMAGE_SIZE_MULTIPLE_PX`, `IMAGE_MAX_ASPECT_RATIO`: validation limits for configured GPT sizes.
- `WORKBENCH_PLUGIN_ROOT`: optional external plugin package root.

## Development Rules

- Read the current code, configuration, and live process state before changing behavior.
- Keep changes inside the requested module and ownership boundary. Do not bundle unrelated refactors or feature work.
- Use business-layer `aspectRatio` and `resolutionTier`; provider adapters translate them to provider-specific parameters.
- Keep Provider keys and raw credentials server-side. Redact secrets from commands, logs, tests, and documentation.
- Preserve runtime `data/`; do not delete it as part of normal work.
- Validate relevant behavior with focused tests and use the repository scripts below.

## Commands

Run from the repository root:

```powershell
npm.cmd run dev
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run validate:module
npm.cmd run validate:plugin
```
