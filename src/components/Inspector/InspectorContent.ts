import {
  copyText,
  createCodePenPayload,
  downloadTextFile,
  exportToCodePenWithForm,
  getElementSelector,
  getSelectorPath,
  getShortSelector,
} from "../../utils";

import { getComputedCssText } from "./tabs/computed";
import { getCssBundle } from "./tabs/css";
import { formatCode } from "./tabs/html";
import { getBreadcrumbAncestors } from "./tabs/info";
import { getJavascriptInspectText } from "./tabs/javascript";
import {
  getPreviewDocument,
  getPreviewDocumentParts,
  type PreviewDocumentParts,
} from "./tabs/preview";
import {
  buildDomTreeSnapshot,
  getDomTreeRowsFromSnapshot,
} from "./tabs/tree";
import { getCssVariableText } from "./tabs/variables";

import {
  InspectorPanelRenderer,
  InspectorTab,
  type HtmlViewMode,
  type InspectorElementInfo,
  type InspectorTabId,
  type InspectorTreeRowViewModel,
  type InspectorViewModel,
  type PreviewViewMode,
} from "./InspectorPanelRenderer";

export type InspectorContentOptions = {
  onSelectorChange?: (selectorText: string) => void;
  onRequestHighlightElement?: (element: Element) => void;
  onRequestInspectElement?: (element: Element) => void;
  onRequestToast?: (message: string) => void;
  onError?: (message: string, error: unknown) => void;
  onTreeDepthChange?: (depth: number) => void;
  onTreeChildrenToggle?: (includeChildren: boolean) => void;
};

type InspectorCssBundle = {
  cssText: string;
  previewCssText: string;
};

type DomTreeSnapshot = ReturnType<typeof buildDomTreeSnapshot>;
type DomTreeRows = ReturnType<typeof getDomTreeRowsFromSnapshot>;

type InspectorRenderContext = {
  element: Element;
  info: InspectorElementInfo;
  rawHtmlText: string;
  formattedHtmlText: string | null;
  cssBundle: InspectorCssBundle | null;
  computedCssText: string | null;
  cssVariableText: string | null;
  jsText: string | null;
  previewParts: PreviewDocumentParts | null;
  previewDocument: string | null;
  domTreeSnapshot: DomTreeSnapshot | null;
};

type InspectorActionId =
  | "copy-selector"
  | "copy-selector-path"
  | "copy-html"
  | "copy-css"
  | "copy-computed"
  | "copy-vars"
  | "copy-js"
  | "copy-preview-source"
  | "download-css"
  | "inspect-parent"
  | "format-toggle"
  | "toggle-preview-view"
  | "download-preview"
  | "open-preview-codepen";

type InspectorActionHandler = (el: Element) => void | Promise<void>;

export class InspectorContent {
  private mountRoot: HTMLElement | null = null;

  private selectedElement: Element | null = null;
  private context: InspectorRenderContext | null = null;

  private activeTab: InspectorTabId = InspectorTab.PREVIEW;
  private htmlViewMode: HtmlViewMode = "formatted";
  private previewViewMode: PreviewViewMode = "rendered";

  private domTreeDepthLimit = 3;
  private domTreeIncludeChildren = true;

  private currentElementLoadId = 0;
  private currentTabLoadId = 0;

  private isLoadingContent = false;
  private pendingElement: Element | null = null;

