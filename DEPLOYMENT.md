# Deployment Guide

## Production Goal

One public URL, one backend process:

- `https://your-domain/` serves frontend
- `https://your-domain/api/*` serves backend API

No CORS and no `localhost` in production API calls.

## 1. Environment Variables

Required in production:

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT=3000`
- `APP_PORT=3000`
- `DATABASE_URL=postgresql://...`
- `TELEGRAM_BOT_TOKEN=...`
- `ADMIN_TELEGRAM_IDS=...`

For Docker service-to-service networking use:

```bash
DATABASE_URL=postgresql://postgres:postgres@db:5432/telegram_dino?schema=public
```

Dev-only flags (should be `false` in prod):

- `DEV_MOCK_TELEGRAM`
- `VITE_DEV_MOCK_TELEGRAM`
- `AUTH_DEBUG_LOGS`

## 2. Manual Docker Deploy (No Wrapper Scripts)

From project root:

```bash
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.app.yml"

# 1) Start DB
$COMPOSE up -d db

# 2) Wait for DB health
until [ "$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' telegram_dino_db)" = "healthy" ]; do
  echo "Waiting for DB health..."
  sleep 2
done

# 3) Build app image
$COMPOSE build app

# 4) Apply Prisma migrations
$COMPOSE run --rm app npx prisma migrate deploy --schema backend/prisma/schema.prisma

# 5) Start app
$COMPOSE up -d app

# 6) Verify containers
$COMPOSE ps
```

If your user is not in docker group yet, run with `sudo`:

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.app.yml ps
```

## 3. Smoke Test Checklist

```bash
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/readyz
curl -fsS http://127.0.0.1:3000/api/leaderboard/global
```

Expected:

- `/healthz` -> JSON with `ok: true`
- `/readyz` -> JSON with `status: ready`
- `/api/leaderboard/global` -> leaderboard JSON

## 4. Telegram Mini App URL

In BotFather set Mini App URL to your HTTPS URL root, for example:

- `https://miniapp.example.com`

## 5. Minimal xtunnel Loop Script

Repository now uses a single script:

- `ops/xtunnel-loop.sh`

It runs `xtunnel http 3000 --force` (with optional license and extra args)
and restarts it every `XTUNNEL_RESTART_EVERY_MINUTES`.

### 5.1 Minimal `.env` for xtunnel

```bash
XTUNNEL_ENABLED=true
XTUNNEL_BIN=xtunnel
XTUNNEL_PROTOCOL=http
XTUNNEL_PORT=3000
XTUNNEL_FORCE=true
XTUNNEL_LICENSE_KEY=YOUR_LICENSE_KEY
XTUNNEL_RESTART_EVERY_MINUTES=180
XTUNNEL_RESTART_DELAY_SECONDS=5
XTUNNEL_LOG_FILE=./logs/xtunnel.log
XTUNNEL_PID_FILE=./.run/xtunnel-loop.pid
```

### 5.2 Run xtunnel once in foreground

```bash
set -a
source .env
set +a
"$XTUNNEL_BIN" "$XTUNNEL_PROTOCOL" "$XTUNNEL_PORT" --force --license "$XTUNNEL_LICENSE_KEY"
```

### 5.3 Run loop in background

```bash
npm run xtunnel:start
npm run xtunnel:status
npm run xtunnel:restart
npm run xtunnel:stop
```

Optional foreground mode:

```bash
npm run xtunnel:run
```

## 6. Fresh Ubuntu Server Bootstrap (from zero)

### 6.1 Install base tools

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
```

### 6.2 Install Docker Engine + Compose plugin

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker "$USER"
newgrp docker
```

### 6.3 Clone project

```bash
cd /opt
sudo git clone <YOUR_REPO_URL> telegram-dino
sudo chown -R "$USER":"$USER" /opt/telegram-dino
cd /opt/telegram-dino
```

### 6.4 Install xtunnel binary

```bash
XTUNNEL_LINUX_URL="https://REPLACE_WITH_VENDOR_BINARY_URL"
curl -fL "$XTUNNEL_LINUX_URL" -o /tmp/xtunnel
chmod +x /tmp/xtunnel
sudo install -m 0755 /tmp/xtunnel /usr/local/bin/xtunnel
```

### 6.5 Prepare `.env`

```bash
cp .env.example .env
```

Then edit values for bot token, admins, db, and xtunnel.

### 6.6 First deploy

Run the manual flow from section 2.

## 7. Optional systemd for xtunnel loop

```bash
sudo tee /etc/systemd/system/telegram-dino-xtunnel.service > /dev/null <<EOF
[Unit]
Description=Telegram Dino xtunnel loop
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=/opt/telegram-dino
ExecStart=/bin/bash /opt/telegram-dino/ops/xtunnel-loop.sh run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now telegram-dino-xtunnel.service
sudo systemctl status telegram-dino-xtunnel.service --no-pager
```

## 8. Useful Logs

App logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.app.yml logs -f app
```

xtunnel loop logs:

```bash
tail -n 100 logs/xtunnel.log
```
