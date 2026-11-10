# Temas comemorativos — painel, Blog e site institucional

Implementação local de 09/11/2026: **27 arquivos, sendo 13 criados e 14 alterados; nenhum removido**. Os arquivos editoriais da tarefa anterior foram preservados e não entram nesta contagem. Não houve publicação remota.

## A. Funcionamento

Em `http://localhost:3000/integracoes/blog`, abra **Temas comemorativos**. Escolha **Blog** ou **Site institucional**, selecione a ocasião, ajuste **Ativar tema** e pressione **Salvar alterações**. Cada destino tem sua configuração persistida no PostgreSQL. Ambos começam desativados. As datas são referências: não há ativação automática por calendário. Desative a qualquer momento para remover as decorações.

São 13 presets: Natal, Ano Novo, Carnaval, Dia da Mulher, Páscoa, Dia das Mães, Dia dos Namorados, Festas Juninas, Dia dos Pais, Independência do Brasil, Dia das Crianças, Halloween e Black Friday. Cada um possui paleta, mensagem e efeito próprios.

O Natal tem neve suave pela janela, sem capturar cliques, boneco SVG original acenando acima do rodapé e neve nas duas laterais. Outros presets usam estrelas, confetes, corações, pétalas, ovos, morcegos ou bandeirinhas. Os temas preservam artigos, ofertas, formulários, navegação, créditos e seus efeitos existentes.

Páginas abertas consultam alterações a cada 30 segundos enquanto visíveis e também ao retornar à aba. Falhas da API deixam as decorações desativadas até a próxima consulta bem-sucedida.

## B. Prévia e permissões

A prévia usa o site real em iframe, simulando desktop de 1280 px ajustado ao espaço disponível ou celular de até 390 px. Inclui controles para ir ao rodapé, recarregar e abrir em outra aba. O parâmetro `?previewTheme=<preset>` ou `?previewTheme=none` afeta apenas a página aberta e não salva nada. Nenhum token administrativo é enviado ao iframe.

Usuários autenticados podem consultar e experimentar a prévia. Somente ADMIN/MANAGER podem salvar. Revisões impedem sobrescrever alterações concorrentes: conflito retorna 409. Recarregar a configuração descarta as seleções ainda não salvas. A prévia de temas não contabiliza visitas ou eventos nas métricas do Blog.

## C. Banco, rotas e operação

| Contrato | Comportamento |
| --- | --- |
| `GET /site/themes` | Catálogo fixo e configurações públicas, sem cache. |
| `GET /admin/blog/themes` | Leitura autenticada e indicação `canManage`. |
| `PUT /admin/blog/themes/:scope` | ADMIN/MANAGER; recebe `themeId`, `enabled` e `revision`. |
| `GET /api/site-themes` | Proxy do institucional; lê `BLOG_API_URL`, usa timeout e retorna 503 em falhas. |

Escopos: `blog` e `institutional`. O novo modelo `SiteThemeSetting` contém escopo, preset, ativação, revisão e atualização. Ler não cria registros; os defaults permanecem desativados. A migração aditiva `20261109180000_site_seasonal_themes` foi aplicada somente ao banco local. Nenhuma tabela editorial foi alterada.

Local: painel 3000, backend 3001 e institucional 3002. `NEXT_PUBLIC_BLOG_SITE_URL=http://localhost:3002` já estava configurada. O institucional reutiliza `BLOG_API_URL`. Em outro ambiente, aplicar a migração, gerar o Prisma Client, reiniciar o backend e implantar ambos os frontends. Não há dependências nem segredos novos.

A geração inicial do Prisma encontrou `EPERM` na substituição da DLL em uso no Windows. O novo modelo foi gerado e o backend recarregou; consultas reais, rotas e testes funcionaram. Não foi afirmado sucesso do comando de geração completo. A migração foi aplicada e seu status é verificado separadamente.

## D. Organização, identificação e identidade visual

Novas pastas: `components/themes` no painel e `components/shared/seasonal` no institucional. Os estilos novos ficam nos respectivos `ThemeSettings.module.css` e `SeasonalTheme.module.css`. As abas reutilizam seu `Analytics.module.css`, com ajuste para telas pequenas e navegação por setas, Home e End.

Classes principais do painel: `settings`, `destination`, `activation`, `save`, `workspace`, `catalog`, `themeCard`, `themeIcon`, `description`, `preview`, `previewStage`, `previewControls`, `error` e `notice`. Classes dos efeitos: `overlay`, `particle`, `motionToggle`, `previewIndicator`, `footerScene`, `greeting`, `winterArtwork`, `snowman`, `wavingArm`, `snowbankLeft`, `snowbankRight` e `festiveBorder`.

