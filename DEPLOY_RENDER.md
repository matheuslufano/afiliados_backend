# Publicacao do backend na VPS

Este backend e um app Express com Prisma/Postgres. Em producao, o frontend na Vercel deve falar com a API HTTP rodando na VPS em `http://72.62.8.85:3001`.

## 1. Antes de publicar

1. Garanta que a VPS tenha Node.js, npm e acesso ao banco configurado em `DATABASE_URL`.
2. Garanta que a porta `3001` esteja liberada no firewall da VPS.
3. Tenha em maos as credenciais do SGP.

## 2. Entrar na VPS

Entre por SSH:

```bash
ssh netbox@72.62.8.85
```

Depois atualize o projeto e instale dependencias:

```bash
npm ci
npm run db:migrate:deploy
npm start
```

Em producao, prefira manter o app com PM2 ou systemd.

## 3. Variaveis de ambiente

Configure o `.env` do backend na VPS:

```bash
PORT=3001
APP_URL=http://72.62.8.85:3001
LANDING_PAGE_URL=https://SUA-LANDING-WORDPRESS.com/express
DEFAULT_USER_ID=1
WHATSAPP_URL=https://api.whatsapp.com/send/?phone=55008006022732&text&type=phone_number&app_absent=0
CHATMIX_WEBHOOK_SECRET=um-segredo-forte
SGP_BASE_URL=https://SEU-SGP.com.br
SGP_APP=nome_da_aplicacao_do_sgp
SGP_TOKEN=token_gerado_no_sgp
SGP_WEBHOOK_SECRET=segredo_para_chamar_as_rotas_sgp
SGP_DEFAULT_MODE=precadastro
```

A API usa o host da requisicao para gerar os links publicos e usa `APP_URL` como fallback quando nao conseguir inferir esse host. Use `LANDING_PAGE_URL` para deixar o painel e o backend criarem links direto para a landing WordPress.

## 4. Atualizar o frontend

No deploy do frontend na Vercel, configure:

```bash
BACKEND_URL=http://72.62.8.85:3001
NEXT_PUBLIC_API_URL=/api-backend
NEXT_PUBLIC_LANDING_PAGE_URL=https://SUA-LANDING-WORDPRESS.com/express
```

Depois teste:

```bash
curl http://72.62.8.85:3001/health
curl http://72.62.8.85:3001/integrations/sgp/status
```

Se `/health` retornar `status: online` e `database: ok`, a API esta de pe. Se `/integrations/sgp/status` retornar `configured: true`, a comunicacao com o SGP esta configurada.
