import fs from 'node:fs/promises';

export async function imageToDataUrl(localPath, mimeType = 'image/png') {
  let data;
  try {
    data = await fs.readFile(localPath);
  } catch (error) {
    const wrapped = new Error(`Failed to read reference image: ${error.message}`);
    wrapped.code = 'REFERENCE_IMAGE_READ_FAILED';
    throw wrapped;
  }
  if (!data.length) {
    const error = new Error('Failed to encode reference image: image is empty.');
    error.code = 'REFERENCE_IMAGE_ENCODE_FAILED';
    throw error;
  }
  return `data:${mimeType};base64,${data.toString('base64')}`;
}
