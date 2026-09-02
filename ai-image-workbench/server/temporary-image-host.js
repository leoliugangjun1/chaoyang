import fs from 'node:fs/promises';
import path from 'node:path';

const hostError = (message) => {
  const error = new Error(message);
  error.code = 'TEMP_IMAGE_HOST_FAILED';
  return error;
};

export class TemporaryImageHost {
  constructor({ uploadUrl = process.env.ACTION_VARIATION_TEMP_IMAGE_HOST_URL || 'https://uguu.se/upload', fetchImpl = fetch } = {}) {
    this.uploadUrl = uploadUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  async upload(asset) {
    if (!asset?.localPath) throw hostError('A local source image is required for temporary hosting.');
    const form = new FormData();
    const field = /uguu\.se/i.test(this.uploadUrl) ? 'files[]' : 'file';
    form.set(field, new Blob([await fs.readFile(asset.localPath)], { type: asset.mimeType || 'image/png' }), path.basename(asset.localPath));
    const response = await this.fetch(this.uploadUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(Number(process.env.TEMP_IMAGE_HOST_TIMEOUT_MS || 60000)) });
    const raw = (await response.text()).trim();
    let url = raw;
    try { url = JSON.parse(raw)?.files?.[0]?.url || raw; } catch {}
    if (!response.ok || !/^https:\/\//i.test(url)) throw hostError(`Temporary image upload failed (${response.status}).`);
    return { url, token: response.headers.get('x-token') || null };
  }

  async remove(upload) {
    if (!upload?.url || !upload?.token) return;
    const form = new FormData();
    form.set('token', upload.token);
    form.set('delete', '');
    try { await this.fetch(upload.url, { method: 'POST', body: form, signal: AbortSignal.timeout(Number(process.env.TEMP_IMAGE_HOST_TIMEOUT_MS || 60000)) }); } catch {}
  }
}
