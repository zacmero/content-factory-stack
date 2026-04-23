#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTIZ_DIR="$ROOT_DIR/postiz-stable"

echo "[1/2] Starting n8n stack from $ROOT_DIR"
(
  cd "$ROOT_DIR"
  docker compose up -d n8n
)

echo "[2/2] Starting Postiz stack from $POSTIZ_DIR"
(
  cd "$POSTIZ_DIR"
  docker compose up -d
)

cat <<'EOF'

Services started.
- n8n:   http://localhost:8080
- Postiz: http://localhost:4007

EOF
