# Manual Installation

Use these steps to manually load a downloaded Element Inspector release package into a browser.

## Chrome

If you downloaded a release package:

1. Extract `dist-chrome.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted extension directory containing `manifest.json`.

## Firefox

For temporary local installation:

1. Extract `dist-firefox.zip`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on**.
4. Choose `manifest.json` from the extracted extension directory.

Firefox removes temporary add-ons when the browser closes.

After installing or updating Element Inspector, reload pages that were already open so the extension can initialize on them.
