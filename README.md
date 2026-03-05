# Telegram Dino Mini App

Single-domain Telegram Mini App game (Chrome Dino runner clone) with a Fastify + Prisma backend and React + Canvas frontend.

## Tech Stack

- Backend: Node.js 20+, TypeScript, Fastify, Prisma, PostgreSQL
- Frontend: React, TypeScript, Vite, Canvas game engine
- Infra: Docker Compose (local DB), Dockerfile (single-domain production app)

## Monorepo Structure

- `backend`: API, Telegram auth, Prisma, static frontend serving
- `frontend`: Telegram WebApp UI and Dino game
- `docker-compose.yml`: local PostgreSQL
- `Dockerfile`: production app image (serves API + frontend from one domain)

## Prerequisites

1. Node.js 20+
2. Docker + Docker Compose
3. Telegram Bot token (`TELEGRAM_BOT_TOKEN`)

## Setup

1. Copy environment file:

```bash
cp .env.example .env
```

2. Start local PostgreSQL:

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

6. Start backend + frontend in dev mode:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`
- Frontend calls backend via Vite proxy (`/api`), same-origin style requests.

## API Summary

- `POST /api/auth/validate` (Telegram auth required)
- `GET /api/auth/me` (Telegram auth required)
- `POST /api/game/result` (Telegram auth required)
- `GET /api/leaderboard/global` (public, optional auth for `you`)
- `POST /api/admin/ban-user` (admin)
- `POST /api/admin/unban-user` (admin)
- `POST /api/admin/reset-leaderboard` (admin)

## Telegram Auth in Dev

- Frontend mock toggle: `VITE_DEV_MOCK_TELEGRAM=true`
- Backend mock toggle: `DEV_MOCK_TELEGRAM=true`
- In dev browser mode, frontend sends `Authorization: tma dev-mock`.
- Production mode (`NODE_ENV=production`) disables this fallback.

## Cloudflared Tunnel (No ngrok)

For Telegram testing with HTTPS public URL:

```bash
cloudflared tunnel --url http://localhost:3000
```

If you temporarily expose the Vite server directly:

```bash
cloudflared tunnel --url http://localhost:5173
```

`frontend/vite.config.ts` already has `server.allowedHosts: true` for tunnel hostnames.

## Theming (Single Config)

Edit all design tokens in:

- `frontend/src/ui/theme/tokens.ts`

This file controls colors, spacing, radii, shadows, typography, and app labels.

## Fonts

Drop real Trigram font file here (replace placeholder):

- `frontend/public/assets/fonts/Trigram.woff2`

## Game Skins / Assets

Default skin files:

- `frontend/src/game/skins/default/skin.json`
- `frontend/src/game/skins/default/*.svg`

Replace placeholders in this folder. Change active skin constant in:

- `frontend/src/game/SkinLoader.ts` (`DEFAULT_SKIN`)

## Production Build & Run

```bash
npm run build
npm run start
```

Backend serves:

- API: `/api/*`
- Frontend static build: `/`
- SPA fallback for non-API routes

## Docker (Single Domain App)

```bash
docker build -t telegram-dino .
docker run -p 3000:3000 --env-file .env telegram-dino
```

Container serves both frontend and API on one URL.

## Admin Access

Set Telegram IDs in `.env`:

```bash
ADMIN_TELEGRAM_IDS=123456789,987654321
```

Only these users can call `/api/admin/*`.
