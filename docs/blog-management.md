# Administração do Blog

## Ações rápidas e paginação administrativa

`GET /admin/blog/articles` aceita `pageSize` 12, 24 ou 48 e devolve `pageSize`, `items`, `total`, `page` e `pages`; valor ausente/inválido usa 12. Busca, categoria, status e ordenação permanecem no servidor. Métricas continuam globais.

`POST /admin/blog/articles/:id/duplicate` recebe `{id,revision}`. Cria uma cópia real como rascunho, com novo UUID e slug, autor vinculado ao gerente que duplicou, snapshot/revisão publicada vazios e fontes copiadas. Conteúdo, pôster, trailer e referências de mídia são preservados. Repetir o mesmo ID/revisão devolve a mesma cópia quando pertence à operação/usuário, sem duplicar novamente. A origem não é modificada.

`DELETE /admin/blog/articles/:id` recebe `{revision}` no corpo e responde 204. Exclui o artigo e suas fontes por cascata, incluindo sua disponibilidade pública, sem remover arquivos compartilhados em disco ou no banco. A confirmação com o título ocorre na interface. Os dois endpoints exigem as permissões ADMIN/MANAGER existentes e verificam a revisão dentro de transação: concorrência gera 409, registros ausentes 404. Não há migração nem mudança de permissão. Os testes PostgreSQL verificam autorização, conflitos, duplicação idempotente, exclusão de uma cópia publicada, preservação da imagem e tamanhos/páginas com filtros.

## Exclusão de categorias

`DELETE /admin/blog/categories/:id` exige usuário ativo ADMIN/MANAGER e retorna 204. Aceita ID inteiro positivo; IDs inválidos retornam 400, categoria inexistente 404 e categoria com artigos vinculados 409, com orientação para mover os artigos antes de excluir. A relação existente `onDelete: Restrict` impede exclusão com vínculos, inclusive em concorrência. Não exclui artigos ou mídias e não exige migração. Testes: `node --test test/blogCategories.test.js test/blogAuthors.test.js`.

## Foto pública do autor

Novas publicações guardam nome e `authorPhotoUrl` no snapshot, com foto vazia quando ausente. Trocar o autor no rascunho preserva a identidade pública até publicar. Snapshots antigos usam a foto atual somente quando o nome publicado corresponde ao nome do rascunho; ao salvar, essa foto é preservada antes da troca. Sem foto, o site usa iniciais. Atualizar a foto de novas publicações exige republicar.

`GET /admin/blog/authors` retorna somente `id`, `name` e `photoUrl` dos usuários ativos. Criação e edição aceitam `authorId` inteiro positivo; o servidor resolve o nome real e rejeita contas inexistentes/inativas. Na criação, omitir usa o usuário autenticado. Na edição, omitir ou manter o ID preserva a autoria atual, inclusive vínculos inativos. A resposta administrativa inclui `authorUser.photoUrl` para a prévia. Não há migração.

Qualquer usuário ativo autenticado pode consultar artigos/categorias/autores, criar e editar artigos e usar imagens do editor. Publicar/despublicar/arquivar, excluir, duplicar e gerenciar categorias continuam exigindo ADMIN/MANAGER. Testes: `node --test test/blogAuthors.test.js test/blogManagement.test.js`; a integração PostgreSQL exige `BLOG_TEST_DATABASE=1` em banco de testes.

## Imagens do TMDB

O servidor carrega `afiliados-backend/.env` por caminho absoluto, independentemente da pasta de onde foi iniciado. Após configurar ou alterar o token, reinicie o backend: o processo em execução mantém as variáveis já carregadas. O modal exibe falhas de consulta sem apresentar simultaneamente mensagens de catálogo vazio.

`GET /admin/blog/tmdb/search?q=texto&page=1` pesquisa filmes/séries sem conteúdo adulto; `GET /admin/blog/tmdb/:kind/:id/images` lista pôsteres e fundos (português, inglês e sem idioma); `POST /admin/blog/tmdb/import` recebe `{kind,id,path}`. Todos exigem autenticação e usuário ativo. O servidor confirma que a imagem pertence à obra e baixa somente do CDN oficial, com timeout, limite de 8 MB e validação de assinatura. Os bytes, MIME, nome, origem e data são gravados em `BlogMediaAsset`. A resposta contém `url` e `alt` (nome da obra/formato, editável no painel). `GET /blog/media/assets/:id` serve os bytes publicamente para artigos e snapshots, com cache imutável. A importação não salva nem publica o artigo; arquivos permanecem ao remover a referência.

