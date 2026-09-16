import { escapeAttr, escapeHtml } from "../../../../utils";
import { renderCodeBlock, type CodeLanguage } from "./renderCodeBlock";

export function renderCodeTab({
  source,
  action,
  buttonLabel,
  emptyMessage,
  language,
}: {
  source: string;
  action: string;
  buttonLabel: string;
  emptyMessage: string;
  language: CodeLanguage;
}): string {
  return `
    <section class="tab-panel active" data-state="active">
      <div class="toolbar">
        <button class="btn btn-primary" type="button" data-action="${escapeAttr(action)}">${escapeHtml(buttonLabel)}</button>
      </div>
      ${source.trim() ? renderCodeBlock({ source, language }) : `<div class="empty">${escapeHtml(emptyMessage)}</div>`}
    </section>`;
}
