import THEME_CSS from "../../theme.css?raw";
import INSPECT_CSS from "./inspect.css?raw";

import extensionApi from "webextension-polyfill";

import { Panel } from "../DockingPanel/DockingPanel";
import type { PanelVisibilityAction } from "../DockingPanel/DockingPanel";

import { InspectorContent } from "./InspectorContent";

import { InspectorPanelRenderer } from "./InspectorPanelRenderer";
import type { InspectorTabId } from "./InspectorPanelRenderer";
import {
  getElementSelector,
  getSelectorPath,
  getShortSelector,
  log,
} from "../../utils";

export type InspectorUiRefs = {
  hostEl: HTMLDivElement | null;
  shadowRoot: ShadowRoot | null;
  overlayEl: Overlay | null;
  handlesEl: Handles | null;
  dockingPanel: Panel | null;
};

export type InspectorState = {
  inspectModeEnabled: boolean;
  dockOpen: boolean;
  hasSelection: boolean;
  selectedSelector: string | null;
  selectedSelectorPath: string | null;
  selectedOuterHTML: string | null;
  selectedText: string | null;
  activeTab: InspectorTabId;
};

export type Theme = "light" | "dark";

export const INSPECT_SOURCE = {
  CUSTOM_PICKER: "custom-picker",
  DOCK: "dock",
  DEVTOOLS_PANEL: "devtools-panel",
  NATIVE_DEVTOOLS: "native-devtools",
  POPUP: "popup",
  PROGRAMMATIC: "programmatic",
} as const;

export type InspectorInspectSource =
  (typeof INSPECT_SOURCE)[keyof typeof INSPECT_SOURCE];

export type InspectorStateAction =
  | "picker-started"
  | "picker-stopped"
  | "inspector-stopped"
  | "element-hovered"
  | "element-picked"
  | "element-inspected"
  | "selector-changed"
  | "tree-depth-changed"
  | "tree-children-toggled"
  | "dock-opened"
  | "dock-hidden"
  | "dock-closed"
  | "dock-position-changed"
  | "theme-changed"
  | "content-error"
  | "state-sync";

export type InspectElementOptions = {
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
  openDock?: boolean;
  updateDockIfOpen?: boolean;
  emitState?: boolean;
  updateOverlay?: boolean;
};

type InspectorStateChangedMessage = {
  type: "ELEMENT_INSPECTOR_STATE_CHANGED";
  source: InspectorInspectSource;
  action: InspectorStateAction;
  state: InspectorState;
  viewModel: unknown;
};

const INSPECTOR_HOST_ID = "__simple_element_inspector_host__";
const INSPECTOR_ACTIVE_CURSOR_CLASS = "__moya_element_inspector_active__";
const INSPECTOR_CURSOR_STYLE_ID = "__moya_element_inspector_cursor_style__";

type InspectorElementRect = Pick<
  DOMRectReadOnly,
  "top" | "left" | "width" | "height"
>;

class Overlay {
  constructor(public readonly element: HTMLDivElement) {
    const shadowRoot =
      element.shadowRoot ?? element.attachShadow({ mode: "open" });

    shadowRoot.innerHTML = `
      <style>
        :host {
          display: none;
          position: absolute;
          pointer-events: none;
          box-sizing: border-box;
          z-index: 1;
        }

        svg {
          display: block;
          width: 100%;
          height: 100%;
          overflow: visible;
        }

        rect.main {
          fill: rgba(255, 47, 146, 0.06);
          stroke: #ff2f92;
          stroke-width: 1.5;
        }
      </style>

      <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <pattern
            id="pinstripe"
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(-45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="#ff2f92"
              stroke-width="1"
              opacity="0.2"
            />
          </pattern>
        </defs>

        <rect class="main" width="100%" height="100%" />
        <rect width="100%" height="100%" fill="url(#pinstripe)" />
      </svg>
    `;
  }

