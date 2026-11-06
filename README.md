Criar estrutura de pastas

Analytics do Blog: coleta consentida, relatórios ADMIN/MANAGER e retenção de 365 dias. Requer a migração `20261105160000_blog_analytics`. Veja [configuração, eventos e métricas](docs/blog-analytics.md).

O painel do Blog oferece ações rápidas reais: duplicação em rascunho e exclusão com revisão, além de paginação 12/24/48. Rotas e contratos em [docs/blog-management.md](docs/blog-management.md#a%C3%A7%C3%B5es-r%C3%A1pidas-e-pagina%C3%A7%C3%A3o-administrativa). Não requer migração.

O catálogo público do Blog também fornece a foto do autor vinculado (`authorPhotoUrl`), preservando o snapshot editorial e selecionando somente a URL pública do perfil. Contrato em [docs/blog-management.md](docs/blog-management.md#foto-pública-do-autor).

Importação de imagens de filmes/séries para o Blog: configure `TMDB_READ_ACCESS_TOKEN` e `BLOG_MEDIA_PUBLIC_URL`, execute `npm run db:migrate:deploy` e `npm run db:generate`. A migração `20261105120000_blog_media_assets` armazena os arquivos importados no banco. Veja [docs/blog-management.md](docs/blog-management.md#imagens-do-tmdb).

O Blog possui editor administrativo com conteúdo formatado e upload autenticado de imagens. Veja [docs/blog-management.md](docs/blog-management.md) para endpoints, contrato JSON, testes, variáveis de ambiente e armazenamento persistente.

afiliados-backend/
│
├── src/
│   ├── controllers/
│   ├── routes/
│   ├── middlewares/
│   ├── services/
│   ├── prisma/
│   ├── config/
│   ├── utils/
│   │
│   ├── app.js
│   └── server.js
│
├── prisma/
│   └── schema.prisma
│
├── .env
├── .gitignore
├── package.json


=======================================

controllers
→ lógica das rotas

routes
→ endpoints

middlewares
→ autenticação JWT

services
→ regras de negócio

utils
→ helpers (gerar slug, QR code)

prisma
→ conexão banco


# API do Blog Netbox

O backend também armazena o catálogo editorial usado em `/site/blog`.

- `GET /blog/articles`: lista artigos demonstrativos e publicados, com busca opcional em `?q=` e filtro `?category=`.
- `GET /blog/articles/:slug`: retorna um artigo e suas fontes.
- `npm run blog:seed`: sincroniza de forma idempotente `prisma/data/blog-articles.json` com PostgreSQL.
- `BLOG_SITE_URL`: URL pública base usada para montar o endereço canônico retornado pela API.

Os modelos `BlogArticle` e `BlogArticleSource` guardam conteúdo, metadados SEO, capa, status, destaque e referências. Conteúdos `draft` e publicações futuras não são expostos pela API. O arquivo de dados é gerado no projeto do site com `npm run blog:export -- <destino>` e então versionado junto ao backend para permitir auditoria e implantação reproduzível.


## Gerenciamento editorial autenticado

O Blog dispõe de CRUD administrativo, categorias e publicação por snapshots. Consulte [docs/blog-management.md](docs/blog-management.md) para endpoints, migrations, autorização e testes. O site institucional consome a API pública; salvar uma cópia de trabalho não publica suas alterações.
# Autoria no Blog

O editor também integra Metron (capas de HQs) e IGDB (capas e horizontais de jogos), com credenciais somente no servidor. Veja [configuração e contratos](docs/blog-image-catalogs.md).

Categorias vazias do Blog podem ser excluídas por gestores via `DELETE /admin/blog/categories/:id`; vínculos com artigos bloqueiam a exclusão. Veja [gestão do Blog](docs/blog-management.md).

Usuários ativos autenticados podem escolher o autor na criação e edição. O artigo público exibe nome e foto da versão publicada. Consulte o fluxo e as permissões em [Blog](docs/blog-management.md).
