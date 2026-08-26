import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkbenchRuntime } from '../server/runtime.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const requested = process.argv[2];
if (!requested) { console.error('Usage: npm run validate:module -- modules/<id>/<version>'); process.exit(1); }
const runtime = new WorkbenchRuntime(root);
try { const module = await runtime.loadModule(path.resolve(root, requested)); console.log(`Valid: ${module.key}`); } catch (error) { console.error(`${error.code || 'MODULE_INVALID'}: ${error.message}`); process.exit(1); }