Requer `TMDB_READ_ACCESS_TOKEN` somente no backend e `BLOG_MEDIA_PUBLIC_URL` com sua origem pública; o token do institucional deve ser configurado também neste serviço. Aplicar `npm run db:migrate:deploy` e `npm run db:generate` antes de usar; não altera os uploads em disco existentes. Falhas de API/configuração retornam erro controlado. Testes: `node --test test/blogTmdb.test.js test/blogRichContent.test.js`. Referências: https://developer.themoviedb.org/reference/search-multi e https://developer.themoviedb.org/reference/movie-images.

## Tamanho e ordem das mídias

Blocos `image` e `video` de `Section.document` aceitam `width` inteiro entre 20 e 100 (percentual da área de texto) e `align` (`left`, `center`, `right`). Propriedades ausentes preservam a compatibilidade: largura total e centralização no renderer. Valores inválidos retornam 400; CSS livre não é aceito. A ordem do array define a posição vertical das mídias e é preservada na gravação e no `publicSnapshot`. Não há migração de banco. Os testes cobrem limites, reordenação, persistência e isolamento entre rascunho e publicação.

A prévia completa do editor é uma comunicação em memória entre painel e institucional; não cria endpoint administrativo nem altera autenticação, permissões ou publicação.

## Capa da obra e imagem horizontal

Os campos `cover` e `coverAlt` continuam representando a imagem horizontal dos slides/cards e da abertura do artigo. A capa original da obra reutiliza o JSON `spotlight`: `{ title, poster, posterAlt?, trailerUrl? }`. A validação administrativa aceita URLs HTTP(S) e caminhos relativos para `poster`, limita a descrição a 500 caracteres e preserva título e trailer enviados pelo editor. Nenhuma migração é necessária.

O pôster é opcional. Para removê-lo sem perder os demais dados de destaque, envie `poster: ''` no objeto existente. Omitir `spotlight` ou enviar `null` não adiciona o campo aos dados de atualização, preservando compatibilidade com clientes antigos. Ao publicar, os dois tipos de imagem integram o snapshot: alterações em rascunho não vazam para a versão pública. A descrição opcional do pôster usa o título como alternativa no carrossel; `coverAlt` continua obrigatório para publicação.

## Editor visual e mídia

`POST /admin/blog/media` exige usuário ativo ADMIN/MANAGER e recebe bytes com Content-Type `image/jpeg`, `image/png`, `image/webp` ou `image/gif`, até 8 MB. Verifica assinatura, gera nome UUID e retorna `{ url }`. `GET /blog/media/:filename` serve os arquivos publicamente com `nosniff` e cache imutável; não aceita SVG nem HTML. Não existe endpoint de exclusão: remover no editor apenas desvincula a imagem, sem afetar outros artigos.

`BLOG_MEDIA_DIR` define a pasta persistente; padrão `uploads/blog` na raiz do backend, ignorada pelo Git. Em contêiner, monte um volume nessa pasta ou configure um diretório persistente. Inclua esses arquivos no backup junto com o banco. `BLOG_MEDIA_PUBLIC_URL` define a origem pública do backend (sem `/blog/media`); é obrigatória em produção. Em desenvolvimento, o padrão é `http://localhost:<porta do servidor>`. Não há processamento assíncrono, otimização ou limpeza automática de uploads sem referência. O envio salva a imagem imediatamente; salvar/publicar o artigo é separado.

O contrato de cada seção aceita `document?: RichBlock[]`. Blocos: `paragraph`, `heading` (H2/H3), `list-item`, `image` (`src`, `alt`), `video` (`src`, `alt` opcional). Texto usa `content: [{ text, bold?, italic?, underline?, href?, font?, size? }]`, com fontes `sans/serif/mono`, tamanhos `small/normal/large` e alinhamento `left/center/right` no bloco. São permitidos até 500 blocos por documento. `blogRichDocument.js` limita e normaliza os atributos; HTML e eventos não são aceitos. `paragraphs` é derivado do documento para manter busca e consumidores antigos. Seções sem documento mantêm o contrato anterior, sem migração.

Vídeos permitem YouTube, Vimeo e arquivos HTTP(S) MP4/WebM. O painel e o institucional renderizam por React e constroem os embeds conhecidos; não recebem HTML de iframe. Os snapshots de publicação preservam o documento validado.

