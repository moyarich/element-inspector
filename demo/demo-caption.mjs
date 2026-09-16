import { importHTMLElement } from "./import-html-element.mjs";

const DEMO_CAPTION_TAG_NAME = "demo-caption";
const componentUrl = new URL(
  "./elements/demo-caption/demo-caption-element.mjs",
  import.meta.url,
);
async function registerDemoCaptionElement(page) {
  await importHTMLElement({
    page,
    tagName: DEMO_CAPTION_TAG_NAME,
    componentUrl,
  });
}

export async function showDemoCaption({ page, caption }) {
  await registerDemoCaptionElement(page);
  await page.evaluate(
    ({ tagName, caption }) => {
      let element = document.querySelector(tagName);
      if (!element) {
        element = document.createElement(tagName);
        element.setAttribute("popover", "manual");
        document.documentElement.append(element);
      }
      if (
        typeof element.showPopover === "function" &&
        !element.matches(":popover-open")
      ) {
        element.showPopover();
      }
      element.caption = { ...caption, visible: true };
    },
    { tagName: DEMO_CAPTION_TAG_NAME, caption },
  );
}

export async function hideDemoCaption({ page }) {
  await page.evaluate((tagName) => {
    const element = document.querySelector(tagName);
    if (element) element.caption = { ...element.caption, visible: false };
  }, DEMO_CAPTION_TAG_NAME);
}
