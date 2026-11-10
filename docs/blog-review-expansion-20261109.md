# Ampliação editorial do Blog — 09/11/2026

## Resultado local confirmado

- 26 artigos existentes atualizados, de um total de 35; nenhum artigo criado ou removido.
- 22 novas referências de mídia/fonte adicionadas, sem remover fontes anteriores. Entre os 26 artigos, 11 permaneceram `published` e 15 permaneceram `demo`.
- 15 análises de séries, HQs e jogos reescritas; 10 apresentações de filmes ampliadas; matéria de Pillion revisada.
- Quatro seções por artigo, com qualidades, limites e orientações de leitura ou exibição. Filmes sustentados apenas por material promocional são identificados como apresentações, sem simular uma crítica após sessão completa.
- 52 imagens intercaladas no corpo: 10 capturas oficiais obtidas da Steam e 42 imagens/capas/pôsteres reaproveitados dos cadastros. Nenhum upload anterior foi removido.
- 26 vídeos distintos, um por artigo, com legenda contextual e link externo de alternativa. Os vídeos das adaptações de HQs estão identificados como adaptações; o curta comemorativo de Superman é identificado como material complementar, sem ser apresentado como adaptação de All-Star Superman.
- Resumos e SEO acompanham a nova redação. Corrigida a direção de Pillion para Harry Lighton conforme a [ficha oficial da A24](https://a24films.com/films/pillion). Removidas afirmações comerciais sem fonte dos títulos e textos ampliados.
- IDs, slugs, autores, vínculos de autor, capas, datas de publicação e status conferidos contra o backup. Cada revisão foi incrementada uma vez. Artigos demonstrativos continuam demonstrativos.
- Snapshots públicos locais atualizados junto das cópias de trabalho. Não houve migração de schema, mudança de permissões ou deploy.
- Os nove guias gerais de tecnologia, conectividade e seleção de conteúdo não foram alterados.

## Arquivos e organização

Seis arquivos novos de produto/operação editorial, nenhum arquivo preexistente alterado ou removido nesta tarefa:

| Caminho relativo à raiz do backend | Finalidade |
| --- | --- |
| `prisma/data/blog-review-expansion-20261109.json` | Texto das 15 análises de obras. |
| `prisma/data/blog-film-expansion-20261109.json` | Texto dos 11 artigos de filmes, incluindo Pillion. |
| `prisma/data/blog-review-media-20261109.json` | Manifesto de capturas, URLs, títulos e canais verificados. |
| `scripts/prepare-review-media.js` | Consulta a Steam e verifica metadados dos vídeos no YouTube; não grava no banco. |
| `scripts/expand-blog-reviews.js` | Gera plano específico do banco, cria backup e atualiza artigos e snapshots em transação serializável. |
| `docs/blog-review-expansion-20261109.md` | Este registro, validação e procedimento de aplicação. |

Não foram criados diretórios de arquitetura novos; os arquivos usam as pastas existentes `prisma/data`, `scripts` e `docs`.

## Aplicação em outro banco

O pacote contém somente redação, manifesto, scripts e esta documentação; não contém `.env`, credenciais, usuários ou dump de banco. Requer o runtime e o Prisma Client já instalados do backend. No destino, execute a partir da raiz do backend:

```sh
node --check scripts/expand-blog-reviews.js
node scripts/expand-blog-reviews.js --plan /caminho/privado/blog-plan.json
node scripts/expand-blog-reviews.js --apply /caminho/privado/blog-plan.json --backup /caminho/privado/blog-backup.json
```

Gere o plano no próprio destino e confira `planned` e `missing`. Nunca use o plano local em produção: ele fica vinculado ao banco de origem. Artigos ausentes são relacionados, não criados. Assim, Pillion não será inserido em produção se continuar ausente. Qualquer diferença nos registros desde o planejamento cancela a operação; todas as alterações são transacionais. Os arquivos de plano e backup são criados sem sobrescrever arquivos existentes.

O backup contém os artigos e suas fontes antes da mudança e deve permanecer privado. Uma restauração precisa conferir revisões atuais para não sobrescrever edições posteriores. A repetição de um plano aplicado é rejeitada; gere novo plano apenas para uma atualização intencional.

Imagens da Steam permanecem em seu CDN; capas e pôsteres existentes são resolvidos a partir do próprio banco de destino. Não copie o plano ou backup local para o servidor. A atualização preserva fotos e identificação do autor congeladas no snapshot público e usa o cadastro atual para localizar as mídias.

## Validações realizadas

- Contrato `validateArticle` aplicado aos 26 artigos antes da gravação.
- Verificação posterior no PostgreSQL: 26 conteúdos e snapshots iguais ao plano, campos preservados e revisões incrementadas uma vez.
- API pública local `/blog/articles`: os 26 conteúdos corresponderam ao plano.
- 52 URLs de imagem: HTTP 200 e MIME de imagem.
- 26 vídeos: metadados oEmbed obtidos com sucesso; títulos e canais registrados. Isso não garante reprodução em toda região ou dispositivo.
- Páginas locais de Arcane, Portal 2 e Toy Story 5: HTTP 200, títulos de seção, imagens e iframe de vídeo presentes no HTML.
- `node --check` nos dois scripts: aprovado.
- `node --test test/blogRichContent.test.js test/blogManagement.test.js`: 7 aprovados, 0 falhas, 1 integração ignorada porque o banco de testes dedicado não está configurado.
- A conferência inicial após a transação acusou uma diferença de serialização: JSONB reorganiza chaves de objetos. O comparador foi corrigido para comparação canônica, e a igualdade dos valores de todos os 26 artigos foi conferida com `assert.deepEqual`; a transação não foi reaplicada.
- Build e lint global não executados: não houve alteração da aplicação ou de estilos e não existe script de lint/build no backend. Não houve revisão visual em navegador: a ferramenta interrompeu acesso por não conseguir identificar a URL do Chrome com segurança.

## Produção: pendente de autenticação

A API pública de produção respondeu com 34 artigos durante a inspeção. Nenhuma alteração foi aplicada ao banco remoto. O SSH recusou autenticação (`Permission denied (publickey,password)`) e a ferramenta de navegação não conseguiu confirmar uma sessão autenticada. É necessário acesso válido ao servidor/painel para concluir a aplicação autorizada e, depois, conferir a API e o site hospedados.

Backups e planos locais ficam em `.codex-deploy/private/`, fora do Git. Há um backup dos 35 artigos antes da preparação e outro dos 26 registros imediatamente antes da aplicação. O pacote ZIP nesse diretório inclui apenas os seis arquivos listados, sem esses backups.

Foram gerados cinco artefatos privados locais, além dos seis arquivos listados acima (11 arquivos criados no total, nenhum preexistente alterado ou removido):

- [Backup inicial dos 35 artigos](../../.codex-deploy/private/blog-before-expansion-20261109.json).
- [Primeiro plano, superado e não aplicado](../../.codex-deploy/private/blog-expansion-plan-20261109.json).
- [Plano local aplicado, mantido como registro](../../.codex-deploy/private/blog-expansion-plan-20261109-v2.json).
- [Backup dos 26 artigos antes da transação](../../.codex-deploy/private/blog-expansion-backup-20261109.json).
- [Pacote editorial sem credenciais ou backups](../../.codex-deploy/private/blog-review-expansion-20261109.zip).

## Identidade visual, identificação e CSS

Reutilizados `RichContent`, `RichContent.module.css` e o contrato seguro de documento já existente. As mídias ocupam 100% da largura do conteúdo, centralizadas, com textos alternativos e contexto. Nenhuma classe, ID, ícone, animação ou interação de interface foi criada ou removida. Não houve alteração de CSS nem novos conflitos de estilo identificados nesta tarefa. Não se aplica introduzir uma referência de abas a uma atualização de conteúdo.

## Fontes das mídias

Capturas: páginas oficiais dos jogos na Steam. Vídeos: links e metadados no manifesto. Desenvolvimento de Stardew Valley: [press kit oficial](https://www.stardewvalley.net/press/). Pillion: [A24](https://a24films.com/films/pillion). As fontes anteriores dos artigos foram preservadas e os novos materiais promocionais receberam o papel `promotional`, sem serem tratados como prova de alegações comerciais.
