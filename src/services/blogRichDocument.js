const { URL } = require('node:url');

/** Additive JSON contract: never persist HTML or arbitrary iframe attributes. */
function validateDocument(value, { fail, text, safeUrl }) {
  if (!Array.isArray(value) || value.length > 500) fail('Documento inválido ou muito longo.');
  return value.map(block => {
    if (!block || !['paragraph', 'heading', 'list-item', 'image', 'video'].includes(block.type)) fail('Tipo de conteúdo inválido.');
    const mediaLayout = {};
    if (block.type === 'image' || block.type === 'video') {
      if (block.width !== undefined) {
        if (!Number.isInteger(block.width) || block.width < 20 || block.width > 100) fail('A largura da mídia deve estar entre 20% e 100%.');
        mediaLayout.width = block.width;
      }
      if (block.align !== undefined) {
        if (!['left', 'center', 'right'].includes(block.align)) fail('Alinhamento da mídia inválido.');
        mediaLayout.align = block.align;
      }
    }
    if (block.type === 'image') return { type: 'image', src: safeUrl(text(block.src, 2000, true), true), alt: text(block.alt, 500, true), ...mediaLayout };
    if (block.type === 'video') {
      const src = safeUrl(text(block.src, 2000, true));
      const url = new URL(src);
      if (!(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com', 'vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname) || /\.(mp4|webm)$/i.test(url.pathname))) fail('Use YouTube, Vimeo ou um arquivo MP4/WebM.');
      return { type: 'video', src, alt: text(block.alt || '', 500), ...mediaLayout };
    }
    if (!Array.isArray(block.content) || block.content.length > 2000) fail('Trechos de texto inválidos.');
    const content = block.content.map(run => {
      if (!run || typeof run.text !== 'string' || run.text.length > 20000) fail('Trecho de texto inválido.');
      // Whitespace is meaningful inside formatted runs (e.g. between a link and plain text).
      return { text: run.text, ...(run.bold === true ? { bold: true } : {}), ...(run.italic === true ? { italic: true } : {}), ...(run.underline === true ? { underline: true } : {}), ...(run.href ? { href: safeUrl(text(run.href, 2000)) } : {}), ...(['sans', 'serif', 'mono'].includes(run.font) ? { font: run.font } : {}), ...(['small', 'normal', 'large'].includes(run.size) ? { size: run.size } : {}) };
    });
    return { type: block.type, ...(block.type === 'heading' ? { level: block.level === 3 ? 3 : 2 } : {}), ...(['left', 'center', 'right'].includes(block.align) ? { align: block.align } : {}), content };
  });
}
module.exports = { validateDocument };
