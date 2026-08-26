# Architecture

The browser UI communicates only with the loopback HTTP API. `WorkbenchRuntime` discovers and validates JSON-only module packages, records pinned module versions on each task, and owns local assets and history. Module workflows can name only capabilities in the platform whitelist; no module HTML, executable code, or direct file path is accepted.

`../ai-workbench-plugins/provider-example/` is the provider package shape. Plugin packages intentionally live outside the product directory so their versions and tags can be released independently. The MVP uses a credential-free local demo implementation for `image.generate` until a production provider and key-storage policy are selected.
