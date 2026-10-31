# BlockTrade — Production deployment runbook

## 1. Environment
- Server: copy `server/.env.example` → `server/.env` and fill:
  - `JWT_SECRET` — long random string (required in production)
  - `SENTRY_DSN` — Sentry project DSN (optional)
  - `SENTRY_TRACES_SAMPLE_RATE` — optional (default 0.1)
  - `CLIENT_ORIGIN` — https origin of frontend
  - `PORT` — API port (default 5000)
  - `DB_PROVIDER` notes: SQLite for dev; move to Postgres for production (see §3).

## 2. Install PM2
```bash
npm install -g pm2
cd Blockchain_PaperTrade-main
pm2 start server/ecosystem.config.js --env production
pm2 save
pm2 startup        # boot script for the OS
```

## 3. Database — Postgres migration (from SQLite)
Current dev datasource: `sqlite` (`server/prisma/dev.db`).
For production:
1. Provision Postgres and set `DATABASE_URL="postgresql://user:pass@localhost:5432/blocktrade"` in `server/.env`.
2. Update `server/prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Generate + apply:
   ```bash
   npx prisma migrate dev --name init_postgres   # or: npx prisma db push
   npx prisma generate
   ```
4. Run data migration scripts in `server/scripts/` if present; otherwise dump/restore from the SQLite dev DB.

## 4. Nginx reverse proxy + TLS
- Copy `deploy/nginx/blocktrade.conf` → `/etc/nginx/sites-available/blocktrade`
- `ln -s /etc/nginx/sites-available/blocktrade /etc/nginx/sites-enabled/blocktrade`
- Obtain TLS (certbot) and reload nginx.
- WebSocket proxying already configured for `/socket.io/`.

## 5. Process supervision
- PM2 runs `server/server.js`; graceful shutdown flushes Sentry then exits.
- Health check: `GET /api/system/health`.

## 6. Monitoring
- Sentry: server (`@sentry/node` + `Sentry.setupExpressErrorHandler`) and client (`@sentry/react` in `main.jsx` + `ErrorBoundary`).
- Server logs: pino → stdout; PM2 captures to `logs/blocktrade-api-*.log`.

## 7. Verify
- `pm2 logs blocktrade-api`
- `curl -f http://localhost:5000/api/system/health`