Há variáveis locais para paletas e partículas, propriedades comuns compartilhadas e variantes por atributos. Não foram criados estilos globais genéricos, `!important` ou classes sucessivas de correção. Nenhuma classe existente foi removida e não foram identificados conflitos novos na revisão estática.

IDs estáveis: `blog-tab-themes`, `blog-panel-themes`, `blog-theme-settings`, `theme-scope-blog`, `theme-scope-institutional`, `theme-enabled-toggle`, `theme-save-settings`, `seasonal-theme-catalog`, `seasonal-theme-<preset>`, `seasonal-theme-preview`, `seasonal-theme-preview-frame`, `seasonal-screen-decoration`, `seasonal-motion-toggle` e `seasonal-footer-decoration`. Há uma sobreposição e uma cena de rodapé por documento; o iframe é outro documento. `data-component`, `data-theme`, `data-effect` e `data-paused` permitem inspeção. Partículas decorativas não recebem IDs desnecessários.

Ícones da biblioteca existente `react-icons/lu`. SVG e CSS próprios para o boneco e os efeitos. Transições suaves nos controles; movimento por transform; menos partículas no celular. `prefers-reduced-motion` remove neve e aceno, e há botão manual de pausa. Decorações não capturam cliques e são ocultadas na impressão. As atribuições do rodapé e seu hover foram preservados.

