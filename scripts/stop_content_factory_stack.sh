#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTIZ_DIR="$ROOT_DIR/postiz-stable"

echo "[1/2] Stopping Postiz stack from $POSTIZ_DIR"
(
  cd "$POSTIZ_DIR"
  docker compose stop
)

echo "[2/2] Stopping n8n stack from $ROOT_DIR"
(
  cd "$ROOT_DIR"
  docker compose stop n8n
)

echo
echo "Services stopped."
