#!/usr/bin/env bash
# End-to-end smoke test: fresh local D1/R2 → wrangler dev --local → test/e2e.ts → nightly cron → teardown.
# Nothing touches Cloudflare: state lives in a temp dir and secrets are passed with --var.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8789}"
PASSCODE="e2e-passcode-1234"
STATE="$(mktemp -d "${TMPDIR:-/tmp}/marqum-e2e.XXXXXX")"
WRANGLER=./node_modules/.bin/wrangler
CREATED_DIST=""

cleanup() {
  [ -n "${DEV_PID:-}" ] && kill "$DEV_PID" 2>/dev/null && wait "$DEV_PID" 2>/dev/null || true
  [ -n "$CREATED_DIST" ] && rm -rf ../web/dist
  rm -rf "$STATE"
}
trap cleanup EXIT

# The Worker serves ../web/dist as static assets; use a placeholder if the web app hasn't been built.
if [ ! -d ../web/dist ]; then
  mkdir -p ../web/dist && echo '<!doctype html><title>Marqūm</title>' > ../web/dist/index.html
  CREATED_DIST=1
fi

"$WRANGLER" d1 migrations apply marqum --local --persist-to "$STATE" >/dev/null
"$WRANGLER" dev --local --port "$PORT" --persist-to "$STATE" --test-scheduled \
  --var "PASSCODE:$PASSCODE" --var "TOKEN_PEPPER:e2e-pepper" >"$STATE/dev.log" 2>&1 &
DEV_PID=$!

for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  if ! kill -0 "$DEV_PID" 2>/dev/null; then cat "$STATE/dev.log"; exit 1; fi
  sleep 1
done
curl -sf "http://localhost:$PORT/api/health" >/dev/null || { cat "$STATE/dev.log"; exit 1; }

node --experimental-strip-types --no-warnings test/e2e.ts "http://localhost:$PORT" "$PASSCODE" || {
  echo "--- wrangler dev log ---"; tail -50 "$STATE/dev.log"; exit 1;
}

# Nightly backup cron → R2 nightly/<Karachi date>.json
curl -sf "http://localhost:$PORT/cdn-cgi/handler/scheduled?cron=0+21+*+*+*" >/dev/null
sleep 1
KEY="nightly/$(TZ=Asia/Karachi date +%Y-%m-%d).json"
"$WRANGLER" r2 object get "marqum-backups/$KEY" --local --persist-to "$STATE" --file "$STATE/nightly.json" >/dev/null
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!d.tables.transactions?.length) process.exit(1)' "$STATE/nightly.json"
echo "✓ nightly cron wrote $KEY"
