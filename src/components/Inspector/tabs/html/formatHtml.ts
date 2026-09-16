/** Formats raw markup for the HTML tab. */
export function formatHtml(rawHtml: string): string {
  const tab = "  ";
  let result = "";
  let indent = "";

  rawHtml.split(/>\s*</).forEach((part, index, parts) => {
    let line = index > 0 ? `<${part}` : part;

    if (index < parts.length - 1) line = `${line}>`;
    if (/^<\/\w/.test(line)) indent = indent.slice(tab.length);

    result += `${indent}${line}\n`;

    if (
      /^<\w[^>]*[^/]?>$/.test(line) &&
      !line.includes("</") &&
      !line.endsWith("/>")
    ) {
      indent += tab;
    }
  });

  return result.trim();
}
