import type { ElementInfo } from "./types";
import { getElementSelector, getSelectorPath } from "./selectors";

export function getElementInfo(el: Element): ElementInfo {
  const rect = el.getBoundingClientRect();

  return {
    selector: getElementSelector(el),
    selectorPath: getSelectorPath(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || "",
    classes: Array.from(el.classList).join(" "),
    text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300),
    size: `${Math.round(rect.width)} × ${Math.round(rect.height)}`,
    position: `${Math.round(rect.left + window.scrollX)}, ${Math.round(rect.top + window.scrollY)}`,
    childCount: el.children.length,
    attrCount: el.attributes.length,
  };
}
