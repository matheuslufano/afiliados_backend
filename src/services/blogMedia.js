const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

const mediaDirectory = path.resolve(process.env.BLOG_MEDIA_DIR || path.join(__dirname, '../../uploads/blog'));
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Verify signatures instead of trusting filenames or a browser-provided MIME type. SVG is excluded. */
function imageExtension(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('Envie uma imagem de até 8 MB.'), { status: 400 });
  const types = {
    'image/png': buffer.length > 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : '',
    'image/jpeg': buffer.length > 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? 'jpg' : '',
    'image/webp': buffer.length > 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : '',
    'image/gif': buffer.length > 13 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6)) ? 'gif' : '',
  };
  if (!types[mime]) throw Object.assign(new Error('Imagem inválida. Use JPG, PNG, WebP ou GIF.'), { status: 400 });
  return types[mime];
}
async function saveImage(buffer, mime) {
  const extension = imageExtension(buffer, mime);
  const filename = `${randomUUID()}.${extension}`;
  await mkdir(mediaDirectory, { recursive: true });
  await writeFile(path.join(mediaDirectory, filename), buffer, { flag: 'wx' });
  return filename;
}
module.exports = { mediaDirectory, MAX_IMAGE_BYTES, imageExtension, saveImage };
