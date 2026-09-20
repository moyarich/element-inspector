#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
ENV_FILE="${PROJECT_DIRECTORY}/.env"
WEB_EXT_EXECUTABLE="${PROJECT_DIRECTORY}/node_modules/.bin/web-ext"
STATE_DIRECTORY="${ELEMENT_INSPECTOR_LOCAL_STATE_DIR:-${XDG_STATE_HOME:-${HOME}/.local/state}/element-inspector}"
PROFILES_DIRECTORY="${STATE_DIRECTORY}/profiles"
FIREFOX_ARTIFACTS_DIRECTORY="${STATE_DIRECTORY}/firefox-signed"

usage() {
  printf '%s\n' \
    "Usage: scripts/local-extension.sh [install|uninstall] [browser]" \
    "" \
    "Interactive local browser install/update and uninstall for Element Inspector." \
    "" \
    "Examples:" \
    "  scripts/local-extension.sh" \
    "  scripts/local-extension.sh install" \
    "  scripts/local-extension.sh install firefox" \
    "  scripts/local-extension.sh uninstall firefox"
}

is_command_present() {
  command -v "$1" >/dev/null 2>&1
}

load_environment() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    return
  fi

  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
}

install_fzf() {
  if is_command_present fzf; then
    return
  fi

  printf '\nChecking for fzf installation...\n'

  if is_command_present brew; then
    printf 'Installing fzf via Homebrew...\n'
    brew install fzf
    return
  fi

  printf 'Error: fzf is required for interactive selection.\n' >&2
  printf 'Install fzf with your package manager, or pass the browser slug directly.\n' >&2
  exit 1
}

resolve_command() {
  local command_name="$1"

  if is_command_present "${command_name}"; then
    command -v "${command_name}"
  fi
}

emit_browser() {
  local label="$1"
  local engine="$2"
  local slug="$3"
  local executable="$4"
  local action="$5"
  local profile_directory="${PROFILES_DIRECTORY}/${slug}"

  if [[ "${action}" == "install" ]]; then
    [[ -n "${executable}" && -x "${executable}" ]] || return 0
  elif [[ "${engine}" == "firefox" ]]; then
    [[ -n "${executable}" && -x "${executable}" ]] || return 0
  else
    [[ -d "${profile_directory}" || ( -n "${executable}" && -x "${executable}" ) ]] || return 0
  fi

  printf '%s\t%s\t%s\t%s\n' "${label}" "${engine}" "${slug}" "${executable:--}"
}

list_browsers() {
  local action="$1"
  local os_name
  os_name="$(uname -s)"

  if [[ "${os_name}" == "Darwin" ]]; then
    emit_browser "Google Chrome" "chromium" "chrome" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "${action}"
    emit_browser "Google Chrome Canary" "chromium" "chrome-canary" "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" "${action}"
    emit_browser "Google Chrome Beta" "chromium" "chrome-beta" "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta" "${action}"
    emit_browser "Microsoft Edge" "chromium" "edge" "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" "${action}"
    emit_browser "Brave Browser" "chromium" "brave" "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" "${action}"
    emit_browser "Chromium" "chromium" "chromium" "/Applications/Chromium.app/Contents/MacOS/Chromium" "${action}"
    emit_browser "Firefox" "firefox" "firefox" "/Applications/Firefox.app/Contents/MacOS/firefox" "${action}"
    emit_browser "Firefox Developer Edition" "firefox" "firefox-developer" "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox" "${action}"

    emit_browser "Google Chrome (user)" "chromium" "chrome-user" "${HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "${action}"
    emit_browser "Microsoft Edge (user)" "chromium" "edge-user" "${HOME}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" "${action}"
    emit_browser "Brave Browser (user)" "chromium" "brave-user" "${HOME}/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" "${action}"
    emit_browser "Firefox (user)" "firefox" "firefox-user" "${HOME}/Applications/Firefox.app/Contents/MacOS/firefox" "${action}"
    return
  fi

  local executable

  executable="$(resolve_command google-chrome-stable || true)"
  emit_browser "Google Chrome" "chromium" "chrome" "${executable}" "${action}"

  executable="$(resolve_command google-chrome-beta || true)"
  emit_browser "Google Chrome Beta" "chromium" "chrome-beta" "${executable}" "${action}"

  executable="$(resolve_command google-chrome || true)"
  emit_browser "Google Chrome" "chromium" "chrome-alt" "${executable}" "${action}"

  executable="$(resolve_command microsoft-edge-stable || true)"
  emit_browser "Microsoft Edge" "chromium" "edge" "${executable}" "${action}"

  executable="$(resolve_command microsoft-edge || true)"
  emit_browser "Microsoft Edge" "chromium" "edge-alt" "${executable}" "${action}"

  executable="$(resolve_command brave-browser || true)"
  emit_browser "Brave Browser" "chromium" "brave" "${executable}" "${action}"

  executable="$(resolve_command chromium || true)"
  emit_browser "Chromium" "chromium" "chromium" "${executable}" "${action}"

  executable="$(resolve_command chromium-browser || true)"
  emit_browser "Chromium" "chromium" "chromium-alt" "${executable}" "${action}"

  executable="$(resolve_command firefox || true)"
  emit_browser "Firefox" "firefox" "firefox" "${executable}" "${action}"

  executable="$(resolve_command firefox-developer-edition || true)"
  emit_browser "Firefox Developer Edition" "firefox" "firefox-developer" "${executable}" "${action}"
}

