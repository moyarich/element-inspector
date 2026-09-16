import { escapeAttr, highlightCode } from "../../../../utils";

export type CodeLanguage = "html" | "css" | "javascript";

export function renderCodeBlock({
  source,
  language,
}: {
  source: string;
  language: CodeLanguage;
}): string {
  return `<div class="code-wrap"><pre class="code hljs"><code class="language-${escapeAttr(language)}">${highlightCode(source, language)}</code></pre></div>`;
}
