#!/usr/bin/env bash
# Starts the whole app in one container (see the repo-root Dockerfile):
#   API  (FastAPI/uvicorn) on $API_HOST:$API_PORT (127.0.0.1 = internal only)
#   web  (Next.js)         on 0.0.0.0:$PORT, proxies /api/v1 and /health to the API
# Exits as soon as either process stops, so the platform restarts the container.
set -uo pipefail

PORT="${PORT:-8080}"
API_PORT=18000
# 0.0.0.0 lets docker-compose publish the API directly (localhost:8000).
API_HOST="${API_HOST:-127.0.0.1}"

cd /app/apps/api
alembic upgrade head || exit 1

uvicorn app.main:app --host "$API_HOST" --port "$API_PORT" \
  --proxy-headers --forwarded-allow-ips='*' &
api=$!

# Let the API come up first so the web server never proxies into a closed port.
for _ in $(seq 1 120); do
  (exec 3<>"/dev/tcp/127.0.0.1/$API_PORT") 2>/dev/null && break
  kill -0 "$api" 2>/dev/null || exit 1
  sleep 0.5
done

cd /app/web
PORT="$PORT" HOSTNAME=0.0.0.0 node apps/web/server.js &
web=$!

trap 'kill -TERM "$api" "$web" 2>/dev/null' TERM INT

status=0
wait -n "$api" "$web" || status=$?
kill -TERM "$api" "$web" 2>/dev/null
wait
exit "$status"
