FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared-engine/package.json ./shared-engine/package.json
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci

COPY shared-engine ./shared-engine
COPY backend ./backend

RUN npm --workspace=@broker/shared run build \
  && node backend/scripts/prepare-prisma.mjs \
  && npm --workspace=@broker/api run build

ENV NODE_ENV=production
ENV PORT=5100

EXPOSE 5100

CMD ["node", "backend/scripts/start-prod.mjs"]
