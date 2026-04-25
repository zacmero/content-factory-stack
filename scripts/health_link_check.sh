#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: ./scripts/health_link_check.sh <url> [url...]" >&2
  exit 1
fi

ua='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

for url in "$@"; do
  raw="$(curl -s -L -o /dev/null -A "$ua" --max-time 12 -w '%{http_code} %{url_effective}' "$url" || true)"
  status="${raw%% *}"
  final_url="${raw#* }"
  [ "$final_url" = "$status" ] && final_url="$url"

  if [ "${status:-0}" -ge 200 ] && [ "${status:-0}" -lt 400 ]; then
    echo "live $status $final_url"
  else
    echo "dead ${status:-n/a} $final_url"
  fi
done
