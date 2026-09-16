import { escapeAttr, escapeHtml } from "../../utils";
import { renderComputedTab } from "./tabs/computed";
import { renderCssTab } from "./tabs/css";
import { renderHtmlTab } from "./tabs/html";
import { renderInfoTab } from "./tabs/info";
import { renderJavascriptTab } from "./tabs/javascript";
import { renderPreviewTab } from "./tabs/preview";
import { renderTreeTab } from "./tabs/tree";
import { renderVariablesTab } from "./tabs/variables";

export type HtmlViewMode = "formatted" | "raw";
export type PreviewViewMode = "rendered" | "source";
export type InspectorElementInfo = {
  selector: string;
  selectorPath: string;
  shortSelector: string;
  tagName: string;
  id: string;
  className: string;
  text: string;
  dimensions: string;
};

export const InspectorTab = {
  PREVIEW: "preview",
  INFO: "info",
  TREE: "tree",
  HTML: "html",
  CSS: "css",
  COMPUTED: "computed",
  VARS: "vars",
  JS: "js",
} as const;
export type InspectorTabId = (typeof InspectorTab)[keyof typeof InspectorTab];
export const TABS = [
  { id: InspectorTab.PREVIEW, label: "Preview" },
  { id: InspectorTab.INFO, label: "Info" },
  { id: InspectorTab.TREE, label: "Tree" },
  { id: InspectorTab.HTML, label: "HTML" },
  { id: InspectorTab.CSS, label: "CSS" },
  { id: InspectorTab.COMPUTED, label: "Computed" },
  { id: InspectorTab.VARS, label: "Vars" },
  { id: InspectorTab.JS, label: "JS" },
] as const;

export type InspectorAttributeViewModel = { name: string; value: string };
export type InspectorNavItemViewModel = {
  index: number;
  label: string;
  selector: string;
  isCurrent: boolean;
};
export type InspectorTreeRowViewModel = {
  index: number;
  depth: number;
  selector: string;
  tagName: string;
  idText: string;
  classText: string;
  childCount: number;
  text: string;
  isTarget: boolean;
};
export type InspectorTreeDepthOptionViewModel = {
  depth: number;
  exactCount: number;
  visibleCount: number;
};
export type InspectorViewModel = {
  info: InspectorElementInfo;
  activeTab: InspectorTabId;
  htmlViewMode: HtmlViewMode;
  previewViewMode: PreviewViewMode;
  domTreeDepthLimit: number;
  domTreeIncludeChildren: boolean;
  domTreeMaxDepth: number;
  domTreeVisibleCount: number;
  domTreeTotalCount: number;
  domTreeDepthOptions: InspectorTreeDepthOptionViewModel[];
  loading: boolean;
  isContentReady: boolean;
  selectorOnlyBreadcrumb: boolean;
  hasParent: boolean;
  attributes: InspectorAttributeViewModel[];
  breadcrumbs: InspectorNavItemViewModel[];
  siblings: InspectorNavItemViewModel[];
  domTreeRows: InspectorTreeRowViewModel[];
  rawHtmlText: string;
  formattedHtmlText: string | null;
  cssText: string | null;
  computedCssText: string | null;
  cssVariableText: string | null;
  jsText: string | null;
  previewDocument: string | null;
};
export type HydrateShellResult = {
  selectorText: string;
  isContentReady: boolean;
};

type TabRenderer = ({ model }: { model: InspectorViewModel }) => string;

const TAB_RENDERERS: Record<InspectorTabId, TabRenderer> = {
  preview: renderPreviewTab,
  info: renderInfoTab,
  tree: renderTreeTab,
  html: renderHtmlTab,
  css: renderCssTab,
  computed: renderComputedTab,
  vars: renderVariablesTab,
  js: renderJavascriptTab,
};

export class InspectorPanelRenderer {
  public renderEmptyPanelHtml(): string {
    return `<div class="inspector-shell"><div class="body"><div class="empty">Select an element to inspect.</div></div></div>`;
  }

  public renderBaseShellHtml(): string {
    return `<div class="inspector-shell"><div class="breadcrumb" data-role="breadcrumb"></div><div class="main"><nav class="tabs" data-role="tabs"></nav><section class="body" data-role="body"></section></div></div>`;
  }

  public hydrateShell({
    root,
    model,
  }: {
    root: HTMLElement;
    model: InspectorViewModel;
  }): HydrateShellResult {
    if (!root.querySelector(".inspector-shell"))
      root.innerHTML = this.renderBaseShellHtml();
    const breadcrumb = root.querySelector<HTMLElement>(
      "[data-role='breadcrumb']",
    );
    const tabs = root.querySelector<HTMLElement>("[data-role='tabs']");
    const body = root.querySelector<HTMLElement>("[data-role='body']");
    if (breadcrumb)
      breadcrumb.innerHTML = model.selectorOnlyBreadcrumb
        ? `<button class="bc-btn current" type="button" data-state="active">${escapeHtml(model.info.shortSelector)}</button>`
        : this.renderBreadcrumbHtml(model);
    if (tabs) tabs.innerHTML = this.renderTabsHtml(model.activeTab);
    if (body) this.renderBody({ body, model });
    return {
      selectorText: model.info.selector,
      isContentReady: model.isContentReady,
    };
  }

  private renderBody({
    body,
    model,
  }: {
    body: HTMLElement;
    model: InspectorViewModel;
  }): void {
    if (model.loading || !model.isContentReady) {
      body.innerHTML = this.renderLoadingHtml(
        model.loading ? "Loading element details…" : "Loading tab content…",
      );
      return;
    }
    body.innerHTML = `<div class="inspector-tab-content" data-role="tab-content">${TAB_RENDERERS[model.activeTab]({ model })}</div>`;
  }

  private renderBreadcrumbHtml(model: InspectorViewModel): string {
    return model.breadcrumbs
      .map(
        (item, index) =>
          `<button class="bc-btn ${item.isCurrent ? "current" : ""}" type="button" data-bc-index="${item.index}" data-state="${item.isCurrent ? "active" : "idle"}" title="${escapeAttr(item.selector)}">${escapeHtml(item.label)}</button>${index < model.breadcrumbs.length - 1 ? `<span class="bc-sep">/</span>` : ""}`,
      )
      .join("");
  }

  private renderTabsHtml(activeTab: InspectorTabId): string {
    return TABS.map((tab) => {
      const active = tab.id === activeTab;
      return `<button class="tab-btn ${active ? "active" : ""}" type="button" data-tab="${tab.id}" data-state="${active ? "active" : "idle"}">${escapeHtml(tab.label)}</button>`;
    }).join("");
  }

  private renderLoadingHtml(message: string): string {
    return `<div class="inspector-loading"><svg class="inspector-loading-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8V2z"></path></svg><span class="inspector-loading-text">${escapeHtml(message)}</span></div>`;
  }
}
