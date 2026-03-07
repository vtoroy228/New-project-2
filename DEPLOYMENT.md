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
npm run prisma:migrate
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
