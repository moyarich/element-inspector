import { escapeHtml } from "../../../../utils/escapeHtml";
import { getShortSelector } from "../../../../utils/selectors";

export function renderSiblingsHtml(element: Element): string {
  const parent = element.parentElement;

  if (!parent) return '<span class="empty">No siblings</span>';

  const siblings = Array.from(parent.children);

  if (siblings.length <= 1) return '<span class="empty">Only child</span>';

  return `<div class="siblings-wrap">${siblings
    .map(
      (sib, index) =>
        `<button class="sib-btn ${sib === element ? "current" : ""}" data-sib-index="${index}">${escapeHtml(getShortSelector(sib))}</button>`,
    )
    .join("")}</div>`;
}
