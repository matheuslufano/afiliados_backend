# Analytics do Blog

## Ativação e manutenção

O módulo reutiliza PostgreSQL/Prisma e a autorização ADMIN/MANAGER existente. Execute `npm run db:generate` e `npm run db:migrate:deploy`, incluindo a migração `20261105160000_blog_analytics`, antes de iniciar o backend. Em Windows, a geração pode exigir parar somente o processo local que mantém a DLL do Prisma aberta; não substitua por um client sem engine.

Configure `BLOG_SITE_URL` com a URL pública do Blog. Sua origem é autorizada automaticamente; `BLOG_ANALYTICS_ORIGINS` aceita outras origens exatas, separadas por vírgula. Em desenvolvimento, localhost/127.0.0.1:3002 são autorizados. No site institucional, `BLOG_API_URL` aponta para este backend. Nenhuma nova credencial pública é necessária.

`BlogAnalyticsEvent` retém eventos por 365 dias. O servidor remove os vencidos na inicialização e a cada 24 horas; `npm run blog:analytics:purge` permite executar a mesma manutenção manualmente. Não há reconstrução de histórico anterior à implantação. Eventos preservam metadados públicos mínimos após excluir um artigo, sem FK que apague o histórico editorial.

## Contratos

- `POST /blog/analytics/events`: coleta pública restrita à origem, consentimento explícito, payload até 8 KiB e limite em memória de 120 eventos/minuto/visitante. Retorna 202 com `accepted`; repetir o mesmo UUID retorna `accepted: false`. DNT/GPC e agentes declarados como bots são ignorados com 204. Origem inválida: 403; validação: 400; artigo indisponível: 404; limite: 429; serviço indisponível: 503.
- Campos: `id`, `visitorId`, `sessionId` (UUIDs aleatórios), `articleId`, `kind`, `consent: true`; navegação exige `fromArticleId` diferente. IDs de artigos devem existir e estar públicos. Título, slug, capa e categoria vêm do snapshot público, nunca do texto enviado pelo cliente.
- `GET /admin/blog/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD&articleId=...`: exige autenticação e perfil ADMIN/MANAGER; resposta `no-store`. Padrão: últimos sete dias. Máximo: 180 dias, sem futuro. `articleId` é opcional; inexistente e sem histórico retorna 404.
- Resposta: `period`, `updatedAt`, `tracking`, `metrics` (valor, valor anterior, variação), `daily`, `categories`, `readers`, `articles`, `selectedArticle` e `navigation`. Nenhum hash/identificador de visitante é retornado.

Os dias seguem `America/Araguaina` (UTC−03), com início inclusivo e fim exclusivo no banco. O período anterior tem igual duração, imediatamente anterior ao selecionado. Crescimento sem base anterior é `null` (novo), nunca infinito. Zero contra zero resulta em 0%.

## Definições

| Evento/indicador | Regra |
| --- | --- |
| `article_view` | Artigo visível por um segundo, com consentimento; um UUID estável por montagem evita duplicação por rerender/StrictMode. Reload ou retorno real à página conta nova visualização. |
| Visitantes únicos | Hashes distintos com `article_view` no intervalo. Representam navegadores consentidos; limpar armazenamento, outro aparelho ou recusa de consentimento afetam a medida. |
| `article_share` | Acionamento de rede social, cópia ou compartilhamento nativo no artigo. Não comprova envio ou publicação na rede. |
| `trailer_play` | Primeiro estado PLAYING confirmado pela API oficial do YouTube por montagem do trailer do slide vinculado a um artigo. Abrir a miniatura não conta. |
| Múltiplos artigos | Visitantes com visualizações em pelo menos dois IDs distintos no intervalo; taxa = estes visitantes / únicos × 100. No detalhe: leitores do artigo que também acessaram outro. |
| Série diária de múltiplos | Exige dois artigos diferentes no mesmo dia. Únicos diários e esta série não devem ser somados para obter os únicos do período. |
| `article_navigation` | Transição entre artigos na sessão ativa de 30 minutos; backend exige visualização anterior da origem na mesma sessão/visitante nos últimos 30 minutos. |
| Continuaram/Seguiram | Visitantes distintos com navegação saindo do artigo; tabela de destinos também apresenta a quantidade de eventos. Não representa leitura completa. |
| Categorias | Contagem exclusivamente de `article_view`, usando a categoria pública registrada no momento do evento. |

## Privacidade, limites e escala

O site reutiliza `netbox_cookie_consent`; sem opção `all`, não cria IDs nem envia eventos. DNT/GPC prevalecem. Visitor ID expira em 365 dias; session ID expira após 30 minutos sem eventos. Recusar remove as identidades locais. O proxy não encaminha cookies, autorização ou IP do visitante. O banco guarda somente SHA-256 dos IDs aleatórios, sem CPF, nome, e-mail, IP, user-agent ou fingerprint. A limitação de taxa usa hash transitório do IP da conexão com o backend e visitor ID, sem persistência.

Não há garantia de cobertura total: bloqueadores, armazenamento indisponível, falhas de rede e recusas reduzem contagens. Não há fila persistente nem reenvio offline. A instrumentação de trailer cobre o player YouTube do slide editorial; vídeos genéricos do conteúdo, links externos e catálogo de obras sem artigo vinculado não são contados como trailers do artigo. Falha da API do player não é convertida em clique fictício.

Agregações SQL parametrizadas usam índices por data/tipo, artigo/data, visitante/data, sessão/data e origem/data, e uma transação RepeatableRead. Não enviam eventos brutos ao painel. Para volume elevado, avaliar agregados diários/HyperLogLog e monitorar custo de COUNT DISTINCT antes de ampliar retenção; esta versão agrega os eventos reais diretamente.

## Validação

`BLOG_TEST_DATABASE=1 node --test test/blogAnalytics.test.js` executa testes em PostgreSQL com fixtures próprias e limpeza restrita aos IDs criados. Cobre autenticação/perfis, origem, consentimento, deduplicação, snapshot público, períodos, hashes e resultados exatos por artigo/navegação. Não substitui validação de reprodução do YouTube em navegador real.
