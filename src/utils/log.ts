/**
 * Indicates whether Element Inspector debug logging is enabled.
 *
 * Controlled via the `VITE_INSPECTOR_DEBUG` environment variable.
 *
 * Example:
 * ```
 * VITE_INSPECTOR_DEBUG=true
 * ```
 */
const INSPECTOR_DEBUG = import.meta.env.VITE_INSPECTOR_DEBUG === "true";

if (INSPECTOR_DEBUG) {
  const message = `[Element Inspector] debug mode enabled`;
  console.log(message);
}

/**
 * Writes a debug message to the console when debug mode is enabled.
 *
 * All messages are prefixed with `[Element Inspector]` and support the
 * standard console log levels.
 *
 * @param label - The message to display.
 * @param data - Optional additional data to include with the message.
 * @param type - The console method to use. Defaults to `"log"`.
 *
 * @example
 * log("Inspector initialized");
 *
 * @example
 * log("Element not found", { selector: ".button" }, "warn");
 *
 * @example
 * log("Unexpected error", error, "error");
 */
export const log = (
  label: string,
  data?: unknown,
  type: "log" | "info" | "warn" | "error" = "log",
): void => {
  if (!INSPECTOR_DEBUG) {
    return;
  }

  const message = `[Element Inspector] ${label}`;

  if (data === undefined) {
    console[type](message);
    return;
  }

  console[type](message, data);
};
