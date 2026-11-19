/** Walk GIF blocks (never scan compressed bytes for flags) to identify animated transparency. */
function isTransparentAnimation(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 14 || !/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return false;
  let offset = 13 + ((bytes[10] & 128) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0);
  let frames = 0;
  let transparentFrames = 0;
  let transparency = false;
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (!size) return true;
      offset += size;
      if (offset > bytes.length) return false;
    }
    return false;
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return frames > 1 && transparentFrames === frames;
    if (marker === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) {
        if (offset + 6 > bytes.length || bytes[offset] !== 4 || bytes[offset + 5] !== 0) return false;
        transparency = Boolean(bytes[offset + 1] & 1);
        offset += 6;
      } else if (!skipBlocks()) return false;
    } else if (marker === 0x2c) {
      if (offset + 9 > bytes.length) return false;
      const packed = bytes[offset + 8];
      offset += 9 + ((packed & 128) ? 3 * (2 ** ((packed & 7) + 1)) : 0);
      if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) return false;
      offset++;
      if (!skipBlocks()) return false;
      frames++;
      if (transparency) transparentFrames++;
      transparency = false;
    } else return false;
  }
  return false;
}
module.exports = { isTransparentAnimation };