  private readonly actions: Record<InspectorActionId, InspectorActionHandler> =
    {
      "copy-selector": async () => {
        const ctx = this.getContext();

        await copyText(ctx.info.selector);
        this.toast("Selector copied");
      },

      "copy-selector-path": async () => {
        const ctx = this.getContext();

        await copyText(ctx.info.selectorPath);
        this.toast("Selector path copied");
      },

      "copy-html": async () => {
        const ctx = this.getContext();

        const html =
          this.htmlViewMode === "formatted"
            ? (ctx.formattedHtmlText ?? formatCode(ctx.rawHtmlText, "html"))
            : ctx.rawHtmlText;

        await copyText(html);
        this.toast("HTML copied");
      },

      "copy-css": async (el) => {
        const ctx = this.getContext();

        if (!ctx.cssBundle) {
          ctx.cssBundle = getCssBundle(el);
        }

        await copyText(ctx.cssBundle.cssText);
        this.toast("CSS copied");
      },

      "copy-computed": async (el) => {
        const ctx = this.getContext();

        if (!ctx.computedCssText) {
          ctx.computedCssText = getComputedCssText(el);
        }

        await copyText(ctx.computedCssText);
        this.toast("Computed CSS copied");
      },

      "copy-vars": async (el) => {
        const ctx = this.getContext();

        if (!ctx.cssVariableText) {
          ctx.cssVariableText = getCssVariableText(el);
        }

        await copyText(ctx.cssVariableText);
        this.toast("CSS vars copied");
      },

      "copy-js": async (el) => {
        const ctx = this.getContext();

        if (ctx.jsText === null) {
          ctx.jsText = await getJavascriptInspectText(el);
        }

        await copyText(ctx.jsText);
        this.toast("JS copied");
      },

      "copy-preview-source": async (el) => {
        const ctx = this.getContext();
        const previewDocument = this.ensurePreviewDocument(ctx, el);

        await copyText(previewDocument);
        this.toast("Preview source copied");
      },

      "download-css": (el) => {
        const ctx = this.getContext();

        if (!ctx.cssBundle) {
          ctx.cssBundle = getCssBundle(el);
        }

        const baseName =
          ctx.info.selector.replace(/[^a-zA-Z0-9_-]+/g, "-") || "element";

        downloadTextFile(
          `${baseName}-style.css`,
          ctx.cssBundle.cssText,
          "text/css",
        );

        this.toast("CSS downloaded");
      },

      "inspect-parent": (el) => {
        if (!el.parentElement) return;

        this.requestElementInspection(el.parentElement);
      },

      "format-toggle": () => {
        this.htmlViewMode =
          this.htmlViewMode === "formatted" ? "raw" : "formatted";

        this.render();
      },

      "toggle-preview-view": () => {
        this.previewViewMode =
          this.previewViewMode === "rendered" ? "source" : "rendered";

        this.render();
      },

      "download-preview": (el) => {
        const ctx = this.getContext();
        const previewDocument = this.ensurePreviewDocument(ctx, el);

        const baseName =
          ctx.info.selector.replace(/[^a-zA-Z0-9_-]+/g, "-") || "element";

        downloadTextFile(
          `${baseName}-preview.html`,
          previewDocument,
          "text/html",
        );

        this.toast("Preview download started");
      },

      "open-preview-codepen": (el) => {
        const ctx = this.getContext();
        const previewParts = this.ensurePreviewParts(ctx, el);

        const payload = createCodePenPayload({
          title: `Element preview: ${ctx.info.shortSelector}`,
          description: `Generated from Element Inspector for ${ctx.info.selectorPath}`,
          html: previewParts.html,
          css: previewParts.css,
          js: "",
          head: previewParts.head,
          layout: "left",
          jsPreProcessor: "none",
        });

        exportToCodePenWithForm(payload);

        this.toast("Opening preview in CodePen");
      },
    };

  constructor(
    private readonly renderer: InspectorPanelRenderer,
    private readonly options: InspectorContentOptions = {},
  ) {}

  public mount(root: HTMLElement): void {
    this.mountRoot = root;

    if (!root.querySelector(".inspector-shell")) {
      root.innerHTML = this.renderer.renderBaseShellHtml();
    }
  }

  public unmount(): void {
    this.mountRoot = null;
  }

  public getSelectedElement(): Element | null {
    return this.selectedElement;
  }

  public getActiveTab(): InspectorTabId {
    return this.activeTab;
  }

  public getViewModelForDevtools(): InspectorViewModel | null {
    if (!this.selectedElement || !this.context) return null;

    return this.buildViewModel({
      loading: false,
      selectorOnlyBreadcrumb: false,
    });
  }

  public setTreeDepth(depth: number): void {
    if (!this.selectedElement) {
      this.domTreeDepthLimit = Number.isNaN(depth) ? 3 : Math.max(depth, 1);
      return;
    }

    const ctx = this.getContext();
    const snapshot = this.ensureDomTreeSnapshot(ctx);

    this.domTreeDepthLimit = this.normalizeTreeDepth(depth, snapshot);
    this.render();
  }

