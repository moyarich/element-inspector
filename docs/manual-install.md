# Manual Installation

Use these steps to manually load a downloaded Element Inspector package into a browser.

## Chrome

If you downloaded a release package:

1. Extract `dist-chrome.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted extension directory containing `manifest.json`.

## Firefox

### Persistent installation

Regular Firefox requires a Mozilla-signed XPI for persistent installation.

If you have a signed Element Inspector XPI:

1. Open `about:addons`.
2. Open the Add-ons Manager settings menu.
3. Select **Install Add-on From File…**.
4. Choose the signed `.xpi`.
5. Confirm the Firefox install/update prompt.

Installing a newer signed XPI with the same extension ID updates the existing installation.

For the automated latest-local-source workflow, use `npm run local` and choose Firefox. See [readme-dev.md](readme-dev.md).

### Temporary development installation

Unsigned development builds can still be loaded temporarily:

1. Extract `dist-firefox.zip`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on**.
4. Choose `manifest.json` from the extracted extension directory.

Temporary add-ons are removed when Firefox closes.

After installing or updating Element Inspector, reload pages that were already open so the extension can initialize on them.
