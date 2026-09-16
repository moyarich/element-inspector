import type { InspectorViewModel } from "../../InspectorPanelRenderer";
import { renderCodeBlock } from "../shared/renderCodeBlock";

export function renderCssTab({ model }: { model: InspectorViewModel }): string {
  const source = model.cssText ?? "";
  return `
    <section class="tab-panel active" data-state="active">
      <div class="toolbar">
        <button class="btn btn-primary" type="button" data-action="copy-css">Copy CSS</button>
        <button class="btn btn-secondary" type="button" data-action="download-css">Download CSS</button>
      </div>
      ${source.trim() ? renderCodeBlock({ source, language: "css" }) : `<div class="empty">No CSS found for this element.</div>`}
    </section>`;
}