  public toggleTreeChildren(): void {
    this.domTreeIncludeChildren = !this.domTreeIncludeChildren;
    this.render();
  }

  public async inspectElement(element: Element): Promise<void> {
    if (this.isLoadingContent) {
      this.pendingElement = element;
      return;
    }

    this.isLoadingContent = true;

    const loadId = ++this.currentElementLoadId;
    const elementToLoad = element;

    try {
      this.context = null;
      this.currentTabLoadId += 1;

      this.selectedElement = elementToLoad;
      this.context = this.createBaseContext(elementToLoad);

      this.render(true);

      await this.waitForNextPaint();

      if (
        loadId === this.currentElementLoadId &&
        this.selectedElement === elementToLoad
      ) {
        this.render(false);
      }
    } catch (error) {
      this.options.onError?.("Failed to load element details", error);

      if (
        loadId === this.currentElementLoadId &&
        this.selectedElement === elementToLoad
      ) {
        this.render(false);
      }
    } finally {
      this.isLoadingContent = false;

      const pending = this.pendingElement;
      this.pendingElement = null;

      if (pending) {
        void this.inspectElement(pending);
      }
    }
  }

  public render(showPlaceholder = false): void {
    const root = this.mountRoot;
    const el = this.selectedElement;

    if (!root) return;

    if (!el) {
      root.innerHTML = this.renderer.renderEmptyPanelHtml();
      this.options.onSelectorChange?.("");
      return;
    }

    if (!this.context || this.context.element !== el) {
      this.context = this.createBaseContext(el);
    }

    if (!root.querySelector(".inspector-shell")) {
      root.innerHTML = this.renderer.renderBaseShellHtml();
    }

    const model = this.buildViewModel({
      loading: showPlaceholder,
      selectorOnlyBreadcrumb: showPlaceholder,
    });

    const { selectorText, isContentReady } = this.renderer.hydrateShell({
      root,
      model,
    });

    this.options.onSelectorChange?.(selectorText);

    if (showPlaceholder) {
      this.wireBasicBindings();
      return;
    }

    if (!isContentReady) {
      const tabLoadId = ++this.currentTabLoadId;

      this.wireBasicBindings();

      void this.loadActiveTabContentAsync(root, el, tabLoadId);
      return;
    }

    this.wireFullBindings();
  }

  public cancel(): void {
    this.isLoadingContent = false;
    this.pendingElement = null;
    this.selectedElement = null;
    this.context = null;
    this.currentElementLoadId += 1;
    this.currentTabLoadId += 1;
    this.options.onSelectorChange?.("");
  }

  private async loadActiveTabContentAsync(
    root: HTMLElement,
    element: Element,
    tabLoadId: number,
  ): Promise<void> {
    await this.waitForNextPaint();

    if (
      tabLoadId !== this.currentTabLoadId ||
      this.selectedElement !== element
    ) {
      return;
    }

    try {
      await this.ensureActiveTabData();
    } catch (error) {
      this.options.onError?.("Failed to load tab content", error);
      return;
    }

    if (
      tabLoadId !== this.currentTabLoadId ||
      this.selectedElement !== element
    ) {
      return;
    }

    const model = this.buildViewModel({
      loading: false,
      selectorOnlyBreadcrumb: false,
    });

    const { selectorText, isContentReady } = this.renderer.hydrateShell({
      root,
      model,
    });

    this.options.onSelectorChange?.(selectorText);

    if (!isContentReady) {
      this.wireBasicBindings();
      return;
    }

    this.wireFullBindings();
  }

  private createBaseContext(element: Element): InspectorRenderContext {
    return {
      element,
      info: this.getElementInfo(element),
      rawHtmlText: element.outerHTML,
      formattedHtmlText: null,
      cssBundle: null,
      computedCssText: null,
      cssVariableText: null,
      jsText: null,
      previewParts: null,
      previewDocument: null,
      domTreeSnapshot: null,
    };
  }

  private getContext(): InspectorRenderContext {
    const el = this.selectedElement;

    if (!el) {
      throw new Error("InspectorContent has no selected element.");
    }

    if (!this.context || this.context.element !== el) {
      this.context = this.createBaseContext(el);
    }

    return this.context;
  }

