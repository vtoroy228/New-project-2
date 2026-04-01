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

if ! is_truthy "${XTUNNEL_ENABLED:-true}"; then
  printf '[xtunnel-watchdog] XTUNNEL_ENABLED=false, exiting\n'
  exit 0
fi

XTUNNEL_BIN="${XTUNNEL_BIN:-xtunnel}"
XTUNNEL_PROTOCOL="${XTUNNEL_PROTOCOL:-http}"
XTUNNEL_PORT="${XTUNNEL_PORT:-${APP_PORT:-3000}}"
XTUNNEL_FORCE="${XTUNNEL_FORCE:-true}"
XTUNNEL_LICENSE_KEY="${XTUNNEL_LICENSE_KEY:-}"
XTUNNEL_EXTRA_ARGS="${XTUNNEL_EXTRA_ARGS:-}"
XTUNNEL_COMMAND_OVERRIDE="${XTUNNEL_COMMAND:-}"
XTUNNEL_RESTART_MODE="${XTUNNEL_RESTART_MODE:-daily}"
XTUNNEL_RESTART_DAILY_AT="${XTUNNEL_RESTART_DAILY_AT:-04:00}"
XTUNNEL_RESTART_TIMEZONE="${XTUNNEL_RESTART_TIMEZONE:-}"
XTUNNEL_RESTART_EVERY_MINUTES="${XTUNNEL_RESTART_EVERY_MINUTES:-180}"
XTUNNEL_RESTART_DELAY_SECONDS="${XTUNNEL_RESTART_DELAY_SECONDS:-5}"
XTUNNEL_LOG_FILE="${XTUNNEL_LOG_FILE:-$ROOT_DIR/logs/xtunnel.log}"
XTUNNEL_DAILY_RESTART_IDLE_SECONDS="${XTUNNEL_DAILY_RESTART_IDLE_SECONDS:-180}"
XTUNNEL_DAILY_RESTART_ACTIVITY_FILE="${XTUNNEL_DAILY_RESTART_ACTIVITY_FILE:-$XTUNNEL_LOG_FILE}"

if [[ "$XTUNNEL_PROTOCOL" != 'http' && "$XTUNNEL_PROTOCOL" != 'tcp' ]]; then
  printf '[xtunnel-watchdog][error] XTUNNEL_PROTOCOL must be either http or tcp\n' >&2
  exit 1
fi

if ! [[ "$XTUNNEL_PORT" =~ ^[0-9]+$ ]] || (( XTUNNEL_PORT < 1 || XTUNNEL_PORT > 65535 )); then
  printf '[xtunnel-watchdog][error] XTUNNEL_PORT must be a valid TCP port (1..65535)\n' >&2
  exit 1
fi

if [[ "$XTUNNEL_RESTART_MODE" != 'interval' && "$XTUNNEL_RESTART_MODE" != 'daily' ]]; then
  printf '[xtunnel-watchdog][error] XTUNNEL_RESTART_MODE must be either interval or daily\n' >&2
  exit 1
fi

if ! [[ "$XTUNNEL_RESTART_DAILY_AT" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]]; then
  printf '[xtunnel-watchdog][error] XTUNNEL_RESTART_DAILY_AT must be HH:MM (24h), for example 04:00\n' >&2
  exit 1
fi

if ! [[ "$XTUNNEL_DAILY_RESTART_IDLE_SECONDS" =~ ^[0-9]+$ ]]; then
  printf '[xtunnel-watchdog][error] XTUNNEL_DAILY_RESTART_IDLE_SECONDS must be a non-negative integer\n' >&2
  exit 1
fi

