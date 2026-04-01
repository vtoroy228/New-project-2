# Deployment Guide

## Production Goal

One public URL, one backend process:

- `https://your-domain/` serves frontend
- `https://your-domain/api/*` serves backend API

No CORS and no `localhost` in production API calls.

## 1. Environment Variables

Required:

- `NODE_ENV=production`
- `PORT=3000`
- `HOST=0.0.0.0`
- `DATABASE_URL=postgresql://...`
- `TELEGRAM_BOT_TOKEN=...`
- `ADMIN_TELEGRAM_IDS=...`

Optional (dev only, should be false/omitted in prod):

- `DEV_MOCK_TELEGRAM=false`
- `VITE_DEV_MOCK_TELEGRAM=false`
- `AUTH_DEBUG_LOGS=false`

## 2. Build Docker Image

From project root:

```bash
docker build -t telegram-dino .
```

## 3. Run Container

```bash
docker run -p 3000:3000 --env-file .env telegram-dino
```

The app now listens on `:3000` and serves frontend + API together.

## 4. Database Migrations (Prod)

Before traffic cutover, run migrations against the target database:

```bash
npx prisma migrate deploy --schema backend/prisma/schema.prisma
```

Or run migration command in your CI/CD pipeline before deployment.

## 5. Telegram WebApp Setup

In BotFather, set Mini App URL to your HTTPS domain root.

Example:

- `https://miniapp.example.com`

## 6. Optional Nginx Reverse Proxy

You can run Nginx in front of the Fastify container:

- terminate TLS in Nginx
- proxy all requests to `http://app:3000`

Routing remains unchanged:

- `/api/*` -> Fastify API
- everything else -> Fastify static SPA fallback

## 7. Smoke Test Checklist

1. `GET /` returns `index.html`
2. `GET /api/leaderboard/global` returns JSON
3. `POST /api/auth/validate` with Telegram `Authorization: tma <initData>` returns user
4. Game over submits `POST /api/game/result`
5. Leaderboard top-10 and pinned "you" row update

## 8. Cloudflared for Temporary HTTPS During QA

```bash
cloudflared tunnel --url http://localhost:3000
```

Use the generated `https://*.trycloudflare.com` URL in BotFather for testing.

## 9. One-command Server Deploy in Docker + xtunnel Watchdog

Repository now includes:

- `docker-compose.app.yml` for app container
- `ops/deploy-server.sh` for end-to-end deploy
- `ops/xtunnel-watchdog.sh` for periodic tunnel restart
- `ops/xtunnel-service.sh` for start/stop/status management

### Prepare `.env` on server

Mandatory for Docker networking:

```bash
DATABASE_URL=postgresql://postgres:postgres@db:5432/telegram_dino?schema=public
APP_PORT=3000
```

xtunnel watchdog tuning:

```bash
XTUNNEL_ENABLED=true
XTUNNEL_BIN=xtunnel
XTUNNEL_PROTOCOL=http
XTUNNEL_PORT=3000
XTUNNEL_FORCE=true
XTUNNEL_LICENSE_KEY=YOUR_LICENSE_KEY
XTUNNEL_EXTRA_ARGS=
XTUNNEL_RESTART_MODE=daily
XTUNNEL_RESTART_DAILY_AT=04:00
XTUNNEL_RESTART_TIMEZONE=
# For daily mode: restart only after 3 minutes without tunnel activity
XTUNNEL_DAILY_RESTART_IDLE_SECONDS=180
# File checked for recent activity before daily restart
XTUNNEL_DAILY_RESTART_ACTIVITY_FILE=./logs/xtunnel.log
# Used only when XTUNNEL_RESTART_MODE=interval
XTUNNEL_RESTART_EVERY_MINUTES=180
XTUNNEL_RESTART_DELAY_SECONDS=5
XTUNNEL_LOG_FILE=./logs/xtunnel.log
XTUNNEL_SUPERVISOR_LOG_FILE=./logs/xtunnel-watchdog.log
XTUNNEL_WATCHDOG_PID_FILE=./.run/xtunnel-watchdog.pid
```

With this config, planned restart is checked once per day at `04:00` (server local timezone),
but actual restart happens only after at least 3 minutes of inactivity in
`XTUNNEL_DAILY_RESTART_ACTIVITY_FILE`.

This builds a command like:

```bash
xtunnel http 3000 --force --license YOUR_LICENSE_KEY
```

Optional full command override (if needed):

```bash
XTUNNEL_COMMAND="xtunnel http 3000 --force --license YOUR_LICENSE_KEY"
```

### Optional: restart xtunnel from Telegram admin bot

```bash
TELEGRAM_ADMIN_XTUNNEL_RESTART_ENABLED=true
TELEGRAM_ADMIN_XTUNNEL_RESTART_COMMAND="bash ./ops/xtunnel-service.sh restart"
TELEGRAM_ADMIN_XTUNNEL_RESTART_TIMEOUT_MS=45000
TELEGRAM_ADMIN_XTUNNEL_RESTART_CONFIRMATION="RESTART XTUNNEL"
TELEGRAM_ADMIN_BOT_POLL_TIMEOUT_SECONDS=25
TELEGRAM_ADMIN_BOT_POLL_REQUEST_TIMEOUT_MS=45000
```

After backend restart, admin panel gets button `🔁 Перезапустить xtunnel` with manual confirmation.
`TELEGRAM_ADMIN_XTUNNEL_RESTART_COMMAND` must be executable from the backend runtime context.
If network is slow, increase `TELEGRAM_ADMIN_BOT_POLL_REQUEST_TIMEOUT_MS` to 60000.

### Deploy everything with one command

```bash
npm run deploy:server
```

What this command does:

1. Starts Postgres container and waits for healthcheck
2. Builds app image
3. Runs `prisma migrate deploy`
4. Starts app container
5. Restarts xtunnel watchdog (if enabled)

### Manual tunnel controls

```bash
npm run xtunnel:start
npm run xtunnel:status
npm run xtunnel:restart
npm run xtunnel:stop
```

Logs:

- tunnel stdout/stderr: `logs/xtunnel.log`
- watchdog lifecycle: `logs/xtunnel-watchdog.log`
