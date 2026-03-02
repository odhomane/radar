#!/usr/bin/env bash
set -euo pipefail

REPO="odhomane/radar"
TAG="weekly-desktop"
ASSET="radar-desktop_weekly_darwin_universal.zip"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
TMP_DIR="$(mktemp -d -t radar-weekly-update.XXXXXX)"
LOG_PREFIX="[radar-weekly-update]"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "${LOG_PREFIX} downloading ${DOWNLOAD_URL}"
curl -fL "${DOWNLOAD_URL}" -o "${TMP_DIR}/${ASSET}"

echo "${LOG_PREFIX} extracting archive"
unzip -q "${TMP_DIR}/${ASSET}" -d "${TMP_DIR}"

SOURCE_APP="${TMP_DIR}/Radar.app"
if [[ ! -d "${SOURCE_APP}" ]]; then
  echo "${LOG_PREFIX} expected app bundle not found at ${SOURCE_APP}" >&2
  exit 1
fi

TARGET_APP="/Applications/Radar.app"
if [[ ! -w "/Applications" ]]; then
  TARGET_APP="${HOME}/Applications/Radar.app"
  mkdir -p "${HOME}/Applications"
  echo "${LOG_PREFIX} /Applications is not writable; using ${TARGET_APP}"
fi

echo "${LOG_PREFIX} installing to ${TARGET_APP}"
rm -rf "${TARGET_APP}"
ditto "${SOURCE_APP}" "${TARGET_APP}"

echo "${LOG_PREFIX} update complete"
