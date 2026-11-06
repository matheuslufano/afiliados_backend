const metron = require('./blogMetron');
const igdb = require('./blogIgdb');
const { fail, downloadImage } = require('./blogCatalogHttp');
function provider(name) {
  if (name === 'metron') return metron;
  if (name === 'igdb') return igdb;
  fail('Catálogo inválido.');
}
async function search(name, query, page) { return provider(name).search(query, page); }
async function images(name, kind, id) {
  const result = await provider(name).images(kind, id);
  return { title: result.title, source: result.source, images: result.images.map(({ url, ...image }) => image) };
}
async function download(name, kind, id, path) {
  if (typeof path !== 'string' || !/^(?:cover|(?:cover|artwork|screenshot):[a-zA-Z0-9_-]{1,100})$/.test(path)) fail('Imagem inválida.');
  const result = await provider(name).images(kind, id);
  const image = result.images.find(item => item.path === path);
  if (!image) fail('Imagem não pertence à obra selecionada.', 404);
  return { ...await downloadImage(image.url), name: `${result.title} — ${image.type === 'poster' ? 'Capa' : 'Imagem horizontal'} (${name === 'metron' ? 'Metron' : 'IGDB'})`.slice(0, 500), source: result.source };
}
module.exports = { search, images, download };
