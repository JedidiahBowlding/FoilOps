#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# setup-db.sh — Spin up a local Postgres container and wire DATABASE_URL
# ---------------------------------------------------------------------------

CONTAINER_NAME="foilops-db"
DB_NAME="handi_cat"
DB_USER="handi"
DB_PASS="handi_secret"
DB_PORT="5433"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

# ---- Check deps -----------------------------------------------------------
if ! command -v docker &>/dev/null; then
  echo "ERROR: docker is not installed or not in PATH." >&2
  exit 1
fi

# ---- If container already exists, just start it ---------------------------
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Container '$CONTAINER_NAME' already exists."
  docker start "$CONTAINER_NAME" 2>/dev/null || true
  echo "Started."
else
  echo "Creating Postgres container '$CONTAINER_NAME'..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_DB="$DB_NAME" \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="$DB_PASS" \
    -p "${DB_PORT}:5432" \
    --restart unless-stopped \
    postgres:16-alpine
  echo "Container created."
fi

# ---- Wait for Postgres to be ready ----------------------------------------
echo -n "Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" &>/dev/null; then
    echo " ready."
    break
  fi
  sleep 1
  echo -n "."
  if [[ $i -eq 30 ]]; then
    echo ""
    echo "ERROR: Postgres did not become ready in 30s." >&2
    exit 1
  fi
done

# ---- Build connection string -----------------------------------------------
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}"

# ---- Update .env -----------------------------------------------------------
if [[ -f "$ENV_FILE" ]]; then
  if grep -q "^DATABASE_URL=" "$ENV_FILE"; then
    # Replace existing line (portable: GNU sed on Linux, BSD sed on macOS)
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" "$ENV_FILE"
    else
      sed -i '' "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" "$ENV_FILE"
    fi
    echo "Updated DATABASE_URL in .env"
  else
    echo "DATABASE_URL=${DATABASE_URL}" >> "$ENV_FILE"
    echo "Appended DATABASE_URL to .env"
  fi
else
  echo "WARNING: .env not found at $ENV_FILE — skipping auto-update."
fi

echo ""
echo "Database URL: $DATABASE_URL"
echo ""
echo "Next steps:"
echo "  pnpm db:migrate    # run Prisma migrations"
echo "  pnpm db:seed       # optional: seed initial data"
echo "  pnpm start         # start the bot"
