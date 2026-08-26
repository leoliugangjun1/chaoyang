import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.rm(path.join(root, 'dist'), { recursive: true, force: true });
await fs.cp(path.join(root, 'public'), path.join(root, 'dist', 'public'), { recursive: true });
await fs.cp(path.join(root, 'server'), path.join(root, 'dist', 'server'), { recursive: true });
await fs.cp(path.join(root, 'src'), path.join(root, 'dist', 'src'), { recursive: true });
console.log('Build created: dist/');
