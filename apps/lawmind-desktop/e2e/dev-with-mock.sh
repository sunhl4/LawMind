#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MOCK_PORT="${LAWMIND_E2E_MOCK_PORT:-48888}"
VITE_PORT="${LAWMIND_E2E_VITE_PORT:-52473}"
# Avoid EADDRINUSE when a previous Playwright run left listeners behind.
for p in "${MOCK_PORT}" "${VITE_PORT}"; do
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${p}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
done
node "$ROOT/e2e/mock-api.mjs" &
MOCK_PID=$!
cleanup() {
  kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
# Brief pause so mock bind completes (avoid race before first browser fetch).
sleep 0.3
exec pnpm exec vite --config "$ROOT/vite.config.ts" --host 127.0.0.1 --port "$VITE_PORT" --mode e2e --strictPort
