Criar estrutura de pastas

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