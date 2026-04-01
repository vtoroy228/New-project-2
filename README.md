# Telegram Dino Mini App

Single-domain Telegram Mini App game (Chrome Dino runner clone) with Fastify + Prisma backend and React + Canvas frontend.

## Stack

- Backend: Node.js 20+, TypeScript, Fastify, Prisma, PostgreSQL
- Frontend: React, TypeScript, Vite, Canvas
- Infra: Docker Compose (local DB), Dockerfile (single app container)

## Local Dev

1. Create env file:

```bash
cp .env.example .env
```

2. Start PostgreSQL:

```bash
docker-compose up -d db
```

3. Install dependencies:

```bash
npm install
```

4. Generate Prisma client:

```bash
npm run prisma:generate
```

5. Run migrations:

```bash
npm run prisma:migrate
```

6. Start frontend + backend:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Frontend requests only same-origin style paths (`/api/...`) and uses Vite proxy in dev.

Optional browser-only local auth (outside Telegram):

```bash
DEV_MOCK_TELEGRAM=true VITE_DEV_MOCK_TELEGRAM=true npm run dev
```

## Production Run

```bash
npm run build
npm run start
```

Backend serves:

- `/api/*` API
- `/` static frontend (`frontend/dist`)
- SPA fallback for non-API routes

## Docker (Single Domain)

```bash
docker build -t telegram-dino .
docker run -p 3000:3000 --env-file .env telegram-dino
```

## One-command Server Deploy (Docker + xtunnel)

Scripts for production deployment and tunnel stability:

- `npm run deploy:server` - deploy app and restart xtunnel watchdog
- `npm run xtunnel:start|stop|restart|status` - tunnel process controls

Before first deploy on server, use Docker-internal DB host:

```bash
DATABASE_URL=postgresql://postgres:postgres@db:5432/telegram_dino?schema=public
```

Minimal xtunnel watchdog config:

```bash
XTUNNEL_BIN=xtunnel
XTUNNEL_PROTOCOL=http
XTUNNEL_PORT=3000
XTUNNEL_FORCE=true
XTUNNEL_LICENSE_KEY=YOUR_LICENSE_KEY
XTUNNEL_RESTART_MODE=daily
XTUNNEL_RESTART_DAILY_AT=04:00
XTUNNEL_DAILY_RESTART_IDLE_SECONDS=180
```

This means restart check once per day at 04:00 (server local timezone),
and actual restart only after 3 minutes without tunnel activity.

This maps to command style:

```bash
xtunnel http 3000 --force --license YOUR_LICENSE_KEY
```

Default extended config is in `.env.example`.

## Telegram Auth Behavior

- In Telegram WebApp: `initData` is required and sent as `Authorization: tma <initData>`.
- App calls `POST /api/auth/validate` at startup and stores validated user in UI state.
- Guest/mock mode works only outside Telegram and only if `VITE_DEV_MOCK_TELEGRAM=true`.
- If Telegram WebApp exists but `initData` is empty, app shows explicit error and does not fallback to guest.
- `TELEGRAM_AUTH_MAX_AGE_SECONDS` (default `300`) limits how old `auth_date` can be.
- `TELEGRAM_VERIFY_CACHE_TTL_MS` and `TELEGRAM_VERIFY_CACHE_MAX_ENTRIES` control auth verify cache.

## Cloudflared (when ngrok unavailable)

Single-domain test URL:

```bash
cloudflared tunnel --url http://localhost:3000
```

Optional direct Vite URL:

```bash
cloudflared tunnel --url http://localhost:5173
```

`frontend/vite.config.ts` already sets `server.allowedHosts: true`.

## Theming / Assets

- Theme tokens (single file): `frontend/src/ui/theme/tokens.ts`
- Font placeholder: `frontend/public/assets/fonts/Trigram.woff2`
- Sound placeholders:
  - `frontend/public/assets/sounds/jump.mp3`
  - `frontend/public/assets/sounds/fireworks.mp3`
  - `frontend/public/assets/sounds/bgm.mp3`
  - replace these files with your own audio files (keep same names/paths)
- Skin config and sprites:
  - `frontend/src/game/skins/default/skin.json`
  - `frontend/src/game/skins/default/*.svg`

## API Summary

- `POST /api/auth/validate`
- `GET /api/auth/me`
- `POST /api/game/result`
- `GET /api/leaderboard/global`
- `POST /api/admin/ban-user`
- `POST /api/admin/unban-user`
- `POST /api/admin/reset-leaderboard`
- `POST /api/admin/restore-leaderboard`
- `GET /healthz`
- `GET /readyz`

