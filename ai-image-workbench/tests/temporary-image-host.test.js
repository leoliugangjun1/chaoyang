import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TemporaryImageHost } from '../server/temporary-image-host.js';

test('temporary image host uploads a local image and removes it with its token', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'temporary-image-host-'));
  const source = path.join(directory, 'source.png');
  await fs.writeFile(source, 'image-data');
  const requests = [];
  const host = new TemporaryImageHost({ uploadUrl: 'https://uguu.se/upload', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return requests.length === 1 ? new Response(JSON.stringify({ files: [{ url: 'https://a.uguu.se/file.png' }] }), { status: 200 }) : new Response('', { status: 200 });
  } });

  const upload = await host.upload({ localPath: source, mimeType: 'image/png' });
  await host.remove(upload);

  assert.deepEqual(upload, { url: 'https://a.uguu.se/file.png', token: null });
  assert.equal(requests[0].url, 'https://uguu.se/upload');
  assert.equal(requests.length, 1);
});
