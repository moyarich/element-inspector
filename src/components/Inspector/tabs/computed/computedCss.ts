import { getElementSelector } from "../../../../utils/selectors";
import { absolutizeCssUrls } from "../css/cssUrls";

export function getComputedCssText(el: Element): string {
  const computedStyle = window.getComputedStyle(el);
  const baseUrl = el.ownerDocument.baseURI;

  const props = Array.from(computedStyle)
    .sort()
    .map((prop) => {
      const value = absolutizeCssUrls(
        computedStyle.getPropertyValue(prop),
        baseUrl,
      );

      return `  ${prop}: ${value};`;
    })
    .join("\n");

  return `/* All ${Array.from(computedStyle).length} computed properties */\n${getElementSelector(el)} {\n${props}\n}`;
}
