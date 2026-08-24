#!/usr/bin/env bash
set -Eeuo pipefail

wait_seconds=0
if [[ ${1:-} == --wait ]]; then
  wait_seconds=${2:-60}
fi
deadline=$((SECONDS + wait_seconds))
compose=(docker compose --env-file /opt/breakroom/.env.production -f /opt/breakroom/compose.production.yaml)

while true; do
  url=$("${compose[@]}" logs --no-color cloudflared 2>&1 \
    | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' \
    | tail -n 1 || true)
  if [[ -n ${url} ]]; then
    printf '%s\n' "${url}"
    exit 0
  fi
  if (( SECONDS >= deadline )); then
    echo 'No Quick Tunnel URL is available yet.' >&2
    exit 1
  fi
  sleep 2
done
