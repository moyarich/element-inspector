#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
WEB_EXT_EXECUTABLE="${PROJECT_DIRECTORY}/node_modules/.bin/web-ext"
STATE_DIRECTORY="${ELEMENT_INSPECTOR_LOCAL_STATE_DIR:-${XDG_STATE_HOME:-${HOME}/.local/state}/element-inspector}"
PROFILES_DIRECTORY="${STATE_DIRECTORY}/profiles"

usage() {
  printf '%s\n' \
    "Usage: scripts/local-extension.sh [install|uninstall] [browser]" \
    "" \
    "Interactive local browser install/uninstall for Element Inspector." \
    "" \
    "Examples:" \
    "  scripts/local-extension.sh" \
    "  scripts/local-extension.sh install" \
    "  scripts/local-extension.sh install chrome" \
    "  scripts/local-extension.sh uninstall firefox"
}

is_command_present() {
  command -v "$1" >/dev/null 2>&1
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
    $'install\tBuild and launch Element Inspector in a dedicated local browser profile' \
    $'uninstall\tRemove the dedicated local browser profile' | \
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
    if [[ "${action}" == "install" ]]; then
      printf 'Error: no supported browser was detected.\n' >&2
    else
      printf 'No local Element Inspector browser profiles were found.\n'
    fi
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

  if [[ ! -x "${WEB_EXT_EXECUTABLE}" ]]; then
    printf 'Error: local web-ext executable not found: %s\n' "${WEB_EXT_EXECUTABLE}" >&2
    printf 'Run npm install before using the local browser installer.\n' >&2
    exit 1
  fi
}

install_extension() {
  local label="$1"
  local engine="$2"
  local slug="$3"
  local executable="$4"
  local profile_directory="${PROFILES_DIRECTORY}/${slug}"

  require_install_dependencies
  mkdir -p -- "${PROFILES_DIRECTORY}"

  printf '\nBrowser: %s\n' "${label}"
  printf 'Profile: %s\n\n' "${profile_directory}"

  cd -- "${PROJECT_DIRECTORY}"

  case "${engine}" in
    chromium)
      npm run build:chrome
      "${WEB_EXT_EXECUTABLE}" run \
        --target chromium \
        --source-dir "${PROJECT_DIRECTORY}/dist" \
        --chromium-binary "${executable}" \
        --chromium-profile "${profile_directory}" \
        --profile-create-if-missing
      ;;
    firefox)
      npm run build:firefox
      "${WEB_EXT_EXECUTABLE}" run \
        --target firefox-desktop \
        --source-dir "${PROJECT_DIRECTORY}/dist" \
        --firefox "${executable}" \
        --firefox-profile "${profile_directory}" \
        --profile-create-if-missing \
        --keep-profile-changes
      ;;
    *)
      printf 'Unsupported browser engine: %s\n' "${engine}" >&2
      exit 1
      ;;
  esac
}

uninstall_extension() {
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
    uninstall_extension "${browser_label}" "${browser_slug}"
    ;;
esac
