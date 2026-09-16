import { escapeAttr, escapeHtml } from "../../../../utils";
import type { InspectorViewModel } from "../../InspectorPanelRenderer";

function renderInfoRow({ label, value }: { label: string; value: string }): string {
  return `<div class="info-key">${escapeHtml(label)}</div><div class="info-val">${escapeHtml(value)}</div>`;
}

function renderAttributes({ model }: { model: InspectorViewModel }): string {
  if (!model.attributes.length) return `<div class="empty">No attributes.</div>`;
  return `
    <div><div class="section-label">Attributes</div>
      <table class="attr-table"><tbody>${model.attributes.map((attribute) => `
        <tr><td class="attr-name">${escapeHtml(attribute.name)}</td><td class="attr-val">${escapeHtml(attribute.value)}</td></tr>`).join("")}
      </tbody></table>
    </div>`;
}

function renderSiblings({ model }: { model: InspectorViewModel }): string {
  if (model.siblings.length <= 1) return "";
  return `
    <div><div class="section-label">Siblings</div><div class="siblings-wrap">
      ${model.siblings.map((sibling) => `
        <button class="sib-btn ${sibling.isCurrent ? "current" : ""}" type="button" data-sib-index="${sibling.index}" data-state="${sibling.isCurrent ? "active" : "idle"}" title="${escapeAttr(sibling.selector)}">${escapeHtml(sibling.label)}</button>`).join("")}
    </div></div>`;
}

export function renderInfoTab({ model }: { model: InspectorViewModel }): string {
  return `
    <section class="tab-panel active" data-state="active">
      <div class="toolbar">
        <button class="btn btn-secondary" type="button" data-action="copy-selector">Copy selector</button>
        <button class="btn btn-secondary" type="button" data-action="copy-selector-path">Copy selector path</button>
        ${model.hasParent ? `<button class="btn btn-secondary" type="button" data-action="inspect-parent">Inspect parent</button>` : ""}
      </div>
      <div class="info-grid">
        ${renderInfoRow({ label: "Tag", value: model.info.tagName })}
        ${renderInfoRow({ label: "Selector", value: model.info.selector })}
        ${renderInfoRow({ label: "Path", value: model.info.selectorPath })}
        ${renderInfoRow({ label: "ID", value: model.info.id || "—" })}
        ${renderInfoRow({ label: "Class", value: model.info.className || "—" })}
        ${renderInfoRow({ label: "Size", value: model.info.dimensions })}
        ${renderInfoRow({ label: "Text", value: model.info.text || "—" })}
      </div>
      ${renderAttributes({ model })}
      ${renderSiblings({ model })}
    </section>`;
}
