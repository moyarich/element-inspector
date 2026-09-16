const CONTENT_SCRIPT_PATH = "assets/content.js";
const LOG_PREFIX = "[Moyarich] Element Inspector";

const platform = typeof browser !== "undefined" ? browser : chrome;

async function loadContentScript() {
  try {
    const contentScriptUrl = platform.runtime.getURL(CONTENT_SCRIPT_PATH);

    await import(contentScriptUrl);
  } catch (error) {
    console.error(`${LOG_PREFIX} content script failed to load.`, error);
  }
}

void loadContentScript();