  private ensurePreviewParts(
    ctx: InspectorRenderContext,
    element: Element,
  ): PreviewDocumentParts {
    if (!ctx.cssBundle) {
      ctx.cssBundle = getCssBundle(element);
    }

    if (!ctx.previewParts) {
      ctx.previewParts = getPreviewDocumentParts(
        ctx.rawHtmlText,
        ctx.cssBundle.previewCssText,
        element,
      );
    }

    return ctx.previewParts;
  }

  private ensurePreviewDocument(
    ctx: InspectorRenderContext,
    element: Element,
  ): string {
    if (!ctx.previewDocument) {
      ctx.previewDocument = getPreviewDocument({
        parts: this.ensurePreviewParts(ctx, element),
      });
    }

    return ctx.previewDocument;
  }

  private ensureDomTreeSnapshot(ctx: InspectorRenderContext): DomTreeSnapshot {
    if (!ctx.domTreeSnapshot) {
      ctx.domTreeSnapshot = buildDomTreeSnapshot(ctx.element);
    }

    return ctx.domTreeSnapshot;
  }

  private getVisibleDomTreeRows(ctx: InspectorRenderContext): DomTreeRows {
    return getDomTreeRowsFromSnapshot(
      this.ensureDomTreeSnapshot(ctx),
      this.domTreeDepthLimit,
      this.domTreeIncludeChildren,
    );
  }

  private normalizeTreeDepth(
    depth: number,
    snapshot?: DomTreeSnapshot,
  ): number {
    const fallbackDepth = 3;
    const nextDepth = Number.isNaN(depth) ? fallbackDepth : depth;
    const maxDepth = Math.max(snapshot?.maxDepth ?? nextDepth, 1);

    return Math.min(Math.max(nextDepth, 1), maxDepth);
  }

  private async ensureActiveTabData(): Promise<void> {
    const ctx = this.getContext();
    const el = ctx.element;

    switch (this.activeTab) {
      case "info": {
        return;
      }

      case "tree": {
        this.ensureDomTreeSnapshot(ctx);
        return;
      }

      case "html": {
        if (!ctx.formattedHtmlText) {
          ctx.formattedHtmlText = formatCode(ctx.rawHtmlText, "html");
        }

        return;
      }

      case "css": {
        if (!ctx.cssBundle) {
          ctx.cssBundle = getCssBundle(el);
        }

        return;
      }

      case "computed": {
        if (!ctx.computedCssText) {
          ctx.computedCssText = getComputedCssText(el);
        }

        return;
      }

      case "vars": {
        if (!ctx.cssVariableText) {
          ctx.cssVariableText = getCssVariableText(el);
        }

        return;
      }

      case "js": {
        if (ctx.jsText === null) {
          ctx.jsText = await getJavascriptInspectText(el);
        }

        return;
      }

      case "preview": {
        this.ensurePreviewDocument(ctx, el);
        return;
      }

      default: {
        return;
      }
    }
  }

  private isActiveTabContentReady(): boolean {
    const ctx = this.getContext();

    switch (this.activeTab) {
      case "info": {
        return true;
      }

      case "tree": {
        return Boolean(ctx.domTreeSnapshot);
      }

      case "html": {
        return Boolean(ctx.formattedHtmlText);
      }

      case "css": {
        return Boolean(ctx.cssBundle);
      }

      case "computed": {
        return Boolean(ctx.computedCssText);
      }

      case "vars": {
        return Boolean(ctx.cssVariableText);
      }

      case "js": {
        return ctx.jsText !== null;
      }

      case "preview": {
        return Boolean(ctx.previewDocument);
      }

      default: {
        return true;
      }
    }
  }

