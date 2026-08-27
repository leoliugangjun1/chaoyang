# Virtual Model Composition

This directory reserves the versioned declarative module contract for virtual model composition.

The current working implementation is the independent browser page in `public/virtual-model.html`, with page logic in `public/virtual-model.js` and styles in `public/virtual-model.css`. It uses the shared asset, generation, task, and provider APIs while keeping virtual model state, prompt rules, and two-provider round orchestration in the page module.

A version directory containing `manifest.json`, `ui.schema.json`, `workflow.json`, `output.schema.json`, and module tests has not yet been added. It should be introduced as a separate scoped change after the declarative workflow contract is agreed.
