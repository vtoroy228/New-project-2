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

## Telegram Auth Behavior

- In Telegram WebApp: `initData` is required and sent as `Authorization: tma <initData>`.
- App calls `POST /api/auth/validate` at startup and stores validated user in UI state.
- Guest/mock mode works only outside Telegram and only if `VITE_DEV_MOCK_TELEGRAM=true`.
- If Telegram WebApp exists but `initData` is empty, app shows explicit error and does not fallback to guest.
- `TELEGRAM_AUTH_MAX_AGE_SECONDS` (default `300`) limits how old `auth_date` can be.

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

## Backend Resilience Notes

- In-memory per-IP rate limits are enabled for auth/game/leaderboard/admin routes.
- `POST /api/game/result` is idempotent by `(userId, sessionId)`.
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
   - background music has separate toggle button (`♫`), default music loudness = 75% of SFX volume
4. Layout checks:
   - TIME / SCORE / HI always in one row on narrow screen
   - canvas uses max available area (no large empty block)
   - settings sheet opens only by settings button
5. Leaderboard:
   - after first saved game, pinned `Вы` row shows rank and score
   - top list scrolls, `Вы` row stays visible
