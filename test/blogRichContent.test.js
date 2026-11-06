const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateArticle } = require('../src/services/blogValidation');
const { imageExtension, MAX_IMAGE_BYTES } = require('../src/services/blogMedia');
const base = { title: 'Teste', slug: 'teste', summary: '', category: 'tecnologia', cover: '', coverAlt: '' };
const article = document => ({ ...base, content: [{ heading: '', paragraphs: [], document }] });

test('rich document retains formatting, whitespace and safe media and derives searchable text', () => {
  const document = [
    { type: 'heading', level: 3, align: 'center', content: [{ text: 'Título', bold: true, font: 'serif', size: 'large' }] },
    { type: 'paragraph', content: [{ text: 'Veja ' }, { text: 'o link', href: 'https://example.org', italic: true, underline: true }, { text: ' agora.' }] },
    { type: 'image', src: '/blog/test.webp', alt: 'Descrição' },
    { type: 'video', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' },
  ];
  const saved = validateArticle(article(document));
  assert.equal(saved.content[0].document[1].content[0].text, 'Veja ');
  assert.equal(saved.content[0].paragraphs[1], 'Veja o link agora.');
  assert.equal(saved.content[0].document[0].content[0].font, 'serif');
  assert.equal(saved.content[0].document[2].src, '/blog/test.webp');
  assert.ok(saved.searchText.includes('Título'));
});
test('rich document rejects scripts, executable links and untrusted embeds', () => {
  for (const block of [
    { type: 'html', content: [] },
    { type: 'paragraph', content: [{ text: 'X', href: 'javascript:alert(1)' }] },
    { type: 'video', src: 'https://example.org/untrusted-embed' },
    { type: 'image', src: 'data:image/svg+xml,test', alt: 'X' },
  ]) assert.throws(() => validateArticle(article([block])));
  const saved = validateArticle(article([{ type: 'paragraph', onclick: 'bad()', content: [{ text: '<script>text</script>', font: 'evil', style: 'bad', bold: true }] }]));
  assert.deepEqual(saved.content[0].document[0].content[0], { text: '<script>text</script>', bold: true });
});
test('image uploads verify declared type, signatures and limits', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=', 'base64');
  assert.equal(imageExtension(png, 'image/png'), 'png');
  assert.throws(() => imageExtension(png, 'image/jpeg'));
  assert.throws(() => imageExtension(Buffer.from('<svg></svg>'), 'image/svg+xml'));
  assert.throws(() => imageExtension(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'));
});

test('media size and alignment persist with strict bounds and legacy defaults', () => {
  const blocks = [{ type: 'video', src: 'https://example.org/clip.mp4', width: 45, align: 'right' }, { type: 'image', src: '/blog/test.webp', alt: 'Imagem', width: 60, align: 'left' }];
  assert.deepEqual(validateArticle(article(blocks)).content[0].document, blocks.map(b => ({ ...b, alt: b.alt || '' })));
  const legacy = validateArticle(article([{ type: 'image', src: '/blog/test.webp', alt: 'Imagem' }])).content[0].document[0];
  assert.equal(Object.hasOwn(legacy, 'width'), false);
  for (const width of [0, 19, 101, 50.5, '50', NaN]) assert.throws(() => validateArticle(article([{ ...blocks[1], width }])));
  assert.throws(() => validateArticle(article([{ ...blocks[1], align: 'fixed' }])));
});

test('artwork and horizontal cover stay independent and keep existing spotlight metadata', () => {
  const input = { ...article([]), cover: '/blog/wide.webp', coverAlt: 'Cena horizontal', spotlight: { title: 'Título curto da obra', poster: '/blog/poster.webp', posterAlt: 'Capa original', trailerUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } };
  const saved = validateArticle(input);
  assert.deepEqual(saved.spotlight, input.spotlight);
  assert.equal(saved.cover, '/blog/wide.webp');
  const removed = validateArticle({ ...input, spotlight: { ...input.spotlight, poster: '' } });
  assert.equal(removed.spotlight.poster, '');
  assert.equal(removed.spotlight.trailerUrl, input.spotlight.trailerUrl);
  assert.equal(removed.cover, '/blog/wide.webp');
  assert.equal(Object.hasOwn(validateArticle(article([])), 'spotlight'), false);
  assert.equal(Object.hasOwn(validateArticle({ ...article([]), spotlight: null }), 'spotlight'), false);
  assert.throws(() => validateArticle({ ...input, spotlight: { ...input.spotlight, poster: 'javascript:alert(1)' } }));
  assert.throws(() => validateArticle({ ...input, spotlight: { ...input.spotlight, trailerUrl: 'data:text/html,bad' } }));
});