Testes: `node --test test/blogRichContent.test.js test/blogManagement.test.js`; para integração descartável com PostgreSQL, habilite `BLOG_TEST_DATABASE=1`. O teste verifica upload/leitura, autorização, persistência, publicação e limpeza dos próprios registros/arquivos.

O frontend está documentado em `../afiliados_netbox/src/app/integracoes/blog/README.md` (projeto irmão). Este módulo amplia os modelos e endpoints públicos de Blog já existentes.

| Método / caminho | Função |
| --- | --- |
| GET `/admin/blog/articles` | Listar: `q`, `category`, `status`, `sort` (createdAt/updatedAt/publishedAt), `page`; 12 registros e métricas globais |
| POST `/admin/blog/articles` | Criar rascunho com UUID enviado pelo cliente; repetir mesmo ID não duplica |
| GET `/admin/blog/articles/:id` | Consultar cópia de trabalho completa |
| PUT `/admin/blog/articles/:id` | Atualizar com `revision`; conflito retorna 409 |
| POST `/admin/blog/articles/:id/publication` | `{ action: publish/unpublish/archive, revision }` |
| GET `/admin/blog/categories` | Categorias e contagens |
| POST `/admin/blog/categories` | Criar nome, slug único e descrição |
| PUT `/admin/blog/categories/:id` | Editar nome e descrição; slug permanente |
| GET `/blog/articles` | Catálogo público; busca e categoria usam a versão publicada |
| GET `/blog/articles/:slug` | Versão pública ou 404 |

Rotas administrativas exigem `requireAuth` (usuário ativo). Publicação, exclusão, duplicação e gravação de categorias também exigem `requireManager` (ADMIN/MANAGER). Erros de validação retornam 400, ausência 404, conflitos 409, autenticação 401, autorização 403 e falhas de infraestrutura 500. Consultas usam Prisma, sem SQL construído com dados do usuário.

## Banco e publicação

- `20261030170000_blog_management`: cria `BlogCategory`, migra categorias distintas existentes, cria FK por slug com Restrict/Cascade, busca textual e campos de revisão/publicação/erro. Torna `syncedAt` opcional e remove seu comportamento automático de atualização no Prisma.
- `20261030180000_blog_author_relation`: FK opcional para User com `SET NULL`; preserva nome histórico do autor.
- A migration prévia `20261030153000_add_blog_articles` já existia no checkout e não foi substituída.
- `publicSnapshot` é JSON no contrato institucional, criado no primeiro salvamento de um artigo legado público ou ao publicar. Campos legados, fontes, SEO, destaque e créditos não editados pelo formulário são preservados; título/descrição SEO acompanham título/resumo.
- `revision` usa compare-and-swap em transação, incluindo as ações de publicação. Sem exclusão definitiva e sem novas tabelas de credenciais.
- Publicação disponibiliza conteúdo nesta API, consumida pelo institucional via `BLOG_API_URL`; não há chamada de upload a um endpoint remoto. O ID público é o próprio ID local, portanto não é necessário externalId.
- Salvamento de artigo público mantém o snapshot anterior. Slug só pode mudar após despublicação. `publishedRevision`, `syncedAt`, `syncAttemptedAt` e `syncError` distinguem a cópia local da versão disponibilizada.
- Publicação imediata, sem agendamento. `publishedAt` legado permanece não nulo no banco; em rascunhos não representa publicação e a interface o oculta.
- Importação `scripts/seed-blog.js` cria categorias ausentes e não sobrescreve registros editados pelo painel (`revision > 1` ou `authorId`).

## Configuração e testes

Usar DATABASE_URL/JWT_SECRET existentes; BLOG_SITE_URL opcional para a URL canônica. Executar `npm.cmd run db:migrate:deploy` e `npm.cmd run db:generate` antes de reiniciar o backend. O institucional precisa de BLOG_API_URL apontando para este backend. Não há chave de publicação adicional.

`node --test test/blogManagement.test.js` valida dados. Com `BLOG_TEST_DATABASE=1`, também inicia Express numa porta efêmera, usa PostgreSQL real, cria dois usuários temporários e testa autorização, CRUD, conflito, snapshots, busca, publicação, despublicação e preservação após erro. Os registros criados pelo teste são removidos ao terminar.
