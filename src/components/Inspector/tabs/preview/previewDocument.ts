import { getResolvedCssVariableEntries } from "../variables/cssVariables";
import { escapeAttr } from "../../../../utils/escapeAttr";

export type PreviewDocumentParts = {
  html: string;
  css: string;
  head: string;
};

export type PreviewDocumentSourceInput = {
  rawHtml: string;
  matchedCss: string;
  element: Element;
  parts?: undefined;
};

export type PreviewDocumentPartsInput = {
  parts: PreviewDocumentParts;
  rawHtml?: never;
  matchedCss?: never;
  element?: never;
};

export type PreviewDocumentInput =
  | PreviewDocumentSourceInput
  | PreviewDocumentPartsInput;

function getPreviewAncestorChain(element: Element): Element[] {
  const ancestors: Element[] = [];

  let current = element.parentElement;

  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    ancestors.unshift(current);
    current = current.parentElement;
  }

  return ancestors;
}

function getAttributeText(element: Element): string {
  return Array.from(element.attributes)
    .map((attr) => `${attr.name}="${escapeAttr(attr.value)}"`)
    .join(" ");
}

function getOpeningTag(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const attrs = getAttributeText(element);

  return attrs ? `<${tagName} ${attrs}>` : `<${tagName}>`;
}

function getClosingTag(element: Element): string {
  return `</${element.tagName.toLowerCase()}>`;
}

function getBodyClassText(): string {
  const bodyClass = document.body?.className?.toString().trim();

  return bodyClass ? ` ${bodyClass}` : "";
}

function getPreviewHtml(rawHtml: string, element: Element): string {
  const ancestors = getPreviewAncestorChain(element);

  const wrappedHtml = ancestors.reduceRight(
    (html, ancestor) =>
      `${getOpeningTag(ancestor)}\n${html}\n${getClosingTag(ancestor)}`,
    rawHtml,
  );

  return `<div class="__preview-scope${escapeAttr(
    getBodyClassText(),
  )}">\n${wrappedHtml}\n</div>`;
}

function getReferencedVariableNames({ cssText }: { cssText: string }): Set<string> {
  const names = new Set<string>();
  const variablePattern = /var\(\s*(--[\w-]+)/g;

  for (const match of cssText.matchAll(variablePattern)) {
    names.add(match[1]);
  }

  return names;
}

/**
 * Reduces the inherited page theme to variables referenced by preview CSS,
 * following references inside variable values until the dependency graph is
 * complete.
 */
function getRequiredVariableEntries({
  entries,
  cssText,
}: {
  entries: Array<{ name: string; value: string }>;
  cssText: string;
}): Array<{ name: string; value: string }> {
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  const requiredNames = getReferencedVariableNames({ cssText });
  const pendingNames = Array.from(requiredNames);

  while (pendingNames.length) {
    const name = pendingNames.pop();

    if (!name) {
      continue;
    }

    const entry = entriesByName.get(name);

    if (!entry) {
      continue;
    }

    for (const dependency of getReferencedVariableNames({
      cssText: entry.value,
    })) {
      if (requiredNames.has(dependency)) {
        continue;
      }

      requiredNames.add(dependency);
      pendingNames.push(dependency);
    }
  }

  return entries.filter((entry) => requiredNames.has(entry.name));
}

export function getPreviewDocumentParts(
  rawHtml: string,
  matchedCss: string,
  element: Element,
): PreviewDocumentParts {
  const entries = getRequiredVariableEntries({
    entries: getResolvedCssVariableEntries(element),
    cssText: matchedCss,
  });

  const varBlock = entries.length
    ? `.__preview-scope {\n${entries
        .map(({ name, value }) => `  ${name}: ${value};`)
        .join("\n")}\n}`
    : "";

  const cleanCss = matchedCss.trim();

  const css = [
    "html,body{margin:0;padding:16px;background:#f8fafc;color:#0f172a;font-family:system-ui,sans-serif}",
    "*,*::before,*::after{box-sizing:border-box}",
    varBlock,
    cleanCss,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    html: getPreviewHtml(rawHtml, element),
    css,
    head: "<meta name='viewport' content='width=device-width,initial-scale=1'/>",
  };
}

export function getPreviewDocument(input: PreviewDocumentInput): string {
  const parts = input.parts
    ? input.parts
    : getPreviewDocumentParts(input.rawHtml, input.matchedCss, input.element);

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<meta charset='UTF-8'/>",
    parts.head,
    "<style>",
    parts.css,
    "</style>",
    "</head>",
    "<body>",
    parts.html,
    "</body>",
    "</html>",
  ].join("\n");
}