Referências: [CSS Snow Effects](https://freefrontend.com/css-snow-effects/#snow-pure-css-l) e [CSS Tabs](https://freefrontend.com/css-tabs/). As coleções foram consultadas; os CodePens vinculados retornaram erros de acesso ou limite. O código foi implementado no projeto, sem copiar trechos indisponíveis.

## E. Validação real

- Backend: 3 testes aprovados, incluindo HTTP e PostgreSQL em schema temporário isolado, removido ao terminar. Cobrem presets, defaults, autorização 401/403, escopos independentes, persistência, conflitos 409 e desativação. Nenhum tema público local foi ativado para testar.
- Institucional: 23 testes aprovados em `npm test`, incluindo prévia sem identificação ou eventos de analytics.
- TypeScript: `tsc --noEmit` aprovado nos dois frontends.
- ESLint: zero erros nos arquivos afetados; os rodapés/layout institucionais mantêm 10 avisos anteriores sobre `img`. Os novos componentes e o serviço de analytics passaram sem avisos.
- Builds finais Next.js e Vinext aprovados. Vinext mantém seus avisos de classificação de rotas e tempo dos plugins.
- `node --check` aprovado para serviço, controller e rotas do backend.
- HTTP: painel, API pública, proxy e URLs de prévia do Blog e institucional responderam 200. A API retornou os 13 presets e os dois destinos desativados.
- HTTP 200 do painel não confirma a renderização autenticada, pois a autenticação é aplicada no cliente.
- Revisão visual não realizada: o host de acesso ao navegador estava indisponível e nenhuma janela navegável foi exposta. Não foi afirmada aceitação visual em desktop/mobile nem validação dos cliques na sessão do usuário.
- Sem deploy, migração remota ou ativação em produção.

## F. Arquivos e linhas individuais

Os links abaixo contêm o caminho absoluto real e a primeira linha relevante de cada arquivo. Não foram inventados links de repositório remoto.

| Arquivo | Situa??o | Altera??o e finalidade |
| --- | --- | --- |
| [afiliados-backend/prisma/schema.prisma](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados-backend/prisma/schema.prisma:525>) | alterado | Modelo por destino, com ativação, tema e revisão. |
| [afiliados-backend/prisma/migrations/20261109180000_site_seasonal_themes/migration.sql](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados-backend/prisma/migrations/20261109180000_site_seasonal_themes/migration.sql:1>) | criado | Tabela aditiva restrita a Blog e institucional. |
| [afiliados-backend/src/services/siteThemes.js](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados-backend/src/services/siteThemes.js:2>) | criado | Catálogo de 13 ocasiões e validação dos presets. |
| [afiliados-backend/src/controllers/siteThemeController.js](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados-backend/src/controllers/siteThemeController.js:1>) | criado | Leitura pública e atualização transacional com revisão. |
| [afiliados-backend/src/routes/siteThemeRoutes.js](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados-backend/src/routes/siteThemeRoutes.js:1>) | criado | Rotas públicas e autenticadas; gravação por ADMIN/MANAGER. |
| [afiliados-backend/src/app.js](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados-backend/src/app.js:53>) | alterado | Registro das rotas de temas. |
| [afiliados-backend/test/siteThemes.test.js](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados-backend/test/siteThemes.test.js:1>) | criado | Validação e HTTP/PostgreSQL em schema temporário isolado. |
| [afiliados-backend/README.md](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados-backend/README.md:3>) | alterado | Instruções de migração e link para o contrato. |
| [afiliados-backend/docs/site-seasonal-themes.md](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados-backend/docs/site-seasonal-themes.md:1>) | criado | Documentação funcional, técnica e relatório individual. |
| [afiliados_netbox/src/app/integracoes/blog/page.tsx](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados_netbox/src/app/integracoes/blog/page.tsx:20>) | alterado | Terceiro painel, montado na primeira abertura. |
| [afiliados_netbox/src/app/integracoes/blog/components/ManagementTabs.tsx](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados_netbox/src/app/integracoes/blog/components/ManagementTabs.tsx:2>) | alterado | Nova aba e navegação circular por teclado. |
| [afiliados_netbox/src/app/integracoes/blog/components/analytics/Analytics.module.css](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados_netbox/src/app/integracoes/blog/components/analytics/Analytics.module.css:17>) | alterado | Abas existentes com rolagem em telas pequenas. |
| [afiliados_netbox/src/app/integracoes/blog/components/themes/themeApi.ts](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados_netbox/src/app/integracoes/blog/components/themes/themeApi.ts:1>) | criado | Tipos e acesso à API autenticada existente. |
| [afiliados_netbox/src/app/integracoes/blog/components/themes/ThemeSettings.tsx](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados_netbox/src/app/integracoes/blog/components/themes/ThemeSettings.tsx:1>) | criado | Seleção, ativação, salvamento e prévia real. |
| [afiliados_netbox/src/app/integracoes/blog/components/themes/ThemeSettings.module.css](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados_netbox/src/app/integracoes/blog/components/themes/ThemeSettings.module.css:1>) | criado | CSS exclusivo da configuração, responsivo e acessível. |
| [afiliados_netbox/src/app/integracoes/blog/README.md](<D:/programas/Projetos de programação/Afiliados Netbox/afiliados_netbox/src/app/integracoes/blog/README.md:3>) | alterado | Uso da aba, origem da prévia e permissões. |
| [Site institucional - Netbox/app/layout.tsx](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/app/layout.tsx:2>) | alterado | Provedor compartilhado nas páginas públicas. |
| [Site institucional - Netbox/app/api/site-themes/route.ts](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/app/api/site-themes/route.ts:1>) | criado | Proxy sem cache, com timeout e falha explícita. |
| [Site institucional - Netbox/components/shared/seasonal/SeasonalThemeProvider.tsx](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/components/shared/seasonal/SeasonalThemeProvider.tsx:1>) | criado | Escopo por rota, prévia, atualização em 30 s, partículas e pausa. |
| [Site institucional - Netbox/components/shared/seasonal/SeasonalFooter.tsx](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/components/shared/seasonal/SeasonalFooter.tsx:1>) | criado | Boneco de neve SVG, aceno, neve lateral e faixa comemorativa. |
| [Site institucional - Netbox/components/shared/seasonal/SeasonalTheme.module.css](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/components/shared/seasonal/SeasonalTheme.module.css:1>) | criado | CSS dos efeitos, rodapé, redução de movimento e impressão. |
| [Site institucional - Netbox/components/site/home/HomeFooter.tsx](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/components/site/home/HomeFooter.tsx:7>) | alterado | Cena acima do rodapé da página inicial. |
| [Site institucional - Netbox/components/site/layout/SiteLayout.tsx](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/components/site/layout/SiteLayout.tsx:5>) | alterado | Cena acima do rodapé das páginas institucionais. |
| [Site institucional - Netbox/components/blog/layout/Footer.tsx](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/components/blog/layout/Footer.tsx:6>) | alterado | Cena acima do rodapé editorial. |
| [Site institucional - Netbox/lib/blog/analytics.ts](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/lib/blog/analytics.ts:32>) | alterado | Prévia de temas excluída da coleta de eventos. |
| [Site institucional - Netbox/__tests__/blog/analytics.test.mjs](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/__tests__/blog/analytics.test.mjs:65>) | alterado | Regressão: prévia não cria identidade nem contabiliza visita. |
| [Site institucional - Netbox/README.md](<D:/programas/Projetos de programação/Afiliados Netbox/Site institucional - Netbox/README.md:3>) | alterado | Configuração de API e descrição da prévia. |
