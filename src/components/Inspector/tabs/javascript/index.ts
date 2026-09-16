import type { InspectorViewModel } from "../../InspectorPanelRenderer";
import { escapeHtml } from "../../../../utils";
import { formatCode } from "../../../../utils/formatCode";
import { renderCodeBlock } from "../shared/renderCodeBlock";
import { getSourceMatchingText } from "./sourceMatching";

export async function getJavascriptInspectText(el: Element): Promise<string> {
  const source = await getSourceMatchingText(el);

  return formatCode(source, "javascript");
}

export function renderJavascriptTab({ model }: { model: InspectorViewModel }): string {
  const source = model.jsText ?? "";

  return `
    <section class="tab-panel active js-tab-panel" data-state="active">
      <div class="toolbar">
        <button class="btn btn-primary" type="button" data-action="copy-js">Copy JS</button>
      </div>
      ${source.trim() ? renderJavascriptCards({ source }) : '<div class="empty">No JavaScript info found.</div>'}
    </section>`;
}

function renderJavascriptCards({ source }: { source: string }): string {
  const sections = source
    .split(
      /\n{2,}(?=\/\*\s*(?:Direct|HIGH|MEDIUM|Script located|Inline script located|Inline script|No confidently))/,
    )
    .map(parseJavascriptSection)
    .filter(({ code }) => code.trim());

  return `<div class="js-results">${sections
    .map(
      ({ title, location, code }, index) => `
        <article class="js-result-card">
          <header class="js-result-header">
            <div class="js-result-heading">
              <span class="js-result-index">${index + 1}</span>
              <strong>${escapeHtml(title)}</strong>
            </div>
            ${location ? `<code class="js-result-location">${escapeHtml(location)}</code>` : ""}
          </header>
          ${renderCodeBlock({ source: code, language: "javascript" })}
        </article>`,
    )
    .join("")}</div>`;
}

function parseJavascriptSection(section: string): {
  title: string;
  location: string;
  code: string;
} {
  const titleMatch = section.match(/^\/\*\s*([^*\n][^\n]*?)\s*\*\//);
  const title = titleMatch?.[1]?.trim() ?? "Associated JavaScript";
  let code = titleMatch ? section.slice(titleMatch[0].length).trim() : section;
  const sourceMatch = code.match(/^\/\*\s*Source:\s*([^*]+?)\s*\*\//);
  const location = sourceMatch?.[1]?.trim() ?? "";

  if (sourceMatch) {
    code = code.slice(sourceMatch[0].length).trim();
  }

  return { title, location, code };
}