select_action() {
  local selection

  install_fzf

  selection="$(printf '%s\n' \
    $'install\tInstall or update Element Inspector using the latest local source' \
    $'uninstall\tRemove Element Inspector from the selected browser' | \
    fzf \
      --height=60% \
      --layout=reverse \
      --border \
      --delimiter=$'\t' \
      --with-nth=1,2 \
      --prompt='Action › ' \
      --header='Enter: select action  Esc: cancel')" || exit 0

  printf '%s' "${selection%%$'\t'*}"
}

select_browser() {
  local action="$1"
  local requested_slug="${2:-}"
  local browsers
  local selection

  browsers="$(list_browsers "${action}")"

  if [[ -z "${browsers}" ]]; then
    printf 'Error: no supported browser was detected.\n' >&2
    exit 1
  fi

  if [[ -n "${requested_slug}" ]]; then
    while IFS=$'\t' read -r label engine slug executable; do
      if [[ "${slug}" == "${requested_slug}" ]]; then
        printf '%s\t%s\t%s\t%s' "${label}" "${engine}" "${slug}" "${executable}"
        return
      fi
    done <<< "${browsers}"

    printf 'Error: browser "%s" is not available for %s.\n' "${requested_slug}" "${action}" >&2
    printf 'Available browser slugs:\n' >&2
    while IFS=$'\t' read -r label engine slug executable; do
      printf '  %s (%s)\n' "${slug}" "${label}" >&2
    done <<< "${browsers}"
    exit 1
  fi

  install_fzf

  selection="$(printf '%s\n' "${browsers}" | \
    fzf \
      --height=80% \
      --layout=reverse \
      --border \
      --delimiter=$'\t' \
      --with-nth=1,2 \
      --prompt='Browser › ' \
      --header='Enter: select browser  Esc: cancel')" || exit 0

  printf '%s' "${selection}"
}

require_install_dependencies() {
  if ! is_command_present npm; then
    printf 'Error: npm is required.\n' >&2
    exit 1
  fi

  if ! is_command_present node; then
    printf 'Error: Node.js is required.\n' >&2
    exit 1
  fi

  if [[ ! -x "${WEB_EXT_EXECUTABLE}" ]]; then
    printf 'Error: local web-ext executable not found: %s\n' "${WEB_EXT_EXECUTABLE}" >&2
    printf 'Run npm install before using the local browser installer.\n' >&2
    exit 1
  fi
}

