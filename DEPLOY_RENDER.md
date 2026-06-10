# Migracao do backend para Render

Este backend e um app Express com Prisma/Postgres. A configuracao em `render.yaml` cria um Web Service gratuito no Render, roda as migrations do Prisma antes de iniciar e usa `/health` como health check.

## 1. Antes de publicar

1. Troque a senha do banco que apareceu no arquivo `api/index.js`. Ela foi removida do codigo, mas se ja foi commitada ou compartilhada, trate como vazada.
2. Garanta que o repo do backend esteja no GitHub/GitLab/Bitbucket.
3. Tenha em maos a `DATABASE_URL` do Postgres atual.

## 2. Criar o servico

1. Entre em <https://dashboard.render.com>.
2. Clique em **New > Blueprint** e selecione o repositorio do backend.
3. Quando o Render pedir `DATABASE_URL`, cole a string do banco.
4. Confirme o deploy.

O Render vai executar:

```bash
npm ci
npm run db:migrate:deploy
npm start
```

## 3. Variaveis opcionais

Depois do primeiro deploy, abra **Environment** no servico e adicione apenas as que voce usa:

```bash
APP_URL=https://SEU-SERVICO.onrender.com
DEFAULT_USER_ID=1
WHATSAPP_URL=https://api.whatsapp.com/send/?phone=55008006022732&text&type=phone_number&app_absent=0
CHATMIX_WEBHOOK_SECRET=um-segredo-forte
```

Use `APP_URL` para fixar a URL publica usada na geracao de links. Se ela ficar vazia, a API tenta inferir a URL pelo host da requisicao.

## 4. Atualizar o frontend

No deploy do frontend, configure:

```bash
NEXT_PUBLIC_API_URL=https://SEU-SERVICO.onrender.com
```

Depois teste:

```bash
curl https://SEU-SERVICO.onrender.com/health
```

Se retornar `status: online` e `database: ok`, a API esta de pe.
