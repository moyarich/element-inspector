#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
ENV_FILE="${PROJECT_DIRECTORY}/.env"
TARGET="all"
UPLOAD_ONLY=false

usage() {
  printf '%s\n' \
    "Usage: scripts/publish_ext.sh [chrome|firefox|all] [--upload-only]" \
    "" \
    "Builds and publishes the extension using credentials from .env."
}

require_command() {
  local command_name="$1"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "${command_name}" >&2
    exit 1
  fi
}

require_environment() {
  local variable_name

  for variable_name in "$@"; do
    if [[ -z "${!variable_name:-}" ]]; then
      printf 'Missing required .env value: %s\n' "${variable_name}" >&2
      exit 1
    fi
  done
}

json_field() {
  local file_path="$1"
  local field_name="$2"

  node -e '
    const fs = require("node:fs");
    const [filePath, fieldName] = process.argv.slice(1);
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"))[fieldName];
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "${file_path}" "${field_name}"
}

publish_chrome() {
  require_command curl
  require_command node
  require_environment \
    CHROME_PUBLISHER_ID \
    CHROME_EXTENSION_ID \
    CHROME_CLIENT_ID \
    CHROME_CLIENT_SECRET \
    CHROME_REFRESH_TOKEN

  printf 'Building Chrome extension…\n'
  npm run build:chrome

  local package_path="${PROJECT_DIRECTORY}/dist-chrome.zip"
  local token_response
  local upload_response
  local publish_response
  local access_token
  local upload_state
  local item_name="publishers/${CHROME_PUBLISHER_ID}/items/${CHROME_EXTENSION_ID}"

  token_response="$(mktemp)"
  upload_response="$(mktemp)"
  publish_response="$(mktemp)"
  trap 'rm -f -- "${token_response:-}" "${upload_response:-}" "${publish_response:-}"' RETURN

  curl --fail-with-body --silent --show-error \
    --request POST \
    --data-urlencode "client_id=${CHROME_CLIENT_ID}" \
    --data-urlencode "client_secret=${CHROME_CLIENT_SECRET}" \
    --data-urlencode "refresh_token=${CHROME_REFRESH_TOKEN}" \
    --data-urlencode "grant_type=refresh_token" \
    --output "${token_response}" \
    "https://oauth2.googleapis.com/token"

  access_token="$(json_field "${token_response}" access_token)"

  if [[ -z "${access_token}" ]]; then
    printf 'Chrome OAuth response did not contain an access token.\n' >&2
    exit 1
  fi

  printf 'Uploading Chrome package…\n'
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Authorization: Bearer ${access_token}" \
    --header "Content-Type: application/zip" \
    --upload-file "${package_path}" \
    --output "${upload_response}" \
    "https://chromewebstore.googleapis.com/upload/v2/${item_name}:upload"

  upload_state="$(json_field "${upload_response}" uploadState)"

  if [[ "${upload_state}" == *FAIL* || "${upload_state}" == *ERROR* ]]; then
    printf 'Chrome upload failed with state: %s\n' "${upload_state}" >&2
    exit 1
  fi

  printf 'Chrome upload accepted: %s\n' "${upload_state:-status unavailable}"

  if [[ "${UPLOAD_ONLY}" == true ]]; then
    return
  fi

  printf 'Submitting Chrome extension for review…\n'
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Authorization: Bearer ${access_token}" \
    --header "Content-Type: application/json" \
    --data '{}' \
    --output "${publish_response}" \
    "https://chromewebstore.googleapis.com/v2/${item_name}:publish"

  printf 'Chrome extension submitted successfully.\n'
}

publish_firefox() {
  require_environment WEB_EXT_API_KEY WEB_EXT_API_SECRET

  printf 'Building Firefox extension…\n'
  npm run build:firefox

  local channel="${FIREFOX_CHANNEL:-listed}"
  local artifacts_directory="${PROJECT_DIRECTORY}/web-ext-artifacts"

  if [[ "${channel}" != "listed" && "${channel}" != "unlisted" ]]; then
    printf 'FIREFOX_CHANNEL must be listed or unlisted.\n' >&2
    exit 1
  fi

  printf 'Submitting Firefox extension on the %s channel…\n' "${channel}"
  npx web-ext sign \
    --source-dir "${PROJECT_DIRECTORY}/dist" \
    --artifacts-dir "${artifacts_directory}" \
    --channel "${channel}"

  printf 'Firefox extension submitted successfully.\n'
}

for argument in "$@"; do
  case "${argument}" in
    chrome|firefox|all)
      TARGET="${argument}"
      ;;
    --upload-only)
      UPLOAD_ONLY=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "${argument}" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Missing environment file: %s\n' "${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

cd -- "${PROJECT_DIRECTORY}"
require_command npm

case "${TARGET}" in
  chrome)
    publish_chrome
    ;;
  firefox)
    publish_firefox
    ;;
  all)
    publish_chrome
    publish_firefox
    ;;
esac
