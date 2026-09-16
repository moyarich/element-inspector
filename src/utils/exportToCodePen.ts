export type CodePenExportInput = {
  title?: string;
  description?: string;
  html?: string;
  css?: string;
  js?: string;
  head?: string;
  layout?: "left" | "right" | "top";
  private?: boolean;
  cssExternal?: string[];
  jsExternal?: string[];
  jsPreProcessor?: "none" | "babel" | "typescript" | "coffeescript" | "vue";
  cssPreProcessor?: "none" | "less" | "scss" | "sass" | "stylus";
  htmlPreProcessor?: "none" | "pug" | "markdown";
};

export type CodePenPayload = {
  title?: string;
  description?: string;
  private?: boolean;
  layout?: "left" | "right" | "top";
  html?: string;
  css?: string;
  js?: string;
  head?: string;
  html_pre_processor?: NonNullable<CodePenExportInput["htmlPreProcessor"]>;
  css_pre_processor?: NonNullable<CodePenExportInput["cssPreProcessor"]>;
  js_pre_processor?: NonNullable<CodePenExportInput["jsPreProcessor"]>;
  css_external?: string;
  js_external?: string;
};

const CODEPEN_PREFILL_ENDPOINT = "https://codepen.io/pen/define/";

function cleanString(value: string | undefined): string | undefined {
  const next = value?.trim();

  return next ? next : undefined;
}

function removeEmptyPayloadValues(payload: CodePenPayload): CodePenPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === "string" && value.trim() === "") return false;

      return true;
    }),
  ) as CodePenPayload;
}

export function createCodePenPayload(
  input: CodePenExportInput,
): CodePenPayload {
  return removeEmptyPayloadValues({
    title: cleanString(input.title) ?? "Element Preview",
    description: cleanString(input.description),
    private: input.private ?? false,
    layout: input.layout ?? "left",

    html: input.html ?? "",
    css: input.css ?? "",
    js: input.js ?? "",
    head: input.head ?? "",

    html_pre_processor: input.htmlPreProcessor ?? "none",
    css_pre_processor: input.cssPreProcessor ?? "none",
    js_pre_processor: input.jsPreProcessor ?? "none",

    css_external: input.cssExternal?.filter(Boolean).join(";"),
    js_external: input.jsExternal?.filter(Boolean).join(";"),
  });
}

export function exportToCodePenWithForm(payload: CodePenPayload): void {
  const json = JSON.stringify(payload);

  const form = document.createElement("form");
  form.action = CODEPEN_PREFILL_ENDPOINT;
  form.method = "POST";
  form.target = "_blank";
  form.acceptCharset = "UTF-8";
  form.style.position = "fixed";
  form.style.left = "-9999px";
  form.style.top = "0";

  const data = document.createElement("textarea");
  data.name = "data";
  data.value = json;

  form.appendChild(data);
  document.documentElement.appendChild(form);

  form.submit();

  window.setTimeout(() => {
    form.remove();
  }, 3000);
}

export async function exportToCodePen(
  input: CodePenExportInput,
): Promise<void> {
  exportToCodePenWithForm(createCodePenPayload(input));
}