## Backend Resilience Notes

- In-memory per-IP rate limits are enabled for auth/game/leaderboard/admin routes.
- `POST /api/game/result` is idempotent by `(userId, sessionId)`.
- Global leaderboard top/total is cached in-memory (`LEADERBOARD_CACHE_TTL_MS`).
- Graceful shutdown + readiness/liveness probes are enabled.
  - Apply DB schema update before use:

```bash
npm run prisma:migrate
```

## Admin Reset (without initData copy)

Local terminal reset command:

```bash
npm run admin:reset-leaderboard
```

This resets `bestScore` to `0` for all users.

Safety:
- in `NODE_ENV=production` the script is blocked by default
- to allow it explicitly set `ALLOW_PROD_LEADERBOARD_RESET=true`

## Telegram Bot Admin Panel (Hidden)

Backend can run an admin panel directly in Telegram bot chat (long polling).

Env flags:

```bash
TELEGRAM_ADMIN_BOT_ENABLED=true
ADMIN_TELEGRAM_IDS=123456789,987654321
TELEGRAM_ADMIN_HIDDEN_COMMAND=/__admin
TELEGRAM_ADMIN_BOT_AUTO_DELETE_WEBHOOK=false
TELEGRAM_ADMIN_XTUNNEL_RESTART_ENABLED=true
TELEGRAM_ADMIN_XTUNNEL_RESTART_COMMAND="bash ./ops/xtunnel-service.sh restart"
TELEGRAM_ADMIN_XTUNNEL_RESTART_TIMEOUT_MS=45000
TELEGRAM_ADMIN_XTUNNEL_RESTART_CONFIRMATION="RESTART XTUNNEL"
TELEGRAM_ADMIN_BOT_POLL_TIMEOUT_SECONDS=25
TELEGRAM_ADMIN_BOT_POLL_REQUEST_TIMEOUT_MS=45000
```

`TELEGRAM_ADMIN_XTUNNEL_RESTART_COMMAND` should be executable from where backend process is running.
If long-poll timeout logs still appear, increase `TELEGRAM_ADMIN_BOT_POLL_REQUEST_TIMEOUT_MS` to `60000`.

How it works:
- panel is available only in private chat and only for users from `ADMIN_TELEGRAM_IDS`
- panel opens only after sending hidden command `TELEGRAM_ADMIN_HIDDEN_COMMAND`
- optional: set `TELEGRAM_ADMIN_BOT_AUTO_DELETE_WEBHOOK=true` to auto-disable webhook for polling mode
- command is not auto-published in visible UI menus by this app
- available actions:
   - leaderboard reset with manual confirmation (enter current max score)
   - leaderboard restore from latest backup with manual confirmation
   - manual bestScore update by `@username` or `telegramId`
   - view last 15 game results
   - manual xtunnel restart (`🔁 Перезапустить xtunnel`) with confirmation phrase
   - manual bestScore rebuild from `GameResult`
      - rebuild uses only runs from current leaderboard epoch (after the latest reset)

## Readable Logs

Backend logs are configurable with env vars:

```bash
LOG_LEVEL=info
LOG_PRETTY=true
LOG_REQUESTS=true
AUTH_DEBUG_LOGS=false
```

- `LOG_PRETTY=true` enables human-readable one-line logs (recommended for dev/ops terminal).
- `LOG_PRETTY=false` switches back to JSON logs.
- `LOG_REQUESTS=false` disables automatic per-request access logs.
- `AUTH_DEBUG_LOGS=true` enables verbose auth debug traces in development only.

## Manual Verification Plan

1. Browser dev mode (`VITE_DEV_MOCK_TELEGRAM=true`, outside Telegram):
   - app enters mock user mode
   - game runs, settings persist after reload
   - volume slider does not break UI
2. Telegram WebApp mode:
   - real user shown in header (not Guest)
   - `POST /api/auth/validate` returns 200
   - requests include `Authorization: tma ...`
3. Game controls and feedback:
   - jump plays sound (`jump.mp3`) when volume > 0
   - game over triggers haptic when vibration enabled
   - new local high score shows confetti + `fireworks.mp3` + success haptic
   - background music has separate toggle button (`♫`), default music loudness = 50% of SFX volume
4. Layout checks:
   - TIME / SCORE / HI always in one row on narrow screen
   - canvas uses max available area (no large empty block)
   - settings sheet opens only by settings button
5. Leaderboard:
   - after first saved game, pinned `Вы` row shows rank and score
   - top list scrolls, `Вы` row stays visible