  public set rect(rect: InspectorElementRect) {
    Object.assign(this.element.style, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  public setMetadata(selector: string, size: string): void {
    this.element.setAttribute("data-selector", selector);
    this.element.setAttribute("data-size", size);
  }

  public hide(): void {
    this.element.removeAttribute("data-selector");
    this.element.removeAttribute("data-size");

    Object.assign(this.element.style, {
      display: "none",
      top: "",
      left: "",
      width: "",
      height: "",
    });
  }
}

class Handles {
  private readonly labelEl: HTMLDivElement;

  constructor(public readonly element: HTMLDivElement) {
    const shadowRoot =
      element.shadowRoot ?? element.attachShadow({ mode: "open" });

    shadowRoot.innerHTML = `
      <style>
        :host {
          display: none;
          position: absolute;
          pointer-events: none;
          box-sizing: border-box;
          z-index: 2;
        }

        .box {
          position: absolute;
          inset: 0;
          border: 1.5px solid #ff2f92;
          box-sizing: border-box;
        }

        .handle {
          position: absolute;
          width: 8px;
          height: 8px;
          background: #ff2f92;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 0 1px white;
        }

        .nw { top: 0; left: 0; }
        .n  { top: 0; left: 50%; }
        .ne { top: 0; left: 100%; }
        .e  { top: 50%; left: 100%; }
        .se { top: 100%; left: 100%; }
        .s  { top: 100%; left: 50%; }
        .sw { top: 100%; left: 0; }
        .w  { top: 50%; left: 0; }

        .label {
          position: absolute;
          top: -22px;
          left: 0;
          max-width: min(420px, calc(100vw - 16px));
          overflow: hidden;
          padding: 3px 6px;
          border-radius: 3px;
          background: #ff2f92;
          color: white;
          font: 11px/1.3 monospace;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>

      <div class="box"></div>

      <div class="handle nw"></div>
      <div class="handle n"></div>
      <div class="handle ne"></div>
      <div class="handle e"></div>
      <div class="handle se"></div>
      <div class="handle s"></div>
      <div class="handle sw"></div>
      <div class="handle w"></div>

      <div class="label" data-role="label"></div>
    `;

    const labelEl = shadowRoot.querySelector<HTMLDivElement>(
      '[data-role="label"]',
    );

    if (!labelEl) {
      throw new Error("Inspector handles label could not be created");
    }

    this.labelEl = labelEl;
  }

  public set rect({ rect, el }: { rect: InspectorElementRect; el: Element }) {
    Object.assign(this.element.style, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    this.labelEl.textContent = `${getShortSelector(el)} ${Math.round(
      rect.width,
    )}×${Math.round(rect.height)}`;
  }

  public setMetadata(selector: string, size: string): void {
    this.element.setAttribute("data-selector", selector);
    this.element.setAttribute("data-size", size);
  }

  public hide(): void {
    this.element.removeAttribute("data-selector");
    this.element.removeAttribute("data-size");

    Object.assign(this.element.style, {
      display: "none",
      top: "",
      left: "",
      width: "",
      height: "",
    });

    this.labelEl.textContent = "";
  }
}

export class Inspector {
  private inspectModeEnabled = false;
  private currentElement: Element | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private theme: Theme = "light";

  private isHidingDockForPicker = false;

  private ui: InspectorUiRefs = {
    hostEl: null,
    shadowRoot: null,
    overlayEl: null,
    handlesEl: null,
    dockingPanel: null,
  };

  private readonly content: InspectorContent;

  constructor() {
    this.content = new InspectorContent(new InspectorPanelRenderer(), {
      onSelectorChange: (selectorText) => {
        log("content:onSelectorChange", { selectorText });

        this.ui.dockingPanel?.setSelectorText(selectorText);
        this.notifyStateChanged(INSPECT_SOURCE.DOCK, "selector-changed");
      },

      onRequestHighlightElement: (element) => {
        log("content:onRequestHighlightElement", {
          element: this.describeElement(element),
        });

        this.currentElement = element;
        this.updateOverlay(element);
        this.notifyStateChanged(INSPECT_SOURCE.DOCK, "element-hovered");
      },

      onRequestInspectElement: (element) => {
        log("content:onRequestInspectElement", {
          element: this.describeElement(element),
        });

        this.inspectElementFromExternalSource(element, {
          source: "dock",
          action: "element-inspected",
          openDock: true,
          updateDockIfOpen: true,
          emitState: true,
          updateOverlay: false,
        });
      },
      onTreeDepthChange: () => {
        this.notifyStateChanged(INSPECT_SOURCE.DOCK, "tree-depth-changed");
      },

      onTreeChildrenToggle: () => {
        this.notifyStateChanged(INSPECT_SOURCE.DOCK, "tree-children-toggled");
      },
      onRequestToast: (message) => {
        log("content:onRequestToast", { message });
        this.showToast(message);
      },

      onError: (message, error) => {
        log(
          "content:onError",
          {
            message,
            error,
          },
          "error",
        );

        this.showToast(message);
        this.notifyStateChanged(INSPECT_SOURCE.PROGRAMMATIC, "content-error");
      },
    });
  }

  public getState(): InspectorState {
    const selectedElement = this.content.getSelectedElement();

    const dockOpen = Boolean(
      this.ui.dockingPanel?.getElement().isConnected &&
      this.ui.dockingPanel.isOpen(),
    );

    return {
      inspectModeEnabled: this.inspectModeEnabled,
      dockOpen,
      hasSelection: Boolean(selectedElement),
      selectedSelector: selectedElement
        ? getElementSelector(selectedElement)
        : null,
      selectedSelectorPath: selectedElement
        ? getSelectorPath(selectedElement)
        : null,
      selectedOuterHTML: selectedElement ? selectedElement.outerHTML : null,
      selectedText: selectedElement
        ? (selectedElement.textContent || "").trim().slice(0, 300)
        : null,
      activeTab: this.content.getActiveTab(),
    };
  }

  public getViewModel() {
    return this.content.getViewModelForDevtools();
  }

  public inspectSelector(
    selector: string,
    options: InspectElementOptions = {},
  ): boolean {
    log("inspectSelector()", {
      selector,
      options,
    });

    const element = document.querySelector(selector);

    if (!element) {
      log("inspectSelector(): no element found", { selector });
      return false;
    }

    this.inspectElementFromExternalSource(element, {
      ...options,
      source: options.source ?? "programmatic",
      action: options.action ?? "element-inspected",
      updateOverlay: options.updateOverlay ?? false,
    });

    return true;
  }

  public inspectElementFromExternalSource(
    element: Element,
    options: InspectElementOptions = {},
  ): void {
    const {
      source = "programmatic",
      action = "element-inspected",
      openDock = true,
      updateDockIfOpen = true,
      emitState = true,
      updateOverlay = false,
    } = options;

    log("inspectElementFromExternalSource(): start", {
      source,
      action,
      openDock,
      updateDockIfOpen,
      emitState,
      updateOverlay,
      element: this.describeElement(element),
      inspectModeEnabled: this.inspectModeEnabled,
    });

    this.ensureUi();

    this.currentElement = element;

    if (updateOverlay) {
      this.updateOverlay(element);
    }

    const mount = openDock
      ? this.ensureContentMountAndOpenDock()
      : updateDockIfOpen
        ? this.getContentMountIfDockOpen()
        : null;

    log("inspectElementFromExternalSource(): mount resolved", {
      hasMount: Boolean(mount),
      openDock,
      updateDockIfOpen,
    });

    if (mount) {
      this.content.mount(mount);
    }

    void this.content.inspectElement(element).then(() => {
      log("inspectElementFromExternalSource(): inspect complete", {
        source,
        action,
        emitState,
        state: this.getState(),
      });

      if (emitState) {
        this.notifyStateChanged(source, action);
      }
    });
  }

  public start(source: InspectorInspectSource = INSPECT_SOURCE.POPUP): void {
    log("start(): begin", {
      source,
      inspectModeEnabled: this.inspectModeEnabled,
      currentElement: this.describeElement(this.currentElement),
      dockOpen: Boolean(
        this.ui.dockingPanel?.getElement().isConnected &&
        this.ui.dockingPanel.isOpen(),
      ),
    });

    this.ensureUi();

    this.stopPicker({
      hideOverlay: true,
      emitState: false,
    });

    this.startPicker();

    this.notifyStateChanged(source, "picker-started");

    log("start(): end", {
      source,
      inspectModeEnabled: this.inspectModeEnabled,
      cursor: document.body.style.cursor,
      currentElement: this.describeElement(this.currentElement),
    });
  }

  public stop(
    source: InspectorInspectSource = INSPECT_SOURCE.PROGRAMMATIC,
  ): void {
    log("stop(): begin", {
      source,
      inspectModeEnabled: this.inspectModeEnabled,
      currentElement: this.describeElement(this.currentElement),
    });

    this.stopPicker({
      hideOverlay: true,
      emitState: false,
    });

    this.currentElement = null;
    this.content.cancel();

    this.hideDockForStop();

    this.notifyStateChanged(source, "inspector-stopped");

    log("stop(): complete", {
      source,
      state: this.getState(),
    });
  }

  public setTheme(theme: Theme): void {
    log("setTheme()", { theme });

    this.theme = theme;

    const hostEl = this.ui.hostEl;

    if (!hostEl) {
      return;
    }

    const { classList } = hostEl;

    for (const className of Array.from(classList)) {
      if (className.startsWith("theme-")) {
        classList.remove(className);
      }
    }

    classList.add(`theme-${theme}`);

    this.notifyStateChanged(INSPECT_SOURCE.PROGRAMMATIC, "theme-changed");
  }

  public setTreeDepth(depth: number): void {
    log("setTreeDepth()", { depth });

    this.content.setTreeDepth(depth);
    this.notifyStateChanged(INSPECT_SOURCE.DOCK, "tree-depth-changed");
  }

  public toggleTreeChildren(): void {
    log("toggleTreeChildren()");

    this.content.toggleTreeChildren();
    this.notifyStateChanged(INSPECT_SOURCE.DOCK, "tree-children-toggled");
  }

  private startPicker(): void {
    log("startPicker(): begin", {
      inspectModeEnabled: this.inspectModeEnabled,
      currentElement: this.describeElement(this.currentElement),
    });

    this.inspectModeEnabled = true;
    this.currentElement = null;

    this.hideOverlay();
    this.hideDockForInspectMode();

    document.addEventListener("mousemove", this.handleMouseMove, true);
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("keydown", this.handleKeyDown, true);

    this.enablePickerCursor();
    this.ui.hostEl?.setAttribute("data-picker-active", "true");

    log("startPicker(): listeners attached", {
      inspectModeEnabled: this.inspectModeEnabled,
      currentElement: this.describeElement(this.currentElement),
      dockOpen: Boolean(
        this.ui.dockingPanel?.getElement().isConnected &&
        this.ui.dockingPanel.isOpen(),
      ),
    });
  }

  private stopPicker(
    options: {
      hideOverlay?: boolean;
      emitState?: boolean;
      source?: InspectorInspectSource;
    } = {},
  ): void {
    const {
      hideOverlay = true,
      emitState = false,
      source = INSPECT_SOURCE.PROGRAMMATIC,
    } = options;

    log("stopPicker(): begin", {
      inspectModeEnabled: this.inspectModeEnabled,
      currentElement: this.describeElement(this.currentElement),
      hideOverlay,
      emitState,
      source,
    });

    const wasInspecting = this.inspectModeEnabled;

    this.inspectModeEnabled = false;

    document.removeEventListener("mousemove", this.handleMouseMove, true);
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);

    this.disablePickerCursor();
    this.ui.hostEl?.removeAttribute("data-picker-active");

    if (hideOverlay) {
      this.hideOverlay();
    }

    if (emitState && wasInspecting) {
      this.notifyStateChanged(source, "picker-stopped");
    }

    log("stopPicker(): complete", {
      inspectModeEnabled: this.inspectModeEnabled,
      cursor: document.body.style.cursor,
    });
  }

  private ensureUi(): void {
    const panelStillConnected = Boolean(
      this.ui.dockingPanel?.getElement().isConnected,
    );

    log("ensureUi(): begin", {
      hasHost: Boolean(this.ui.hostEl),
      hasShadowRoot: Boolean(this.ui.shadowRoot),
      hasOverlay: Boolean(this.ui.overlayEl),
      hasHandles: Boolean(this.ui.handlesEl),
      hasDockingPanel: Boolean(this.ui.dockingPanel),
      panelStillConnected,
    });

    if (
      this.ui.hostEl &&
      this.ui.shadowRoot &&
      this.ui.overlayEl &&
      this.ui.handlesEl &&
      this.ui.dockingPanel &&
      panelStillConnected
    ) {
      this.ui.dockingPanel.syncPanelSize();

      log("ensureUi(): existing ui reused");

      return;
    }

    if (this.ui.dockingPanel && !panelStillConnected) {
      log("ensureUi(): stale docking panel cleared");
      this.ui.dockingPanel = null;
    }

    let hostEl = document.getElementById(
      INSPECTOR_HOST_ID,
    ) as HTMLDivElement | null;

    if (!hostEl) {
      hostEl = document.createElement("div");
      hostEl.id = INSPECTOR_HOST_ID;
      hostEl.className = `theme-${this.theme}`;

      Object.assign(hostEl.style, {
        position: "fixed",
        inset: "0",
        pointerEvents: "none",
        zIndex: "99999999999",
      });

      document.documentElement.appendChild(hostEl);

      log("ensureUi(): host created");
    } else {
      log("ensureUi(): host found");
    }

    void extensionApi.storage.local.get("theme").then((res) => {
      if (res?.theme === "light" || res?.theme === "dark") {
        this.setTheme(res.theme);
      }
    });

    const shadowRoot =
      hostEl.shadowRoot ?? hostEl.attachShadow({ mode: "open" });

    shadowRoot.innerHTML = `
      <style>${THEME_CSS}\n${INSPECT_CSS}</style>
      <div data-role="overlay"></div>
      <div data-role="handles"></div>
      <div class="inspector-toast" data-role="toast"></div>
      <div data-role="panel-mount"></div>
    `;

    const overlayHost = shadowRoot.querySelector<HTMLDivElement>(
      '[data-role="overlay"]',
    );

    const handlesHost = shadowRoot.querySelector<HTMLDivElement>(
      '[data-role="handles"]',
    );

    const panelMount = shadowRoot.querySelector(
      '[data-role="panel-mount"]',
    ) as HTMLDivElement | null;

    if (!panelMount || !overlayHost || !handlesHost) {
      log("ensureUi(): missing required elements", {
        hasPanelMount: Boolean(panelMount),
        hasOverlay: Boolean(overlayHost),
        hasHandles: Boolean(handlesHost),
      });

      return;
    }

    const overlayEl = new Overlay(overlayHost);
    const handlesEl = new Handles(handlesHost);

    const dockingPanel = new Panel(panelMount, {
      title: this.createInspectTitleButton(),

      selectorText: "",
      renderContent: () => `<div data-role="inspector-content-mount"></div>`,

      onDockChange: () => {
        log("panel:onDockChange", {
          dockPosition: this.ui.dockingPanel?.dockPosition,
        });

        const selectedElement = this.content.getSelectedElement();

        if (!selectedElement) {
          log("panel:onDockChange ignored: no selected element");
          return;
        }

        const mount = this.ensureContentMountAndOpenDock();

        if (!mount) {
          log("panel:onDockChange ignored: no mount");
          return;
        }

        this.content.mount(mount);
        this.content.render();

        this.notifyStateChanged(INSPECT_SOURCE.DOCK, "dock-position-changed");
      },

      onOpen: () => {
        log("panel:onOpen");
        this.notifyStateChanged(INSPECT_SOURCE.DOCK, "dock-opened");
      },

      onHide: () => {
        log("panel:onHide", {
          isHidingDockForPicker: this.isHidingDockForPicker,
        });

        if (!this.isHidingDockForPicker) {
          this.hideOverlay();
        }

        this.notifyStateChanged(INSPECT_SOURCE.DOCK, "dock-hidden");
      },

      onClose: () => {
        log("panel:onClose");

        this.hideOverlay();
        this.currentElement = null;
        this.content.cancel();

        this.ui.dockingPanel = null;

        this.notifyStateChanged(INSPECT_SOURCE.DOCK, "dock-closed");
      },

      onVisibilityChange: (isOpen, _panel, action: PanelVisibilityAction) => {
        log("panel:onVisibilityChange", {
          isOpen,
          action,
          isHidingDockForPicker: this.isHidingDockForPicker,
        });
      },

      onAfterRender: () => {
        log("panel:onAfterRender");
      },
    });

    this.ui = {
      hostEl,
      shadowRoot,
      overlayEl,
      handlesEl,
      dockingPanel,
    };

    log("ensureUi(): complete");
  }

  private createInspectTitleButton(): HTMLButtonElement {
    const button = document.createElement("button");

    button.type = "button";
    button.classList.add(
      "btn",
      "inspector-header-inspect-button",
      "btn-primary",
    );

    button.title = "Inspect Element";
    button.setAttribute("aria-label", "Inspect Element");
    button.textContent = "Inspect";

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      log("dock title Inspect button clicked");
      this.start("dock");
    });

    return button;
  }

