import hljs from "highlight.js/lib/core";
import cssLanguage from "highlight.js/lib/languages/css";
import javascriptLanguage from "highlight.js/lib/languages/javascript";
import xmlLanguage from "highlight.js/lib/languages/xml";
import { escapeHtml } from "./escapeHtml";
import type { CodeLanguage } from "./types";

let isHighlightJsReady = false;

function ensureHighlightJsLanguages(): void {
  if (isHighlightJsReady) return;

  hljs.registerLanguage("css", cssLanguage);
  hljs.registerLanguage("javascript", javascriptLanguage);
  hljs.registerLanguage("html", xmlLanguage);
  hljs.registerLanguage("xml", xmlLanguage);

  isHighlightJsReady = true;
}

export function highlightCode(code: string, language: CodeLanguage): string {
  try {
    ensureHighlightJsLanguages();
    return hljs.highlight(code, { language }).value;
  } catch {
    return escapeHtml(code);
  }
}
