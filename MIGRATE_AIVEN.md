# Migrar o banco para Aiven

O backend usa Prisma com PostgreSQL. A Aiven exige conexao TLS; use a URL no formato:

```bash
postgresql://avnadmin:SENHA@HOST.aivencloud.com:PORT/defaultdb?sslmode=require
```

## Passo a passo

1. No painel da Aiven, crie um servico **PostgreSQL**.
2. Copie a **Service URI** em **Quick connect**.
3. Crie um arquivo `.env.aiven` a partir de `.env.aiven.example`:

```bash
DATABASE_URL="postgresql://avnadmin:SENHA@HOST.aivencloud.com:PORT/defaultdb?sslmode=require"
```

4. Deixe o `.env` atual apontando para o banco de origem atual da VPS.
5. Rode a migracao:

```bash
npm run db:migrate:aiven
```

O script aplica as migrations do Prisma na Aiven, confere se as tabelas de destino estao vazias e copia os dados preservando os IDs.

## Testar antes de copiar

```bash
npm run db:migrate:aiven -- --dry-run
```

## Criar apenas o schema na Aiven

```bash
npm run db:migrate:aiven -- --schema-only
```

## Depois da migracao

1. Troque `DATABASE_URL` no `.env` local para a URL da Aiven.
2. Troque `DATABASE_URL` na hospedagem do backend para a URL da Aiven.
3. Teste:

```bash
curl http://72.62.8.85:3001/health
```

Se retornar `status: online` e `database: ok`, o backend esta conectado na Aiven.

## Observacoes

- Para evitar perda de dados, pause criacoes/edicoes no sistema durante a copia final.
- Se a Aiven ja tiver dados nas tabelas da aplicacao, o script para antes de copiar.
- A migracao oficial da Aiven para bases grandes usa `aiven-db-migrate` ou `pg_dump`/`pg_restore`. Este projeto tambem tem um script Prisma porque o schema e pequeno e conhecido.
