export function cssEscape(value: string): string {
  const cssApi = (
    window as Window & { CSS?: { escape?: (v: string) => string } }
  ).CSS;

  return cssApi?.escape
    ? cssApi.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