set_firefox_local_version() {
  local manifest_path="${PROJECT_DIRECTORY}/dist/manifest.json"

  node - "${manifest_path}" <<'NODE'
const fs = require("node:fs");

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const baseVersion = String(manifest.version ?? "1.0");
const parts = baseVersion.split(".");
const major = Number.parseInt(parts[0] || "1", 10);
const minor = Number.parseInt(parts[1] || "0", 10);
const now = new Date();

const datePart = Number(
  [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join(""),
);

const timeDigits = Number(
  [
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
    String(now.getUTCMilliseconds()).padStart(3, "0"),
  ].join(""),
);

const timePart = 100000000 + timeDigits;
manifest.version = `${major}.${minor}.${datePart}.${timePart}`;

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(manifest.version);
NODE
}

sign_firefox_extension() {
  local signed_version="$1"
  local xpi_path

  load_environment
  rm -rf -- "${FIREFOX_ARTIFACTS_DIRECTORY}"
  mkdir -p -- "${FIREFOX_ARTIFACTS_DIRECTORY}"

  printf 'Signing Firefox local version %s through Mozilla…\n' "${signed_version}"

  if ! "${WEB_EXT_EXECUTABLE}" sign \
    --channel unlisted \
    --source-dir "${PROJECT_DIRECTORY}/dist" \
    --artifacts-dir "${FIREFOX_ARTIFACTS_DIRECTORY}"; then
    printf '\nError: Firefox Release requires a Mozilla-signed XPI for persistent installation.\n' >&2
    printf 'Add WEB_EXT_API_KEY and WEB_EXT_API_SECRET to .env, or configure web-ext signing credentials.\n' >&2
    exit 1
  fi

  xpi_path="$(find "${FIREFOX_ARTIFACTS_DIRECTORY}" -maxdepth 1 -type f -name '*.xpi' -print | head -n 1)"

  if [[ -z "${xpi_path}" ]]; then
    printf 'Error: Mozilla signing completed without producing an XPI.\n' >&2
    exit 1
  fi

  printf '%s' "${xpi_path}"
}

open_firefox_xpi() {
  local executable="$1"
  local xpi_path="$2"
  local xpi_url

  xpi_url="$(node -e '
    const { pathToFileURL } = require("node:url");
    process.stdout.write(pathToFileURL(process.argv[1]).href);
  ' "${xpi_path}")"

  "${executable}" --new-tab "${xpi_url}" >/dev/null 2>&1 &

  printf '\nFirefox opened the signed XPI in your regular profile.\n'
  printf 'Confirm the Firefox install/update prompt to finish.\n'
}

install_chromium_extension() {
  local label="$1"
  local slug="$2"
  local executable="$3"
  local profile_directory="${PROFILES_DIRECTORY}/${slug}"

  mkdir -p -- "${PROFILES_DIRECTORY}"

  printf '\nBrowser: %s\n' "${label}"
  printf 'Development profile: %s\n\n' "${profile_directory}"

  npm run build:chrome

  "${WEB_EXT_EXECUTABLE}" run \
    --target chromium \
    --source-dir "${PROJECT_DIRECTORY}/dist" \
    --chromium-binary "${executable}" \
    --chromium-profile "${profile_directory}" \
    --profile-create-if-missing
}

install_firefox_extension() {
  local label="$1"
  local executable="$2"
  local signed_version
  local xpi_path

  printf '\nBrowser: %s\n' "${label}"
  printf 'Target: regular Firefox profile\n\n'

  npm run build:firefox
  signed_version="$(set_firefox_local_version)"
  xpi_path="$(sign_firefox_extension "${signed_version}")"

  printf '\nSigned XPI: %s\n' "${xpi_path}"
  open_firefox_xpi "${executable}" "${xpi_path}"
}

install_extension() {
  local label="$1"
  local engine="$2"
  local slug="$3"
  local executable="$4"

  require_install_dependencies
  cd -- "${PROJECT_DIRECTORY}"

  case "${engine}" in
    chromium)
      install_chromium_extension "${label}" "${slug}" "${executable}"
      ;;
    firefox)
      install_firefox_extension "${label}" "${executable}"
      ;;
    *)
      printf 'Unsupported browser engine: %s\n' "${engine}" >&2
      exit 1
      ;;
  esac
}

uninstall_chromium_extension() {
  local label="$1"
  local slug="$2"
  local profile_directory="${PROFILES_DIRECTORY}/${slug}"

  if [[ ! -d "${profile_directory}" ]]; then
    printf 'No local Element Inspector profile exists for %s.\n' "${label}"
    return
  fi

  if is_command_present pgrep && pgrep -f "${profile_directory}" >/dev/null 2>&1; then
    printf 'Error: %s is still using the local Element Inspector profile.\n' "${label}" >&2
    printf 'Close that browser window, then run uninstall again.\n' >&2
    exit 1
  fi

  rm -rf -- "${profile_directory}"

  printf 'Removed local Element Inspector profile for %s:\n%s\n' \
    "${label}" \
    "${profile_directory}"

  rmdir "${PROFILES_DIRECTORY}" >/dev/null 2>&1 || true
}

uninstall_firefox_extension() {
  local label="$1"
  local executable="$2"

  "${executable}" --new-tab "about:addons" >/dev/null 2>&1 &

  printf 'Opened Firefox Add-ons Manager for %s.\n' "${label}"
  printf 'Remove Element Inspector there to uninstall it from the regular profile.\n'
}

uninstall_extension() {
  local label="$1"
  local engine="$2"
  local slug="$3"
  local executable="$4"

  case "${engine}" in
    chromium)
      uninstall_chromium_extension "${label}" "${slug}"
      ;;
    firefox)
      uninstall_firefox_extension "${label}" "${executable}"
      ;;
    *)
      printf 'Unsupported browser engine: %s\n' "${engine}" >&2
      exit 1
      ;;
  esac

  rmdir "${STATE_DIRECTORY}" >/dev/null 2>&1 || true
}

action="${1:-}"
requested_browser="${2:-}"

case "${action}" in
  "")
    action="$(select_action)"
    ;;
  install|uninstall)
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    printf 'Unknown action: %s\n' "${action}" >&2
    usage >&2
    exit 1
    ;;
esac

selection="$(select_browser "${action}" "${requested_browser}")"
IFS=$'\t' read -r browser_label browser_engine browser_slug browser_executable <<< "${selection}"

case "${action}" in
  install)
    install_extension "${browser_label}" "${browser_engine}" "${browser_slug}" "${browser_executable}"
    ;;
  uninstall)
    uninstall_extension "${browser_label}" "${browser_engine}" "${browser_slug}" "${browser_executable}"
    ;;
esac