  private getContentMountIfDockOpen(): HTMLElement | null {
    const dockingPanel = this.ui.dockingPanel;

    if (!dockingPanel?.getElement().isConnected || !dockingPanel.isOpen()) {
      log("getContentMountIfDockOpen(): dock not open");
      return null;
    }

    return this.getOrCreateContentMount(dockingPanel);
  }

  private ensureContentMountAndOpenDock(): HTMLElement | null {
    let dockingPanel = this.ui.dockingPanel;

    if (!dockingPanel?.getElement().isConnected) {
      log("ensureContentMountAndOpenDock(): recreating missing dock");

      this.ui.dockingPanel = null;
      this.ensureUi();

      dockingPanel = this.ui.dockingPanel;
    }

    if (!dockingPanel) {
      log("ensureContentMountAndOpenDock(): no docking panel");
      return null;
    }

    log("ensureContentMountAndOpenDock(): showing dock", {
      wasOpen: dockingPanel.isOpen(),
    });

    dockingPanel.show();

    return this.getOrCreateContentMount(dockingPanel);
  }

  private getOrCreateContentMount(dockingPanel: Panel): HTMLElement | null {
    const panelElement = dockingPanel.getElement();

    let contentMount = panelElement.querySelector(
      '[data-role="inspector-content-mount"]',
    ) as HTMLElement | null;

    if (contentMount) {
      log("getOrCreateContentMount(): existing mount found");
      return contentMount;
    }

    const contentRoot = panelElement.querySelector(
      '[data-role="content"]',
    ) as HTMLElement | null;

    if (!contentRoot) {
      log("getOrCreateContentMount(): no content root");
      return null;
    }

    contentRoot.innerHTML = `<div data-role="inspector-content-mount"></div>`;

    contentMount = contentRoot.querySelector(
      '[data-role="inspector-content-mount"]',
    ) as HTMLElement | null;

    log("getOrCreateContentMount(): created mount", {
      hasMount: Boolean(contentMount),
    });

    return contentMount;
  }

