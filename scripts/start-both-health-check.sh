#!/bin/bash

set -euo pipefail

# Resolve app port from environment/.env so health checks follow PORT changes.
RESOLVED_PORT="${PORT:-}"
if [ -z "$RESOLVED_PORT" ] && [ -f .env ]; then
  RESOLVED_PORT="$(grep -E '^PORT=' .env | tail -n 1 | cut -d '=' -f2 | tr -d '[:space:]')"
fi
APP_PORT="${APP_PORT:-${RESOLVED_PORT:-3001}}"
RUST_PORT="${RUST_PORT:-8787}"
APP_URL="${APP_URL:-http://127.0.0.1:${APP_PORT}/}"
RUST_HEALTH_URL="${RUST_HEALTH_URL:-http://127.0.0.1:${RUST_PORT}/health}"
MAX_RETRIES="${MAX_RETRIES:-20}"
SLEEP_SECONDS="${SLEEP_SECONDS:-1}"

check_port() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

check_http() {
  local url="$1"
  curl -fsS --max-time 3 "$url" >/dev/null 2>&1
}

wait_for() {
  local label="$1"
  local fn="$2"
  local target="$3"

  local i=1
  while [ "$i" -le "$MAX_RETRIES" ]; do
    if "$fn" "$target"; then
      echo "[ok] $label"
      return 0
    fi
    echo "[wait] $label ($i/$MAX_RETRIES)"
    sleep "$SLEEP_SECONDS"
    i=$((i + 1))
  done

  echo "[fail] $label"
  return 1
}

echo "Checking combined app health..."
wait_for "TypeScript app port :$APP_PORT" check_port "$APP_PORT"
wait_for "Rust receiver port :$RUST_PORT" check_port "$RUST_PORT"
wait_for "TypeScript app endpoint $APP_URL" check_http "$APP_URL"
wait_for "Rust health endpoint $RUST_HEALTH_URL" check_http "$RUST_HEALTH_URL"

echo "All health checks passed."
