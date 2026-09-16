export { getCssVariableText, getResolvedCssVariableEntries } from "./cssVariables";
import type { InspectorViewModel } from "../../InspectorPanelRenderer";
import { renderCodeTab } from "../shared/renderCodeTab";

export function renderVariablesTab({ model }: { model: InspectorViewModel }): string {
  return renderCodeTab({
    source: model.cssVariableText ?? "",
    action: "copy-vars",
    buttonLabel: "Copy CSS vars",
    emptyMessage: "No CSS variables found.",
    language: "css",
  });
}