  private hideDockForInspectMode(): void {
    log("hideDockForInspectMode()", {
      dockOpen: Boolean(
        this.ui.dockingPanel?.getElement().isConnected &&
        this.ui.dockingPanel.isOpen(),
      ),
    });

    this.isHidingDockForPicker = true;

    try {
      this.ui.dockingPanel?.hide();
    } finally {
      this.isHidingDockForPicker = false;
    }
  }

  private hideDockForStop(): void {
    log("hideDockForStop()", {
      dockOpen: Boolean(
        this.ui.dockingPanel?.getElement().isConnected &&
        this.ui.dockingPanel.isOpen(),
      ),
    });

    this.ui.dockingPanel?.hide();
  }

  private isInspectorElement(el: Element): boolean {
    if (!this.ui.hostEl) {
      return false;
    }

    if (el === this.ui.hostEl) {
      return true;
    }

    const rootNode = el.getRootNode?.();

    return rootNode === this.ui.shadowRoot || this.ui.hostEl.contains(el);
  }

  private getPickableElementFromEvent(event: MouseEvent): Element | null {
    const target = event.target;

    if (target instanceof Element && !this.isInspectorElement(target)) {
      return target;
    }

    if (target instanceof Node) {
      const parent = target.parentElement;

      if (parent && !this.isInspectorElement(parent)) {
        return parent;
      }
    }

    const pointTarget = document.elementFromPoint(event.clientX, event.clientY);

    if (
      pointTarget instanceof Element &&
      !this.isInspectorElement(pointTarget)
    ) {
      return pointTarget;
    }

    return null;
  }

