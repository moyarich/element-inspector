import { escapeAttr, escapeHtml } from "../../../../utils";
import type {
  InspectorTreeRowViewModel,
  InspectorViewModel,
} from "../../InspectorPanelRenderer";

function renderTreeRow({ row }: { row: InspectorTreeRowViewModel }): string {
  return `
    <div class="tree-row ${row.isTarget ? "target" : ""}" data-tree-row-idx="${row.index}" style="padding-left: ${8 + row.depth * 14}px" title="${escapeAttr(row.selector)}">
      <span class="tree-tag">&lt;${escapeHtml(row.tagName)}&gt;</span>
      ${row.idText ? `<span class="tree-id">${escapeHtml(row.idText)}</span>` : ""}
      ${row.classText ? `<span class="tree-cls">${escapeHtml(row.classText)}</span>` : ""}
      ${row.childCount ? `<span class="tree-count">(${row.childCount})</span>` : ""}
      ${row.text ? `<span class="tree-txt">${escapeHtml(row.text)}</span>` : ""}
    </div>`;
}

export function renderTreeTab({ model }: { model: InspectorViewModel }): string {
  return `
    <section class="tab-panel active" data-state="active">
      <div class="tree-controls">
        <label><span class="section-label">Depth</span>
          <select class="tree-select" data-tree-depth>
            ${model.domTreeDepthOptions.map((option) => `
              <option value="${option.depth}" ${option.depth === model.domTreeDepthLimit ? "selected" : ""}>
                depth: ${option.depth} · nodes: ${option.visibleCount}
              </option>`).join("")}
          </select>
        </label>
        <button class="tree-toggle ${model.domTreeIncludeChildren ? "active" : ""}" type="button" data-tree-children aria-pressed="${model.domTreeIncludeChildren ? "true" : "false"}">
          <span class="tree-toggle-track"><span class="tree-toggle-thumb"></span></span>
          <span class="tree-toggle-text">${model.domTreeIncludeChildren ? "Showing" : "Hiding"} children</span>
        </button>
      </div>
      <div class="tree-meta">Showing ${model.domTreeVisibleCount} of ${model.domTreeTotalCount} nodes · Full depth ${model.domTreeMaxDepth}</div>
      <div class="tree-wrap">
        ${model.domTreeRows.length ? model.domTreeRows.map((row) => renderTreeRow({ row })).join("") : `<div class="empty">No DOM tree rows available.</div>`}
      </div>
    </section>`;
}
