#!/usr/bin/env bash
set -euo pipefail

REPO="odhomane/radar"
TMP_DIR="$(mktemp -d -t radar-weekly-update.XXXXXX)"
LOG_PREFIX="[radar-weekly-update]"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "${LOG_PREFIX} resolving latest desktop release from ${API_URL}"
RELEASE_JSON="${TMP_DIR}/release.json"
curl -fsSL "${API_URL}" -o "${RELEASE_JSON}"

ASSET_URL="$(python3 - "${RELEASE_JSON}" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    release = json.load(fh)

for asset in release.get("assets", []):
    name = asset.get("name", "")
    if name.startswith("radar-desktop_") and name.endswith("_darwin_universal.zip"):
        print(asset["browser_download_url"])
        raise SystemExit(0)

raise SystemExit("no darwin desktop asset found in latest release")
PY
)"

ASSET="$(basename "${ASSET_URL}")"

echo "${LOG_PREFIX} downloading ${ASSET_URL}"
curl -fL "${ASSET_URL}" -o "${TMP_DIR}/${ASSET}"

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
