import extensionApi from "webextension-polyfill";

const panels = extensionApi.devtools?.panels;

if (!panels) {
  throw new Error("[Moyarich] DevTools panels API is not available.");
}

const panel = await panels.create(
  "Element Inspector",
  "",
  "devtools-panel.html",
);

console.log("[Moyarich] Element Inspector DevTools panel created", panel);