  private buildViewModel(options: {
    loading: boolean;
    selectorOnlyBreadcrumb: boolean;
  }): InspectorViewModel {
    const ctx = this.getContext();
    const el = ctx.element;

    const shouldBuildTree = this.activeTab === "tree" && !options.loading;

    const domTreeSnapshot = shouldBuildTree
      ? this.ensureDomTreeSnapshot(ctx)
      : null;

    if (domTreeSnapshot) {
      this.domTreeDepthLimit = this.normalizeTreeDepth(
        this.domTreeDepthLimit,
        domTreeSnapshot,
      );
    }

    const visibleDomTreeRows = domTreeSnapshot
      ? this.getVisibleDomTreeRows(ctx)
      : [];

    return {
      info: ctx.info,

      activeTab: this.activeTab,
      htmlViewMode: this.htmlViewMode,
      previewViewMode: this.previewViewMode,

      domTreeDepthLimit: this.domTreeDepthLimit,
      domTreeIncludeChildren: this.domTreeIncludeChildren,
      domTreeMaxDepth: domTreeSnapshot?.maxDepth ?? 0,
      domTreeVisibleCount: visibleDomTreeRows.length,
      domTreeTotalCount: domTreeSnapshot?.totalCount ?? 0,
      domTreeDepthOptions: domTreeSnapshot?.depthOptions ?? [],

      loading: options.loading,
      isContentReady: !options.loading && this.isActiveTabContentReady(),
      selectorOnlyBreadcrumb: options.selectorOnlyBreadcrumb,

      hasParent: Boolean(el.parentElement),

      attributes: this.buildAttributesModel(el),
      breadcrumbs: this.buildBreadcrumbsModel(el),
      siblings: this.buildSiblingsModel(el),
      domTreeRows: this.buildDomTreeRowsModel(visibleDomTreeRows),

      rawHtmlText: ctx.rawHtmlText,
      formattedHtmlText: ctx.formattedHtmlText,
      cssText: ctx.cssBundle?.cssText ?? null,
      computedCssText: ctx.computedCssText,
      cssVariableText: ctx.cssVariableText,
      jsText: ctx.jsText,
      previewDocument: ctx.previewDocument,
    };
  }

  private getElementInfo(element: Element): InspectorElementInfo {
    const rect = element.getBoundingClientRect();

    const selector = getElementSelector(element);
    const shortSelector = getShortSelector(element);
    const selectorPath = getSelectorPath(element);

    const className =
      element instanceof HTMLElement || element instanceof SVGElement
        ? (element.className?.toString() ?? "")
        : "";

    return {
      selector,
      selectorPath,
      shortSelector,
      tagName: element.tagName.toLowerCase(),
      id: element.id || "",
      className,
      text: (element.textContent || "").trim().slice(0, 300),
      dimensions: `${Math.round(rect.width)} × ${Math.round(rect.height)}`,
    };
  }

  private buildAttributesModel(element: Element): Array<{
    name: string;
    value: string;
  }> {
    return Array.from(element.attributes).map((attr) => ({
      name: attr.name,
      value: attr.value,
    }));
  }

  private buildBreadcrumbsModel(element: Element): Array<{
    index: number;
    label: string;
    selector: string;
    isCurrent: boolean;
  }> {
    return getBreadcrumbAncestors(element).map((ancestor, index) => ({
      index,
      label: getShortSelector(ancestor),
      selector: getElementSelector(ancestor),
      isCurrent: ancestor === element,
    }));
  }

  private buildSiblingsModel(element: Element): Array<{
    index: number;
    label: string;
    selector: string;
    isCurrent: boolean;
  }> {
    const parent = element.parentElement;
    if (!parent) return [];

    return Array.from(parent.children).map((sibling, index) => ({
      index,
      label: getShortSelector(sibling),
      selector: getElementSelector(sibling),
      isCurrent: sibling === element,
    }));
  }

  private buildDomTreeRowsModel(
    rows: DomTreeRows,
  ): InspectorTreeRowViewModel[] {
    return rows.map((row, index) => {
      const rowElement = row.element;

      const idText = rowElement.id ? `#${rowElement.id}` : "";

      const className =
        rowElement instanceof HTMLElement || rowElement instanceof SVGElement
          ? (rowElement.className?.toString() ?? "")
          : "";

      const classText = className
        ? `.${className.trim().split(/\s+/).filter(Boolean).join(".")}`
        : "";

      const text = (rowElement.textContent || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 60);

      return {
        index,
        depth: row.depth,
        selector: getElementSelector(rowElement),
        tagName: rowElement.tagName.toLowerCase(),
        idText,
        classText,
        childCount: rowElement.children.length,
        text,
        isTarget: row.isTarget,
      };
    });
  }

  private wireBasicBindings(): void {
    this.wireActions();
    this.wireTabs();
  }

