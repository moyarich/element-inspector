export { getComputedCssText } from "./computedCss";
import type { InspectorViewModel } from "../../InspectorPanelRenderer";
import { renderCodeTab } from "../shared/renderCodeTab";

export function renderComputedTab({ model }: { model: InspectorViewModel }): string {
  return renderCodeTab({
    source: model.computedCssText ?? "",
    action: "copy-computed",
    buttonLabel: "Copy computed CSS",
    emptyMessage: "No computed CSS available.",
    language: "css",
  });
}
