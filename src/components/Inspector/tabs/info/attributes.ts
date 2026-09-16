import { escapeHtml } from "../../../../utils/escapeHtml";

export function getAttributesHtml(el: Element): string {
  const attrs = Array.from(el.attributes);

  if (!attrs.length) return '<span class="empty">No attributes</span>';

  return `<table class="attr-table">${attrs
    .map(
      (attr) =>
        `<tr><td class="attr-name">${escapeHtml(attr.name)}</td><td class="attr-val">${escapeHtml(JSON.stringify(attr.value))}</td></tr>`,
    )
    .join("")}</table>`;
}