  private updateOverlay(el: Element): void {
    const { overlayEl, handlesEl } = this.ui;

    if (!overlayEl || !handlesEl) {
      log("updateOverlay(): missing overlay elements", {
        hasOverlay: Boolean(overlayEl),
        hasHandles: Boolean(handlesEl),
      });
      return;
    }

    const rect = el.getBoundingClientRect();
    const shortSelector = getShortSelector(el);
    const size = `${Math.round(rect.width)}×${Math.round(rect.height)}`;

    overlayEl.setMetadata(shortSelector, size);
    overlayEl.rect = rect;

    handlesEl.setMetadata(shortSelector, size);
    handlesEl.rect = { rect, el };

    log("updateOverlay()", {
      element: this.describeElement(el),
      selector: shortSelector,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }

  private hideOverlay(): void {
    const { overlayEl, handlesEl } = this.ui;

    if (!overlayEl && !handlesEl) {
      log("hideOverlay(): no overlay elements");
      return;
    }

    overlayEl?.hide();
    handlesEl?.hide();

    log("hideOverlay()");
  }

  private showToast(message: string): void {
    const toast = this.ui.shadowRoot?.querySelector<HTMLElement>(
      '[data-role="toast"]',
    );

    if (!toast) {
      log("showToast(): no toast element", { message });
      return;
    }

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    toast.textContent = message;
    toast.classList.add("show");

    this.toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
      this.toastTimeout = null;
    }, 1500);

    log("showToast()", { message });
  }

