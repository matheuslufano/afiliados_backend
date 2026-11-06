# Catálogos de imagens de HQs e jogos

O editor usa Metron para HQs, IGDB para jogos e mantém o TMDB para filmes/séries. Consultas/importações exigem usuário ativo autenticado, como o envio de imagens existente. Não altera permissões, schema, publicação ou artigos existentes.

## Ativação no backend

Configure no ambiente do servidor e reinicie o backend:

```dotenv
METRON_API_TOKEN=
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=
BLOG_MEDIA_PUBLIC_URL=https://origem-publica-do-backend
```

- Metron: crie conta em https://metron.cloud/ e gere um token em API Tokens. A integração usa Bearer e pesquisa edições pelo nome da série. Retorna a capa principal; não oferece um acervo de banners horizontais. Para o campo horizontal de HQs, upload/link continuam disponíveis.
- IGDB: crie um aplicativo confidencial no console Twitch (https://dev.twitch.tv/console/apps), com a autenticação exigida pelo serviço, e obtenha Client ID/Secret. O backend solicita o app access token, guarda somente em memória e renova antes da expiração. Capas vêm de `cover`, horizontais de `artworks`/`screenshots`, filtrando largura maior que altura. Não é necessário configurar credenciais no frontend nem expor o token obtido.
- Sem credenciais ou com credenciais recusadas: 503 explícito. Limite remoto: 429. Obra ausente: 404. Não existe catálogo simulado como fallback.

## Rotas

| Método e rota | Contrato |
| --- | --- |
| GET `/admin/blog/catalog/:provider/search?q=texto&page=1` | `{page,pages,results:[{id,kind,title,year}]}` |
| GET `/admin/blog/catalog/:provider/:kind/:id/images` | `{title,source,images:[{path,type,preview,width,height}]}` |
| POST `/admin/blog/catalog/:provider/import` | `{kind,id,path}` → `{url,alt}` |

Providers: `metron` (`kind=issue`) e `igdb` (`kind=game`). As rotas TMDB existentes são preservadas. Na paginação, `pages` sinaliza a próxima página disponível, sem estimar totais desconhecidos. Consultas Metron usam o tamanho de página do serviço; IGDB usa páginas de 20 resultados.

A importação consulta novamente a obra, confirma o identificador da imagem e baixa apenas de hosts fixos: `metron.cloud`/`static.metron.cloud` em `/media/` e `images.igdb.com/igdb/image/upload/`. Downloads não recebem credenciais da API, não seguem redirects e têm timeout, limite de 8 MB e verificação de assinatura/MIME. A seleção é armazenada em `BlogMediaAsset` com bytes e URL de origem, servida pela rota pública de mídia existente. Falhas não modificam o artigo. A prévia usa a seleção; somente salvar grava o artigo e publicar atualiza o snapshot.

## Créditos e condições dos provedores

- Dados Metron: CC BY-SA 4.0 com atribuição; capas não estão incluídas nessa licença e pertencem a editoras/criadores. Condições: https://metron-project.github.io/blog/commercial-api-use.
- IGDB: a documentação descreve acesso gratuito não comercial e parceria para uso comercial. Verifique o enquadramento da Netbox com o provedor antes de ativar em produção: https://api-docs.igdb.com/#account-creation.
- O modal identifica o provedor; a página pública `/site/blog/creditos` inclui Metron/IGDB e a licença dos dados Metron. Armazenar a origem não concede direitos sobre as imagens.

## Verificação

`node --test test/blogImageCatalog.test.js test/blogTmdb.test.js test/blogManagement.test.js` cobre configuração ausente, normalização, paginação, OAuth em cache, hosts/identidade de imagens, tamanho/MIME, autenticação, persistência/entrega com banco simulado e regressão TMDB. O teste PostgreSQL exige `BLOG_TEST_DATABASE=1` em banco isolado. Sem credenciais reais, chamadas remotas permanecem não verificadas.

Referências técnicas: https://github.com/Metron-Project/metron/blob/master/api/README.md e https://api-docs.igdb.com/.
