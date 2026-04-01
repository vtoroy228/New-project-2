#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

PID_FILE="${XTUNNEL_WATCHDOG_PID_FILE:-$ROOT_DIR/.run/xtunnel-watchdog.pid}"
SUPERVISOR_LOG_FILE="${XTUNNEL_SUPERVISOR_LOG_FILE:-$ROOT_DIR/logs/xtunnel-watchdog.log}"
WATCHDOG_SCRIPT="$ROOT_DIR/ops/xtunnel-watchdog.sh"

mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$SUPERVISOR_LOG_FILE")"

read_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE")"

  if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  printf '%s' "$pid"
}

is_running() {
  local pid
  pid="$(read_pid)" || return 1
  kill -0 "$pid" 2>/dev/null
}

start() {
  if is_running; then
    printf '[xtunnel-service] already running (pid=%s)\n' "$(read_pid)"
    return 0
  fi

  rm -f "$PID_FILE"

  nohup "$WATCHDOG_SCRIPT" >>"$SUPERVISOR_LOG_FILE" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"
  printf '[xtunnel-service] started watchdog (pid=%s)\n' "$pid"
}

stop() {
  if ! is_running; then
    rm -f "$PID_FILE"
    printf '[xtunnel-service] already stopped\n'
    return 0
  fi

  local pid
  pid="$(read_pid)"
  kill -TERM "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if kill -0 "$pid" 2>/dev/null; then
      sleep 1
      continue
    fi

    break
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  printf '[xtunnel-service] stopped watchdog\n'
}

status() {
  if is_running; then
    printf '[xtunnel-service] running (pid=%s)\n' "$(read_pid)"
    return 0
  fi

  printf '[xtunnel-service] stopped\n'
  return 1
}

case "${1:-}" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start
    ;;
  status)
    status
    ;;
  *)
    printf 'Usage: %s {start|stop|restart|status}\n' "$0" >&2
    exit 1
    ;;
esac
