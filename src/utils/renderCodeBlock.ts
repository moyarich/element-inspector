import type { CodeLanguage } from "./types";
import { escapeHtml } from "./escapeHtml";
import { formatCode } from "./formatCode";
import { highlightCode } from "./highlightCode";

export function renderCodeBlock(code: string, language: CodeLanguage): string {
  const formatted = formatCode(code, language);
  const highlighted = highlightCode(formatted, language);

  return `<div class="code-wrap"><pre class="code hljs"><code>${highlighted}</code></pre></div>`;
}

export function renderPlainCodeBlock(code: string): string {
  return `<div class="code-wrap"><pre class="code">${escapeHtml(code)}</pre></div>`;
}
