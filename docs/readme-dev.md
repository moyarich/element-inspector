# Element Inspector Developer Guide

This guide contains development-only setup and tooling for Element Inspector.

## Build from source

Requirements:

- A current Node.js release
- npm

Install dependencies:

```bash
npm install
```

### Local browser install

For local development on macOS or Linux, use the interactive browser launcher. It builds the correct target and runs Element Inspector in a dedicated development profile, so your normal browser profile is not modified.

Choose the action and browser with `fzf`:

```bash
npm run local
```

Detected Chrome, Chrome Canary/Beta, Edge, Brave, Chromium, Firefox, and Firefox Developer Edition installations are offered when available. You can also bypass `fzf` by passing a browser slug directly:

```bash
bash ./scripts/local-extension.sh install chrome
bash ./scripts/local-extension.sh uninstall chrome
```

Local development profiles are stored under `${XDG_STATE_HOME:-~/.local/state}/element-inspector/profiles`. Set `ELEMENT_INSPECTOR_LOCAL_STATE_DIR` to override that location. Uninstall removes only the selected script-managed profile.

The launcher requires `fzf`. When Homebrew is available, the script can install `fzf` automatically; otherwise install it with your system package manager.

Create a Chrome package:

```bash
npm run build:chrome
```

Create a Firefox package:

```bash
npm run build:firefox
```

The builds create `dist-chrome.zip` and `dist-firefox.zip`. The unpacked extension is written to `dist`.

Run type checking and linting without building:

```bash
npm run lint:types
```

Choose how to run the demo with the interactive picker:

```bash
./scripts/run-demo-interactive.sh
```

The launcher is standalone and does not read `package.json` or invoke npm.
`npm run demo` is also available as a convenience alias.

To regenerate the README demo directly:

```bash
npm run demo:gif
```

The picker can launch Chrome for manual inspection, run the automated smoke
test, or regenerate the README GIF. It requires `fzf` and can install it with
Homebrew when available. GIF generation also requires `ffmpeg`.