target_hour="${XTUNNEL_RESTART_DAILY_AT%%:*}"
target_minute="${XTUNNEL_RESTART_DAILY_AT##*:}"
target_hour=$((10#$target_hour))
target_minute=$((10#$target_minute))

XTUNNEL_COMMAND=()
if [[ -z "$XTUNNEL_COMMAND_OVERRIDE" ]]; then
  if ! command -v "$XTUNNEL_BIN" >/dev/null 2>&1; then
    printf '[xtunnel-watchdog][error] xtunnel binary not found: %s\n' "$XTUNNEL_BIN" >&2
    exit 1
  fi

  XTUNNEL_COMMAND=("$XTUNNEL_BIN" "$XTUNNEL_PROTOCOL" "$XTUNNEL_PORT")
  if is_truthy "$XTUNNEL_FORCE"; then
    XTUNNEL_COMMAND+=(--force)
  fi

  if [[ -n "$XTUNNEL_LICENSE_KEY" ]]; then
    XTUNNEL_COMMAND+=(--license "$XTUNNEL_LICENSE_KEY")
  fi

  if [[ -n "$XTUNNEL_EXTRA_ARGS" ]]; then
    read -r -a XTUNNEL_EXTRA_ARGS_PARTS <<< "$XTUNNEL_EXTRA_ARGS"
    XTUNNEL_COMMAND+=("${XTUNNEL_EXTRA_ARGS_PARTS[@]}")
  fi
fi

if [[ "$XTUNNEL_RESTART_MODE" == 'interval' ]]; then
  if ! [[ "$XTUNNEL_RESTART_EVERY_MINUTES" =~ ^[0-9]+$ ]] || (( XTUNNEL_RESTART_EVERY_MINUTES < 1 )); then
    printf '[xtunnel-watchdog][error] XTUNNEL_RESTART_EVERY_MINUTES must be a positive integer\n' >&2
    exit 1
  fi
fi

if ! [[ "$XTUNNEL_RESTART_DELAY_SECONDS" =~ ^[0-9]+$ ]] || (( XTUNNEL_RESTART_DELAY_SECONDS < 1 )); then
  printf '[xtunnel-watchdog][error] XTUNNEL_RESTART_DELAY_SECONDS must be a positive integer\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$XTUNNEL_LOG_FILE")"

license_configured='no'
if [[ -n "$XTUNNEL_LICENSE_KEY" ]]; then
  license_configured='yes'
fi

if [[ -z "$XTUNNEL_COMMAND_OVERRIDE" && -z "$XTUNNEL_LICENSE_KEY" ]]; then
  printf '[xtunnel-watchdog][warn] XTUNNEL_LICENSE_KEY is empty, command will run without --license\n'
fi

read_now_parts() {
  if [[ -n "$XTUNNEL_RESTART_TIMEZONE" ]]; then
    TZ="$XTUNNEL_RESTART_TIMEZONE" date '+%F %H %M'
    return
  fi

  date '+%F %H %M'
}

read_file_mtime_epoch() {
  local file_path="$1"

  if [[ ! -f "$file_path" ]]; then
    return 1
  fi

  if stat -c %Y "$file_path" >/dev/null 2>&1; then
    stat -c %Y "$file_path"
    return 0
  fi

  if stat -f %m "$file_path" >/dev/null 2>&1; then
    stat -f %m "$file_path"
    return 0
  fi

  return 1
}

get_daily_restart_remaining_idle_seconds() {
  local now_epoch="$1"

  if (( XTUNNEL_DAILY_RESTART_IDLE_SECONDS == 0 )); then
    printf '0'
    return 0
  fi

  local last_activity_epoch
  last_activity_epoch="$(read_file_mtime_epoch "$XTUNNEL_DAILY_RESTART_ACTIVITY_FILE" || printf '0')"

  if (( last_activity_epoch <= 0 )); then
    printf '0'
    return 0
  fi

  local idle_for=$((now_epoch - last_activity_epoch))
  if (( idle_for < 0 )); then
    idle_for=0
  fi

  if (( idle_for >= XTUNNEL_DAILY_RESTART_IDLE_SECONDS )); then
    printf '0'
    return 0
  fi

  printf '%s' "$((XTUNNEL_DAILY_RESTART_IDLE_SECONDS - idle_for))"
}

is_after_daily_target() {
  local current_hour="$1"
  local current_minute="$2"

  if (( current_hour > target_hour )); then
    return 0
  fi

  if (( current_hour == target_hour && current_minute >= target_minute )); then
    return 0
  fi

  return 1
}

child_pid=0
on_term() {
  printf '[xtunnel-watchdog] shutdown requested\n'
  if (( child_pid > 0 )) && kill -0 "$child_pid" 2>/dev/null; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  exit 0
}
trap on_term SIGINT SIGTERM

if [[ -n "$XTUNNEL_COMMAND_OVERRIDE" ]]; then
  printf '[xtunnel-watchdog] using XTUNNEL_COMMAND override\n'
else
  printf '[xtunnel-watchdog] mode: %s\n' "$XTUNNEL_PROTOCOL"
  printf '[xtunnel-watchdog] port: %s\n' "$XTUNNEL_PORT"
  printf '[xtunnel-watchdog] force flag: %s\n' "$XTUNNEL_FORCE"
  printf '[xtunnel-watchdog] license configured: %s\n' "$license_configured"
fi

if [[ "$XTUNNEL_RESTART_MODE" == 'daily' ]]; then
  printf '[xtunnel-watchdog] restart mode: daily at %s\n' "$XTUNNEL_RESTART_DAILY_AT"
  if [[ -n "$XTUNNEL_RESTART_TIMEZONE" ]]; then
    printf '[xtunnel-watchdog] restart timezone: %s\n' "$XTUNNEL_RESTART_TIMEZONE"
  fi
  printf '[xtunnel-watchdog] daily restart idle window: %s sec\n' "$XTUNNEL_DAILY_RESTART_IDLE_SECONDS"
  printf '[xtunnel-watchdog] daily restart activity file: %s\n' "$XTUNNEL_DAILY_RESTART_ACTIVITY_FILE"
else
  printf '[xtunnel-watchdog] restart mode: interval (%s minutes)\n' "$XTUNNEL_RESTART_EVERY_MINUTES"
fi

printf '[xtunnel-watchdog] tunnel logs: %s\n' "$XTUNNEL_LOG_FILE"

last_daily_restart_day=''
last_idle_wait_log_at=0

while true; do
  started_at="$(date +%s)"

  if [[ "$XTUNNEL_RESTART_MODE" == 'daily' ]]; then
    read -r startup_day startup_hour startup_minute <<< "$(read_now_parts)"
    startup_hour=$((10#$startup_hour))
    startup_minute=$((10#$startup_minute))
    if is_after_daily_target "$startup_hour" "$startup_minute"; then
      last_daily_restart_day="$startup_day"
    fi
  fi

  printf '[xtunnel-watchdog] %s starting tunnel\n' "$(date '+%Y-%m-%d %H:%M:%S')"

  set +e
  if [[ -n "$XTUNNEL_COMMAND_OVERRIDE" ]]; then
    bash -lc "$XTUNNEL_COMMAND_OVERRIDE" >>"$XTUNNEL_LOG_FILE" 2>&1 &
  else
    "${XTUNNEL_COMMAND[@]}" >>"$XTUNNEL_LOG_FILE" 2>&1 &
  fi
  child_pid=$!
  set -e

  restart_at=0
  if [[ "$XTUNNEL_RESTART_MODE" == 'interval' ]]; then
    restart_at=$((started_at + XTUNNEL_RESTART_EVERY_MINUTES * 60))
  fi

  while kill -0 "$child_pid" 2>/dev/null; do
    if [[ "$XTUNNEL_RESTART_MODE" == 'interval' ]]; then
      now="$(date +%s)"
      if (( now >= restart_at )); then
        printf '[xtunnel-watchdog] %s scheduled interval restart\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        kill -TERM "$child_pid" 2>/dev/null || true
        break
      fi
    else
      read -r now_day now_hour now_minute <<< "$(read_now_parts)"
      now_hour=$((10#$now_hour))
      now_minute=$((10#$now_minute))
      if [[ "$now_day" != "$last_daily_restart_day" ]] && is_after_daily_target "$now_hour" "$now_minute"; then
        now_epoch="$(date +%s)"
        remaining_idle_seconds="$(get_daily_restart_remaining_idle_seconds "$now_epoch")"
        if (( remaining_idle_seconds > 0 )); then
          if (( now_epoch - last_idle_wait_log_at >= 30 )); then
            printf '[xtunnel-watchdog] %s daily restart postponed: activity detected, wait %s sec more\n' \
              "$(date '+%Y-%m-%d %H:%M:%S')" "$remaining_idle_seconds"
            last_idle_wait_log_at="$now_epoch"
          fi
          sleep 5
          continue
        fi

        printf '[xtunnel-watchdog] %s scheduled daily restart (%s)\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$XTUNNEL_RESTART_DAILY_AT"
        last_daily_restart_day="$now_day"
        last_idle_wait_log_at=0
        kill -TERM "$child_pid" 2>/dev/null || true
        break
      fi
    fi

    sleep 5
  done

  set +e
  wait "$child_pid"
  exit_code=$?
  set -e
  child_pid=0

  printf '[xtunnel-watchdog] %s tunnel exited with code %s, restart in %s sec\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$exit_code" "$XTUNNEL_RESTART_DELAY_SECONDS"
  sleep "$XTUNNEL_RESTART_DELAY_SECONDS"
done