  private notifyStateChanged(
    source: InspectorInspectSource = INSPECT_SOURCE.PROGRAMMATIC,
    action: InspectorStateAction = "state-sync",
  ): void {
    const message: InspectorStateChangedMessage = {
      type: "ELEMENT_INSPECTOR_STATE_CHANGED",
      source,
      action,
      state: this.getState(),
      viewModel: this.getViewModel(),
    };

    log("notifyStateChanged()", {
      source,
      action,
      state: message.state,
    });

    try {
      const result = extensionApi.runtime.sendMessage(message);

      if (result && typeof (result as Promise<unknown>).catch === "function") {
        void (result as Promise<unknown>).catch((error) => {
          log("notifyStateChanged(): missing receiver ignored", {
            error,
          });
        });
      }
    } catch (error) {
      log("notifyStateChanged(): send failed ignored", {
        error,
      });
    }
  }

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.inspectModeEnabled) {
      return;
    }

    const target = this.getPickableElementFromEvent(e);

    log("handleMouseMove(): received", {
      target: this.describeElement(target),
    });

    if (!target) {
      return;
    }

    this.currentElement = target;
    this.updateOverlay(target);

    log("handleMouseMove(): end", {
      target: this.describeElement(target),
    });
  };

  private handleClick = (e: MouseEvent): void => {
    log("handleClick(): received", {
      inspectModeEnabled: this.inspectModeEnabled,
      eventTarget: this.describeElement(
        e.target instanceof Element ? e.target : null,
      ),
      currentElement: this.describeElement(this.currentElement),
      button: e.button,
      clientX: e.clientX,
      clientY: e.clientY,
    });

    if (!this.inspectModeEnabled) {
      return;
    }

    const eventElement = this.getPickableElementFromEvent(e);

    const selectedElement =
      this.currentElement &&
      this.currentElement.isConnected &&
      !this.isInspectorElement(this.currentElement)
        ? this.currentElement
        : eventElement;

    if (!selectedElement) {
      log("handleClick(): no selected element", {
        eventElement: this.describeElement(eventElement),
        currentElement: this.describeElement(this.currentElement),
      });

      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    this.currentElement = selectedElement;

    log("handleClick(): selecting", {
      selectedElement: this.describeElement(selectedElement),
    });

    this.stopPicker({
      hideOverlay: true,
      emitState: false,
    });

    this.inspectElementFromExternalSource(selectedElement, {
      source: "custom-picker",
      action: "element-picked",
      openDock: true,
      updateDockIfOpen: true,
      emitState: true,
      updateOverlay: false,
    });
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    log("handleKeyDown()", {
      key: e.key,
      inspectModeEnabled: this.inspectModeEnabled,
    });

    if (e.key === "Escape") {
      this.stop("programmatic");
    }
  };

  private enablePickerCursor(): void {
    document.documentElement.classList.add(INSPECTOR_ACTIVE_CURSOR_CLASS);

    let styleEl = document.getElementById(
      INSPECTOR_CURSOR_STYLE_ID,
    ) as HTMLStyleElement | null;

    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = INSPECTOR_CURSOR_STYLE_ID;
      document.documentElement.appendChild(styleEl);
    }

    styleEl.textContent = `
      html.${INSPECTOR_ACTIVE_CURSOR_CLASS},
      html.${INSPECTOR_ACTIVE_CURSOR_CLASS} body,
      html.${INSPECTOR_ACTIVE_CURSOR_CLASS} body *,
      html.${INSPECTOR_ACTIVE_CURSOR_CLASS} iframe {
        cursor: crosshair !important;
      }
    `;
  }

  private disablePickerCursor(): void {
    document.documentElement.classList.remove(INSPECTOR_ACTIVE_CURSOR_CLASS);
    document.getElementById(INSPECTOR_CURSOR_STYLE_ID)?.remove();

    document.body.style.cursor = "";
    document.documentElement.style.cursor = "";
  }

  private describeElement(element: Element | null): string | null {
    if (!element) {
      return null;
    }

    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const className =
      typeof element.className === "string" && element.className.trim()
        ? `.${element.className.trim().split(/\s+/).join(".")}`
        : "";

    return `${tag}${id}${className}`;
  }
}
