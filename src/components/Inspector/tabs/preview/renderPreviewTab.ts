import { escapeAttr } from "../../../../utils";
import type { InspectorViewModel } from "../../InspectorPanelRenderer";
import { renderCodeBlock } from "../shared/renderCodeBlock";

export function renderPreviewTab({ model }: { model: InspectorViewModel }): string {
  const source = model.previewDocument ?? "";
  const toolbar = `
    <div class="toolbar">
      <button class="btn btn-primary" type="button" data-action="toggle-preview-view">${model.previewViewMode === "source" ? "Rendered" : "Source"}</button>
      <button class="btn btn-secondary" type="button" data-action="copy-preview-source">Copy preview source</button>
      <button class="btn btn-secondary" type="button" data-action="download-preview">Download preview</button>
      <button class="btn btn-secondary" type="button" data-action="open-preview-codepen">Open in CodePen</button>
    </div>`;
  const content = model.previewViewMode === "source"
    ? renderCodeBlock({ source, language: "html" })
    : `<iframe class="preview-frame" sandbox="" srcdoc="${escapeAttr(source)}" title="Element preview"></iframe>`;
  return `<section class="tab-panel active" data-state="active">${toolbar}${content}</section>`;
}
