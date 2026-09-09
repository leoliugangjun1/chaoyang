import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { imageToDataUrl } from '../server/image-data-url.js';

test('imageToDataUrl encodes a local image with its MIME type', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-data-url-'));
  const file = path.join(root, 'source.jpg');
  await fs.writeFile(file, Buffer.from('image-data'));
  assert.equal(await imageToDataUrl(file, 'image/jpeg'), 'data:image/jpeg;base64,aW1hZ2UtZGF0YQ==');
});

test('imageToDataUrl reports a readable reference-image error', async () => {
  await assert.rejects(() => imageToDataUrl(path.join(os.tmpdir(), 'missing-reference-image.png'), 'image/png'), { code: 'REFERENCE_IMAGE_READ_FAILED', message: /Failed to read reference image/ });
});
