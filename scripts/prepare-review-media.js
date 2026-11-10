/** Fetch official store screenshots and validate the existing/new YouTube embeds. No database writes. */
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../src/database/prisma');

const games = { 'hades-como-aprender-cada-tentativa': 1145360, 'hollow-knight-explorar-hallownest': 367520, 'stardew-valley-primeiros-dias': 413150, 'terraria-primeira-base-e-exploracao': 105600, 'portal-2-puzzles-cooperativo': 620 };
const videos = {
  'hades-como-aprender-cada-tentativa': ['Bz8l935Bv0Y', 'Trailer de lançamento de Hades — Supergiant Games'],
  'hollow-knight-explorar-hallownest': ['UAO2urG23S4', 'Trailer de lançamento de Hollow Knight — Team Cherry'],
  'stardew-valley-primeiros-dias': ['ot7uXNQskhs', 'Trailer de Stardew Valley — ConcernedApe.'],
  'terraria-primeira-base-e-exploracao': ['w7uOhFTrrq0', 'Trailer original de Terraria — Re-Logic'],
  'portal-2-puzzles-cooperativo': ['A88YiZdXugA', 'Trailer cooperativo de Portal 2 — Valve.'],
  '06e98ead-0b4b-4a98-b26e-9e378fc53154': ['jw0RGzr8ULA', 'Trailer de Pillion indicado no site oficial da A24; conteúdo adulto.'],
  'watchmen-como-comecar-classico': ['j-s-cxTnH2Q', 'Trailer da adaptação animada Watchmen Chapter 1; contém violência e possíveis spoilers. A análise acima é da HQ.'],
  'v-de-vinganca-hq-e-distopia': ['V5VGq23aZ-g', 'Trailer da adaptação cinematográfica V de Vingança; a análise acima é da HQ.'],
  'sandman-preludios-e-noturnos': ['Er18gmgqy2k', 'Trailer da segunda temporada da adaptação de Sandman; contém possíveis spoilers e não corresponde apenas ao primeiro volume.'],
  'batman-ano-um-porta-de-entrada': ['s86sUsWRx0Q', 'Trailer da adaptação animada Batman: Ano Um; a análise acima é da HQ.'],
  'all-star-superman-uma-historia-fechada': ['X5xvlXV9crE', 'Curta comemorativo dos 80 anos de Superman — DC Kids. Material complementar sobre o personagem; não é uma adaptação de All-Star Superman.'],
};

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

async function main() {
  const entries = [...require('../prisma/data/blog-review-expansion-20261109.json'), ...require('../prisma/data/blog-film-expansion-20261109.json')];
  const manifest = {};
  for (const entry of entries) {
    const article = await prisma.blogArticle.findUnique({ where: { id: entry.id } });
    if (!article) continue;
    const media = { images: [], videos: [] };
    if (games[entry.id]) {
      const result = await json(`https://store.steampowered.com/api/appdetails?appids=${games[entry.id]}&l=portuguese`);
      const data = result[games[entry.id]]?.data;
      if (!data?.screenshots?.length) throw new Error(`Sem screenshots: ${entry.id}`);
      media.images = data.screenshots.slice(0, 2).map((image, index) => ({ src: image.path_full, alt: `${data.name} — captura oficial ${index + 1} da página da Steam. Crédito: ${data.developers.join(', ')}.`, source: `https://store.steampowered.com/app/${games[entry.id]}/` }));
    }
    const existing = article.spotlight?.trailerUrl;
    const selected = videos[entry.id];
    const url = selected ? `https://www.youtube.com/watch?v=${selected[0]}` : existing;
    if (url) {
      const metadata = await json(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      media.videos.push({ src: url, alt: selected?.[1] || `${metadata.title} — material promocional, ${metadata.author_name}.`, title: metadata.title, publisher: metadata.author_name });
    }
    manifest[entry.id] = media;
    console.log(`${entry.id}: ${media.images.length} imagens novas; ${media.videos.length} vídeo validado.`);
  }
  const output = path.join(__dirname, '../prisma/data/blog-review-media-20261109.json');
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
