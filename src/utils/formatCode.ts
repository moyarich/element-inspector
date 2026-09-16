import beautify from "js-beautify";
import type { CodeLanguage } from "./types";

export function formatCode(code: string, language: CodeLanguage): string {
  try {
    if (language === "html") {
      return beautify.html(code, {
        indent_size: 2,
        wrap_line_length: 0,
        preserve_newlines: true,
        end_with_newline: false,
      });
    }

    if (language === "css") {
      return beautify.css(code, {
        indent_size: 2,
        end_with_newline: false,
      });
    }

    return beautify.js(code, {
      indent_size: 2,
      end_with_newline: false,
    });
  } catch {
    return code;
  }
}
