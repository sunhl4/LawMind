#!/usr/bin/env bash
# Pack LawMind workspace into a tarball with a small manifest.
# Excludes .env / .env.lawmind at the workspace root by default.
#
# Usage:
#   LAWMIND_WORKSPACE_DIR=/path/to/workspace ./scripts/lawmind-backup.sh [output.tar.gz]
#
# Optional:
#   LAWMIND_BACKUP_INCLUDE_ENV=1 — include .env / .env.lawmind (dangerous; encrypt the archive).
#
set -euo pipefail

WS="${LAWMIND_WORKSPACE_DIR:-}"
if [[ -z "${WS}" ]]; then
  echo "LAWMIND_WORKSPACE_DIR is required" >&2
  exit 1
fi
if [[ ! -d "${WS}" ]]; then
  echo "Workspace not a directory: ${WS}" >&2
  exit 1
fi

OUT="${1:-lawmind-workspace-backup-$(date +%Y%m%d-%H%M%S).tar.gz}"
OUT_DIR="$(cd "$(dirname "${OUT}")" && pwd)"
ABS_OUT="${OUT_DIR}/$(basename "${OUT}")"

TMP="$(mktemp -d)"
cleanup() { rm -rf "${TMP}"; }
trap cleanup EXIT

MANIFEST="${TMP}/BACKUP-MANIFEST.txt"
INCLUDE_ENV="${LAWMIND_BACKUP_INCLUDE_ENV:-}"
{
  echo "createdUtc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "workspaceDir=${WS}"
  if [[ "${INCLUDE_ENV}" == "1" ]]; then
    echo "secretsIncluded=true"
    echo "note=WARNING: env files are included. Encrypt before transit; rotate keys after restore if leaked."
  else
    echo "secretsIncluded=false"
    echo "note=Review firm policy before restoring; secrets excluded at workspace root by default."
  fi
} >"${MANIFEST}"

WS_PARENT="$(dirname "${WS}")"
WS_BASE="$(basename "${WS}")"

TAR_EXCLUDES=()
if [[ "${INCLUDE_ENV}" != "1" ]]; then
  TAR_EXCLUDES+=(--exclude="${WS_BASE}/.env.lawmind" --exclude="${WS_BASE}/.env")
fi

tar -czf "${ABS_OUT}" \
  -C "${TMP}" BACKUP-MANIFEST.txt \
  -C "${WS_PARENT}" \
  "${TAR_EXCLUDES[@]}" \
  "${WS_BASE}"

echo "Wrote ${ABS_OUT}"
