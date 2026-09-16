import { escapeHtml } from "../../../../utils/escapeHtml";
import { getShortSelector } from "../../../../utils/selectors";

export function getBreadcrumbAncestors(element: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement.parentElement) {
    chain.unshift(current);
    current = current.parentElement;
  }

  return chain;
}

export function renderBreadcrumbHtml(
  ancestors: Element[],
  currentEl: Element,
): string {
  return ancestors
    .map(
      (el, index) =>
        `${index > 0 ? '<span class="bc-sep">›</span>' : ""}<button class="bc-btn ${el === currentEl ? "current" : ""}" data-bc-index="${index}">${escapeHtml(getShortSelector(el))}</button>`,
    )
    .join("");
}
