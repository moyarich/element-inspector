# Element Inspector Developer Guide

This guide contains development-only setup and tooling for Element Inspector.

For manual loading of downloaded release packages, see [manual-install.md](manual-install.md).

## Build from source

Requirements:

- A current Node.js release
- npm

Install dependencies:

```bash
npm install
```

### Local browser install

Use the interactive launcher to install/update or uninstall Element Inspector and choose the target browser with `fzf`:

```bash
npm run local
```

Detected Chrome, Chrome Canary/Beta, Edge, Brave, Chromium, Firefox, and Firefox Developer Edition installations are offered when available. You can bypass `fzf` by passing the action and browser slug directly:

```bash
bash ./scripts/local-extension.sh install firefox
bash ./scripts/local-extension.sh uninstall firefox
```

#### Firefox

Firefox install/update targets your regular Firefox profile rather than a temporary development profile.

The launcher:

1. Builds the latest local Firefox source.
2. Assigns a unique local version so Firefox treats subsequent runs as updates.
3. Signs that build through Mozilla as an unlisted XPI.
4. Opens the signed XPI in regular Firefox.
5. Lets Firefox confirm the install/update in the browser.

Firefox Release requires signed extensions for persistent installation. Configure Mozilla Add-ons API credentials either in `.env`:

```text
WEB_EXT_API_KEY=...
WEB_EXT_API_SECRET=...
```

or through a supported `web-ext` configuration file.

Signed local Firefox artifacts are written under:

```text
${XDG_STATE_HOME:-~/.local/state}/element-inspector/firefox-signed
```

Set `ELEMENT_INSPECTOR_LOCAL_STATE_DIR` to override the local state directory.

Firefox uninstall opens `about:addons` in the regular browser so the installed extension can be removed from that profile.

#### Chromium browsers

Chromium-family local runs continue to use script-managed development profiles under:

```text
${XDG_STATE_HOME:-~/.local/state}/element-inspector/profiles
```

Uninstall removes only the selected script-managed Chromium profile.

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
