/** CSS URL parsing and normalization utilities. */
const IDENTIFIER_CHARACTER = /[a-zA-Z0-9_-]/;
const ABSOLUTE_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function isIdentifierCharacter(value: string | undefined): boolean {
  return Boolean(value && IDENTIFIER_CHARACTER.test(value));
}

function decodeCssEscapes(value: string): string {
  let result = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== "\\") {
      result += character;
      continue;
    }

    const next = value[index + 1];

    if (next === undefined) {
      continue;
    }

    // A backslash followed by a newline is a CSS line continuation.
    if (next === "\n" || next === "\f") {
      index += 1;
      continue;
    }

    if (next === "\r") {
      index += value[index + 2] === "\n" ? 2 : 1;
      continue;
    }

    let hex = "";
    let cursor = index + 1;

    while (cursor < value.length && hex.length < 6) {
      const candidate = value[cursor];

      if (!/[0-9a-fA-F]/.test(candidate)) {
        break;
      }

      hex += candidate;
      cursor += 1;
    }

    if (hex) {
      const codePoint = Number.parseInt(hex, 16);
      result +=
        codePoint === 0 || codePoint > 0x10ffff
          ? "\uFFFD"
          : String.fromCodePoint(codePoint);

      if (/\s/.test(value[cursor] ?? "")) {
        cursor += 1;
      }

      index = cursor - 1;
      continue;
    }

    result += next;
    index += 1;
  }

  return result;
}

function escapeCssString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\a ")
    .replaceAll("\r", "\\d ")
    .replaceAll("\f", "\\c ");
}

function unwrapCssUrlToken(token: string): string {
  const trimmed = token.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];

  if ((first === '"' || first === "'") && last === first) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function getStyleSheetBaseUrl(
  sheet: CSSStyleSheet | null | undefined,
  fallback = document.baseURI,
): string {
  const candidate = sheet?.href || fallback;

  try {
    return new URL(candidate, fallback).href;
  } catch {
    return fallback;
  }
}

export function getCssRuleBaseUrl(
  rule: CSSRule,
  fallback = document.baseURI,
): string {
  return getStyleSheetBaseUrl(rule.parentStyleSheet, fallback);
}

export function resolveCssAssetUrl(
  rawValue: string,
  baseUrl = document.baseURI,
): string | null {
  const decoded = decodeCssEscapes(rawValue.trim());

  if (!decoded) {
    return null;
  }

  // Fragment-only references usually point to an SVG definition in the same
  // document. Turning them into page URLs can break a self-contained preview.
  if (decoded.startsWith("#")) {
    return decoded;
  }

  // Runtime expressions cannot be resolved until the browser evaluates them.
  if (/^(?:var|env)\(/i.test(decoded)) {
    return null;
  }

  try {
    return new URL(decoded, baseUrl).href;
  } catch {
    // Keep already absolute but non-standard schemes rather than deleting them.
    return ABSOLUTE_SCHEME.test(decoded) ? decoded : null;
  }
}

type CssUrlTransformer = (
  rawValue: string,
  originalToken: string,
) => string;

function transformCssUrlTokens(
  cssText: string,
  transform: CssUrlTransformer,
): string {
  let output = "";
  let index = 0;

  while (index < cssText.length) {
    const character = cssText[index];

    // Preserve comments without inspecting URL-like text inside them.
    if (character === "/" && cssText[index + 1] === "*") {
      const end = cssText.indexOf("*/", index + 2);

      if (end === -1) {
        output += cssText.slice(index);
        break;
      }

      output += cssText.slice(index, end + 2);
      index = end + 2;
      continue;
    }

    // Preserve strings without interpreting url(...) text inside the string.
    if (character === '"' || character === "'") {
      const quote = character;
      let cursor = index + 1;

      while (cursor < cssText.length) {
        if (cssText[cursor] === "\\") {
          cursor += 2;
          continue;
        }

        if (cssText[cursor] === quote) {
          cursor += 1;
          break;
        }

        cursor += 1;
      }

      output += cssText.slice(index, cursor);
      index = cursor;
      continue;
    }

    const maybeUrl = cssText.slice(index, index + 3).toLowerCase() === "url";

    if (
      maybeUrl &&
      !isIdentifierCharacter(cssText[index - 1]) &&
      !isIdentifierCharacter(cssText[index + 3])
    ) {
      let openParen = index + 3;

      while (/\s/.test(cssText[openParen] ?? "")) {
        openParen += 1;
      }

      if (cssText[openParen] === "(") {
        let cursor = openParen + 1;
        let quote: '"' | "'" | null = null;

        while (cursor < cssText.length) {
          const current = cssText[cursor];

          if (quote) {
            if (current === "\\") {
              cursor += 2;
              continue;
            }

            if (current === quote) {
              quote = null;
            }

            cursor += 1;
            continue;
          }

          if (current === '"' || current === "'") {
            quote = current;
            cursor += 1;
            continue;
          }

          if (current === "\\") {
            cursor += 2;
            continue;
          }

          if (current === ")") {
            break;
          }

          cursor += 1;
        }

        if (cursor < cssText.length && cssText[cursor] === ")") {
          const original = cssText.slice(index, cursor + 1);
          const token = cssText.slice(openParen + 1, cursor);
          const rawValue = unwrapCssUrlToken(token);

          output += transform(rawValue, original);
          index = cursor + 1;
          continue;
        }
      }
    }

    output += character;
    index += 1;
  }

  return output;
}

/**
 * Rewrites every CSS url(...) token to an absolute URL.
 *
 * The caller must pass the URL of the stylesheet that owns the declaration.
 * Inline styles should use element.ownerDocument.baseURI.
 */
export function absolutizeCssUrls(
  cssText: string,
  baseUrl = document.baseURI,
): string {
  return transformCssUrlTokens(cssText, (rawValue, originalToken) => {
    const resolved = resolveCssAssetUrl(rawValue, baseUrl);

    return resolved
      ? `url("${escapeCssString(resolved)}")`
      : originalToken;
  });
}

export function extractCssAssetUrls(cssText: string): string[] {
  const urls = new Set<string>();

  transformCssUrlTokens(cssText, (rawValue, originalToken) => {
    const decoded = decodeCssEscapes(rawValue.trim());

    if (decoded && !decoded.startsWith("#")) {
      const resolved = resolveCssAssetUrl(decoded, document.baseURI);

      if (resolved && !/^(?:data|blob):/i.test(resolved)) {
        urls.add(resolved);
      }
    }

    return originalToken;
  });

  return Array.from(urls).sort();
}
