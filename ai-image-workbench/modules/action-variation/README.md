# Action Variation

This directory reserves the versioned declarative module contract for action variation.

The current working implementation is the independent browser page in `public/action-variation.html`, with page logic in `public/action-variation.js` and styles in `public/action-variation.css`. It uses the shared asset upload, generation, task polling, template, provider, and result asset APIs while keeping action templates, prompt construction, batch orchestration, selection, and download state within the page module.

A version directory containing `manifest.json`, `ui.schema.json`, `workflow.json`, `output.schema.json`, and module tests has not yet been added. It should be introduced as a separate scoped change after the declarative workflow contract is agreed.
