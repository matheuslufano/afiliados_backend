FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json prisma.config.ts ./
COPY prisma ./prisma

RUN npm ci --omit=dev --ignore-scripts

COPY src ./src
COPY api ./api
COPY scripts ./scripts

EXPOSE 3001

CMD ["npm", "start"]
