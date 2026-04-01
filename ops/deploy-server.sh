#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILES=(
  -f docker-compose.yml
  -f docker-compose.app.yml
)
ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.env}"

is_truthy() {
  local value="${1:-}"
  value="${value,,}"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "y" || "$value" == "on" ]]
}

log() {
  printf '[deploy] %s\n' "$1"
}

fail() {
  printf '[deploy][error] %s\n' "$1" >&2
  exit 1
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "Command not found: $cmd"
  fi
}

compose() {
  docker compose "${COMPOSE_FILES[@]}" "$@"
}

wait_for_db_healthy() {
  local retries="${DB_HEALTHCHECK_RETRIES:-60}"
  local sleep_seconds="${DB_HEALTHCHECK_SLEEP_SECONDS:-2}"
  local db_container="${DB_CONTAINER_NAME:-telegram_dino_db}"

  local attempt=1
  while (( attempt <= retries )); do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$db_container" 2>/dev/null || true)"

    if [[ "$status" == "healthy" ]]; then
      log "Database container is healthy"
      return 0
    fi

    log "Waiting for database health (${attempt}/${retries})"
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done

  fail "Database did not become healthy in time"
}

if [[ ! -f "$ENV_FILE" ]]; then
  fail "Missing env file: $ENV_FILE"
fi

# Export env vars for docker compose and script toggles.
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

require_command docker

if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose plugin is required (docker compose ...)"
fi

if is_truthy "${DEPLOY_GIT_PULL:-false}"; then
  local_remote="${DEPLOY_GIT_REMOTE:-origin}"
  local_branch="${DEPLOY_GIT_BRANCH:-main}"
  log "Pulling latest code from ${local_remote}/${local_branch}"
  git fetch "$local_remote" "$local_branch"
  git pull --ff-only "$local_remote" "$local_branch"
fi

if [[ "${DATABASE_URL:-}" == *"localhost"* || "${DATABASE_URL:-}" == *"127.0.0.1"* ]]; then
  log "Warning: DATABASE_URL points to localhost. For Docker service-to-service networking use host 'db'."
fi

log "Starting database"
compose up -d db
wait_for_db_healthy

log "Building app image"
compose build app

log "Applying Prisma migrations"
compose run --rm app npx prisma migrate deploy --schema backend/prisma/schema.prisma

log "Starting app container"
compose up -d app

if is_truthy "${XTUNNEL_ENABLED:-true}"; then
  log "Restarting xtunnel watchdog"
  "$ROOT_DIR/ops/xtunnel-service.sh" restart
else
  log "XTUNNEL_ENABLED=false, skipping xtunnel watchdog"
fi

log "Deployment status"
compose ps

log "Done"
