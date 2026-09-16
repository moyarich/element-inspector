export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fallback below.
  }

  const textarea = document.createElement("textarea");

  textarea.value = text;
  Object.assign(textarea.style, {
    position: "fixed",
    left: "-9999px",
    top: "0",
  });

  document.documentElement.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
