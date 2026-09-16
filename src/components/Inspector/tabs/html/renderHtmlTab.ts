import type { InspectorViewModel } from "../../InspectorPanelRenderer";
import { renderCodeBlock } from "../shared/renderCodeBlock";

export function renderHtmlTab({ model }: { model: InspectorViewModel }): string {
  const source = model.htmlViewMode === "formatted"
    ? (model.formattedHtmlText ?? model.rawHtmlText)
    : model.rawHtmlText;

  return `
    <section class="tab-panel active" data-state="active">
      <div class="toolbar">
        <button class="btn btn-primary" type="button" data-action="copy-html">Copy HTML</button>
        <button class="btn btn-secondary" type="button" data-action="format-toggle">${model.htmlViewMode === "formatted" ? "Raw" : "Formatted"}</button>
      </div>
      ${renderCodeBlock({ source, language: "html" })}
    </section>`;
}
