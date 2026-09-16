import { readFile } from "node:fs/promises";

/**
 * Robustly injects an HTMLElement ES Module into a Puppeteer page context.
 * Imports a demo custom element as a real browser module. The CSS data URL is
 * used only because an inspected web page cannot read files from this project.
 * 

 */
export async function importHTMLElement({
  page,
  tagName,
  componentUrl, // Must be a native Node.js URL object (e.g., import.meta.url)
}) {
  // 1. Check if already defined inside the browser context
  const isRegistered = await page.evaluate(
    (name) => Boolean(customElements.get(name)),
    tagName,
  );
  if (isRegistered) return;

  // 2. Resolve the CSS style URL relative to the component
  const styleUrl = new URL(
    componentUrl.pathname.replace(/\.(mjs|js)$/, "-style.css"),
    componentUrl,
  );

  // 3. Read both files from your local disk
  const [componentSource, styleSource] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(styleUrl, "utf8"),
  ]);

  // 4. Extract just the trailing file name to match the import string perfectly
  const relativeStyleUrl = `./${styleUrl.pathname.split("/").at(-1)}`;

  // 5. Convert CSS to Base64 Data URI
  const embeddedStyleUrl = `data:text/css;base64,${Buffer.from(styleSource).toString("base64")}`;

  // 6. Rewrite the source code to use the Data URI
  // FIX: Using regex guarantees it strips both exact quote types and JSON strings safely
  const escapedRelativePath = relativeStyleUrl.replace(
    /[-\/\\^$*+?.()|[\]{}]/g,
    "\\$&",
  );
  const importRegex = new RegExp(`(['"])${escapedRelativePath}\\1`, "g");
  const browserModuleSource = componentSource.replace(
    importRegex,
    `"${embeddedStyleUrl}"`,
  );

  // 7. Convert JavaScript to Base64 Data URI
  // FIX: Must use text/javascript for browsers to evaluate dynamic imports correctly
  const browserModuleUrl = `data:text/javascript;base64,${Buffer.from(browserModuleSource).toString("base64")}`;

  // 8. Execute the module import inside the page
  await page.evaluate(async (moduleUrl) => {
    await import(moduleUrl);
  }, browserModuleUrl);
}
