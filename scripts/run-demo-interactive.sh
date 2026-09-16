#!/usr/bin/env bash

set -euo pipefail

project_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vite_executable="${project_directory}/node_modules/.bin/vite"

is_command_present() {
  command -v "$1" >/dev/null 2>&1
}

install_fzf() {
  printf '\nChecking for fzf installation...\n'

  if is_command_present "fzf"; then
    printf 'fzf is already installed.\n'
    return
  fi

  if is_command_present "brew"; then
    printf 'Installing fzf via Homebrew...\n'
    brew install fzf
    return
  fi

  printf 'Error: fzf is required, and Homebrew is not available to install it.\n' >&2
  printf 'Install fzf using your package manager, then run this command again.\n' >&2
  exit 1
}

list_demo_modes() {
  printf '%s\t%s\n' \
    "Interactive Chrome" \
    "Run every scenario and leave Chrome open for manual inspection"
  printf '%s\t%s\n' \
    "Automated smoke test" \
    "Run every scenario and close Chrome when the checks finish"
  printf '%s\t%s\n' \
    "README GIF" \
    "Record the guided example and regenerate the README animation"
}

build_demo_extension() {
  if [[ ! -x "${vite_executable}" ]]; then
    printf 'Error: local Vite executable not found: %s\n' "${vite_executable}" >&2
    printf 'Install the project dependencies before running the demo.\n' >&2
    exit 1
  fi

  TARGET=chrome "${vite_executable}" build --mode development
}

install_fzf

selection="$(list_demo_modes | fzf \
  --height=80% \
  --layout=reverse \
  --border \
  --delimiter=$'\t' \
  --with-nth=1,2 \
  --prompt='Demo mode › ' \
  --header='Enter: run selected mode  Esc: cancel')" || exit 0

if [[ -z "${selection}" ]]; then
  printf 'No demo mode selected.\n'
  exit 0
fi

mode="${selection%%$'\t'*}"

printf '\nRunning: %s\n\n' "${mode}"
cd "${project_directory}"

case "${mode}" in
  "Interactive Chrome")
    build_demo_extension
    node demo/extension.smoke.mjs
    ;;
  "Automated smoke test")
    build_demo_extension
    node demo/extension.smoke.mjs --ci
    ;;
  "README GIF")
    build_demo_extension
    node demo/create-demo.mjs
    ;;
  *)
    printf 'Unknown demo mode: %s\n' "${mode}" >&2
    exit 1
    ;;
esac
