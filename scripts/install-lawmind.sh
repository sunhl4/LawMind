#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${LAWMIND_REPO_URL:-https://github.com/sunhl4/LawMind.git}"
REPO_BRANCH="${LAWMIND_REPO_BRANCH:-main}"
INSTALL_DIR="${LAWMIND_INSTALL_DIR:-$HOME/.lawmind/openclaw}"
PRESET="${LAWMIND_PRESET:-qwen-chatlaw}"

echo "[LawMind Installer] macOS/Linux one-click install"
echo "repo: $REPO_URL"
echo "branch: $REPO_BRANCH"
echo "install dir: $INSTALL_DIR"
echo "preset: $PRESET"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing command: $1"
    exit 1
  fi
}

require_cmd git
require_cmd node
require_cmd npm

NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  echo "❌ Node 22+ required. current: $(node -v)"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[LawMind Installer] pnpm not found, installing globally..."
  npm install -g pnpm
fi

mkdir -p "$(dirname "$INSTALL_DIR")"
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[LawMind Installer] updating existing checkout..."
  git -C "$INSTALL_DIR" fetch origin "$REPO_BRANCH"
  git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
  git -C "$INSTALL_DIR" pull --rebase origin "$REPO_BRANCH"
else
  echo "[LawMind Installer] cloning repo..."
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
echo "[LawMind Installer] installing dependencies..."
pnpm install

echo "[LawMind Installer] running onboarding..."
npm run lawmind:onboard -- --preset "$PRESET" --yes --skip-smoke

echo "[LawMind Installer] running env check..."
npm run lawmind:env:check || true

echo ""
echo "✅ Install complete."
echo "Next:"
echo "  cd \"$INSTALL_DIR\""
echo "  npm run lawmind:smoke -- --fail-on-empty-claims"
echo "  npm run lawmind:agent"
