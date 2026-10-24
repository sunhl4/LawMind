#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MOCK_PORT="${LAWMIND_E2E_MOCK_PORT:-48888}"
VITE_PORT="${LAWMIND_E2E_VITE_PORT:-52473}"
# Renderer boots only via the Electron preload stub injected by Playwright.
for p in "${MOCK_PORT}" "${VITE_PORT}"; do
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti "tcp:${p}" 2>/dev/null || true)"
    if [[ -n "${pids}" ]]; then
      # shellcheck disable=SC2086
      kill -9 ${pids} 2>/dev/null || true
    fi
  fi
done
node "$ROOT/e2e/mock-api.mjs" &
MOCK_PID=$!
cleanup() {
  kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 画布 sandbox 运行时是**不入库**的 esbuild 产物（`.gitignore` 里那条），
# `src/renderer/canvas/CanvasFileView.tsx` 用 `./sandbox-runtime.js?raw` 引它。
# 全新克隆 / CI 上没有这个文件时，Vite 对该模块解析失败 → 整页白屏 →
# 每个用例都在 `gotoShell` 等 `.lm-shell` 等满 60s 后超时，
# 20 分钟作业预算只够跑 18 条用例，症状看起来像「UI 全坏」。
# 所以起 Vite 之前补构建（只在缺失时，不覆盖开发者已构建的产物）。
SANDBOX_RUNTIME="$ROOT/src/renderer/canvas/sandbox-runtime.js"
if [[ ! -f "$SANDBOX_RUNTIME" ]]; then
  echo "[e2e] building canvas sandbox runtime (missing generated artifact)"
  node "$ROOT/scripts/build-canvas-sandbox.mjs"
fi

# Brief pause so mock bind completes (avoid race before first browser fetch).
sleep 0.3
exec pnpm exec vite --config "$ROOT/vite.config.ts" --host 127.0.0.1 --port "$VITE_PORT" --mode e2e --strictPort