  private wireFullBindings(): void {
    this.wireActions();
    this.wireTabs();

    if (this.activeTab === "tree") {
      this.wireElementNavigation();
    } else {
      this.wireBreadcrumbsOnly();
    }
  }

  private wireTabs(): void {
    this.mountRoot
      ?.querySelectorAll<HTMLElement>("[data-tab]")
      .forEach((button) => {
        button.onclick = () => {
          const tab = button.getAttribute("data-tab") as InspectorTabId | null;
          if (!tab) return;

          this.activeTab = tab;
          this.render();
        };
      });
  }

  private wireActions(): void {
    this.mountRoot
      ?.querySelectorAll<HTMLElement>("[data-action]")
      .forEach((button) => {
        button.onclick = async () => {
          const action = button.getAttribute(
            "data-action",
          ) as InspectorActionId | null;

          if (!action) return;

          const handler = this.actions[action];
          if (!handler) return;

          if (!this.selectedElement) return;

          await handler(this.selectedElement);
        };
      });
  }

  private wireBreadcrumbsOnly(): void {
    const el = this.selectedElement;
    if (!el) return;

    this.wireBreadcrumbs(el);
  }

  private wireElementNavigation(): void {
    const el = this.selectedElement;
    if (!el) return;

    this.wireBreadcrumbs(el);
    this.wireSiblings(el);
    this.wireDomTree(el);
  }

  private wireBreadcrumbs(currentEl: Element): void {
    const ancestors = getBreadcrumbAncestors(currentEl);

    this.mountRoot
      ?.querySelectorAll<HTMLElement>("[data-bc-index]")
      .forEach((button) => {
        button.onclick = () => {
          const index = Number.parseInt(
            button.getAttribute("data-bc-index") || "-1",
            10,
          );

          const target = ancestors[index];
          if (!target) return;

          this.requestElementInspection(target);
        };
      });
  }

  private wireSiblings(currentEl: Element): void {
    const parent = currentEl.parentElement;
    if (!parent) return;

    const siblings = Array.from(parent.children);

    this.mountRoot
      ?.querySelectorAll<HTMLElement>("[data-sib-index]")
      .forEach((button) => {
        button.onclick = () => {
          const index = Number.parseInt(
            button.getAttribute("data-sib-index") || "-1",
            10,
          );

          const target = siblings[index];
          if (!target) return;

          this.requestElementInspection(target);
        };
      });
  }

  private wireDomTree(targetElement: Element): void {
    const ctx = this.getContext();

    const depthSelect =
      this.mountRoot?.querySelector<HTMLSelectElement>("[data-tree-depth]");

    if (depthSelect) {
      depthSelect.value = String(this.domTreeDepthLimit);

      depthSelect.onchange = (e) => {
        const value = Number.parseInt(
          (e.currentTarget as HTMLSelectElement).value,
          10,
        );

        this.setTreeDepth(value);
        this.options.onTreeDepthChange?.(this.domTreeDepthLimit);
      };
    }

    const childToggle = this.mountRoot?.querySelector<HTMLElement>(
      "[data-tree-children]",
    );

    if (childToggle) {
      childToggle.onclick = () => {
        this.toggleTreeChildren();
        this.options.onTreeChildrenToggle?.(this.domTreeIncludeChildren);
      };
    }

    const rows = this.getVisibleDomTreeRows(ctx);

    this.mountRoot
      ?.querySelectorAll<HTMLElement>("[data-tree-row-idx]")
      .forEach((rowEl) => {
        rowEl.onclick = () => {
          const index = Number.parseInt(
            rowEl.getAttribute("data-tree-row-idx") || "-1",
            10,
          );

          const row = rows[index];

          if (!row || row.element === targetElement) {
            return;
          }

          this.requestElementInspection(row.element);
        };
      });
  }

  private requestElementInspection(element: Element): void {
    this.options.onRequestHighlightElement?.(element);

    if (this.options.onRequestInspectElement) {
      this.options.onRequestInspectElement(element);
      return;
    }

    void this.inspectElement(element);
  }

  private toast(message: string): void {
    this.options.onRequestToast?.(message);
  }

  private async waitForNextPaint(): Promise<void> {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }
}
