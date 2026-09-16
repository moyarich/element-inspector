import { importHTMLElement } from "./import-html-element.mjs";

const tagName = "demo-cursor-overlay";
const componentUrl = new URL(
  "./elements/demo-cursor-overlay/demo-cursor-overlay-element.mjs",
  import.meta.url,
);
export async function installDemoCursorOverlay({ page }) {
  await importHTMLElement({ page, tagName, componentUrl });
  await page.evaluate((elementName) => {
    document.querySelector(elementName)?.remove();
    const element = document.createElement(elementName);
    document.documentElement.append(element);
  }, tagName);
}
