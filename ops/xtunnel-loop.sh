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

is_truthy() {
  local value="${1:-}"
  value="${value,,}"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "y" || "$value" == "on" ]]
}

fail() {
  printf '[xtunnel-loop][error] %s\n' "$1" >&2
  exit 1
}

XTUNNEL_ENABLED="${XTUNNEL_ENABLED:-true}"
XTUNNEL_BIN="${XTUNNEL_BIN:-xtunnel}"
XTUNNEL_PROTOCOL="${XTUNNEL_PROTOCOL:-http}"
XTUNNEL_PORT="${XTUNNEL_PORT:-${APP_PORT:-3000}}"
XTUNNEL_FORCE="${XTUNNEL_FORCE:-true}"
XTUNNEL_LICENSE_KEY="${XTUNNEL_LICENSE_KEY:-}"
XTUNNEL_EXTRA_ARGS="${XTUNNEL_EXTRA_ARGS:-}"
XTUNNEL_RESTART_EVERY_MINUTES="${XTUNNEL_RESTART_EVERY_MINUTES:-180}"
XTUNNEL_RESTART_DELAY_SECONDS="${XTUNNEL_RESTART_DELAY_SECONDS:-5}"
XTUNNEL_LOG_FILE="${XTUNNEL_LOG_FILE:-$ROOT_DIR/logs/xtunnel.log}"
XTUNNEL_PID_FILE="${XTUNNEL_PID_FILE:-$ROOT_DIR/.run/xtunnel-loop.pid}"

mkdir -p "$(dirname "$XTUNNEL_LOG_FILE")" "$(dirname "$XTUNNEL_PID_FILE")"

if [[ "$XTUNNEL_PROTOCOL" != "http" && "$XTUNNEL_PROTOCOL" != "tcp" ]]; then
  fail "XTUNNEL_PROTOCOL must be either http or tcp"
fi

if ! [[ "$XTUNNEL_PORT" =~ ^[0-9]+$ ]] || (( XTUNNEL_PORT < 1 || XTUNNEL_PORT > 65535 )); then
  fail "XTUNNEL_PORT must be a valid TCP port (1..65535)"
fi

if ! [[ "$XTUNNEL_RESTART_EVERY_MINUTES" =~ ^[0-9]+$ ]] || (( XTUNNEL_RESTART_EVERY_MINUTES < 1 )); then
  fail "XTUNNEL_RESTART_EVERY_MINUTES must be a positive integer"
fi

if ! [[ "$XTUNNEL_RESTART_DELAY_SECONDS" =~ ^[0-9]+$ ]] || (( XTUNNEL_RESTART_DELAY_SECONDS < 1 )); then
  fail "XTUNNEL_RESTART_DELAY_SECONDS must be a positive integer"
fi

read_pid() {
  if [[ ! -f "$XTUNNEL_PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$XTUNNEL_PID_FILE")"

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

run_loop() {
  if ! is_truthy "$XTUNNEL_ENABLED"; then
    printf '[xtunnel-loop] XTUNNEL_ENABLED=false, exiting\n'
    exit 0
  fi

  if ! command -v "$XTUNNEL_BIN" >/dev/null 2>&1; then
    fail "xtunnel binary not found: $XTUNNEL_BIN"
  fi

  if ! command -v timeout >/dev/null 2>&1; then
    fail "timeout command is required (coreutils)"
  fi

  local command=("$XTUNNEL_BIN" "$XTUNNEL_PROTOCOL" "$XTUNNEL_PORT")

  if is_truthy "$XTUNNEL_FORCE"; then
    command+=(--force)
  fi

  if [[ -n "$XTUNNEL_LICENSE_KEY" ]]; then
    command+=(--license "$XTUNNEL_LICENSE_KEY")
  fi

  if [[ -n "$XTUNNEL_EXTRA_ARGS" ]]; then
    read -r -a extra_args <<< "$XTUNNEL_EXTRA_ARGS"
    command+=("${extra_args[@]}")
  fi

  local run_seconds=$((XTUNNEL_RESTART_EVERY_MINUTES * 60))

  printf '[xtunnel-loop] restart interval: %s minutes\n' "$XTUNNEL_RESTART_EVERY_MINUTES"
  printf '[xtunnel-loop] restart delay: %s seconds\n' "$XTUNNEL_RESTART_DELAY_SECONDS"
  printf '[xtunnel-loop] logs: %s\n' "$XTUNNEL_LOG_FILE"

  while true; do
    printf '[xtunnel-loop] %s starting tunnel\n' "$(date '+%Y-%m-%d %H:%M:%S')"

    set +e
    timeout --signal=TERM "${run_seconds}s" "${command[@]}" >>"$XTUNNEL_LOG_FILE" 2>&1
    local exit_code=$?
    set -e

    if (( exit_code == 124 )); then
      printf '[xtunnel-loop] %s planned restart\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    else
      printf '[xtunnel-loop] %s tunnel exited with code %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$exit_code"
    fi

    sleep "$XTUNNEL_RESTART_DELAY_SECONDS"
  done
}

start_loop() {
  if is_running; then
    printf '[xtunnel-loop] already running (pid=%s)\n' "$(read_pid)"
    return 0
  fi

  rm -f "$XTUNNEL_PID_FILE"

  nohup "$0" run >>"$XTUNNEL_LOG_FILE" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$XTUNNEL_PID_FILE"
  printf '[xtunnel-loop] started (pid=%s)\n' "$pid"
}

stop_loop() {
  if ! is_running; then
    rm -f "$XTUNNEL_PID_FILE"
    printf '[xtunnel-loop] already stopped\n'
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

  rm -f "$XTUNNEL_PID_FILE"
  printf '[xtunnel-loop] stopped\n'
}

status_loop() {
  if is_running; then
    printf '[xtunnel-loop] running (pid=%s)\n' "$(read_pid)"
    return 0
  fi

  printf '[xtunnel-loop] stopped\n'
  return 1
}

case "${1:-run}" in
  run)
    run_loop
    ;;
  start)
    start_loop
    ;;
  stop)
    stop_loop
    ;;
  restart)
    stop_loop
    start_loop
    ;;
  status)
    status_loop
    ;;
  *)
    printf 'Usage: %s {run|start|stop|restart|status}\n' "$0" >&2
    exit 1
    ;;
esac
