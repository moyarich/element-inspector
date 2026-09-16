import extensionApi from "webextension-polyfill";

import THEME_CSS from "../../theme.css?raw";
import DEVTOOLS_PANEL_CSS from "./devtools-panel.css?raw";

import {
  INSPECT_SOURCE,
  type InspectorInspectSource,
  type InspectorStateAction,
  type Theme,
} from "../Inspector/Inspector";
import { log } from "../../utils";
import {
  buildNativeListenerExpression,
  renderListenerDiscovery,
  type ListenerDiscovery,
} from "../Inspector/tabs/javascript/nativeListenerRetrieval";
import { resolveListenerSourceMaps } from "../Inspector/tabs/javascript/sourceMapResolution";

const MESSAGE = {
  START: "ELEMENT_INSPECTOR_START",
  STOP: "ELEMENT_INSPECTOR_STOP",
  GET_STATE: "ELEMENT_INSPECTOR_GET_STATE",
  INSPECT_SELECTOR: "ELEMENT_INSPECTOR_INSPECT_SELECTOR",
  STATE_CHANGED: "ELEMENT_INSPECTOR_STATE_CHANGED",
  THEME_CHANGED: "ELEMENT_INSPECTOR_THEME_CHANGED",
  DEVTOOLS_CONNECT: "ELEMENT_INSPECTOR_DEVTOOLS_CONNECT",
} as const;

type InspectorState = {
  inspectModeEnabled: boolean;
  dockOpen: boolean;
  hasSelection: boolean;
  selectedSelector: string | null;
  selectedSelectorPath: string | null;
  selectedOuterHTML: string | null;
  selectedText: string | null;
  activeTab: string;
};

type RuntimeCommand =
  | {
      type: typeof MESSAGE.START;
      tabId: number;
      source: InspectorInspectSource;
      action: InspectorStateAction;
    }
  | {
      type: typeof MESSAGE.STOP;
      tabId: number;
      source: InspectorInspectSource;
      action: InspectorStateAction;
    }
  | {
      type: typeof MESSAGE.GET_STATE;
      tabId: number;
      source: InspectorInspectSource;
      action: InspectorStateAction;
    }
  | {
      type: typeof MESSAGE.INSPECT_SELECTOR;
      tabId: number;
      selector: string;
      source: InspectorInspectSource;
      action: InspectorStateAction;
      openDock?: boolean;
      updateDockIfOpen?: boolean;
      emitState?: boolean;
    };

type RuntimeResponse =
  | {
      ok: true;
      state?: InspectorState;
      viewModel?: unknown;
    }
  | {
      ok: false;
      error: string;
    }
  | null;

type InspectorStateChangedMessage = {
  type: typeof MESSAGE.STATE_CHANGED;
  tabId?: number;
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
  state: InspectorState;
  viewModel?: unknown;
};

type ThemeChangedMessage = {
  type: typeof MESSAGE.THEME_CHANGED;
  theme: Theme;
};

type DevtoolsConnectMessage = {
  type: typeof MESSAGE.DEVTOOLS_CONNECT;
  tabId: number;
};

type DevtoolsPanelAction =
  | "start-picking"
  | "stop-picking"
  | "inspect-selected"
  | "sync"
  | "copy-selector"
  | "copy-html";

type DevtoolsSelectionSyncReason =
  | "initial-native-selection"
  | "native-selection-changed"
  | "manual-sync";

type DevtoolsEvalError = {
  isError?: boolean;
  isException?: boolean;
  code?: string;
  description?: string;
  value?: string;
};

type NormalizedDevtoolsEvalResult<T> = {
  result: T | undefined;
  error: DevtoolsEvalError | undefined;
};

function isDevtoolsEvalError(value: unknown): value is DevtoolsEvalError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as DevtoolsEvalError;

  return (
    "isError" in candidate ||
    "isException" in candidate ||
    "code" in candidate ||
    "description" in candidate
  );
}

/**
 * Normalizes the incompatible promise results returned by Chromium and
 * Firefox for devtools.inspectedWindow.eval(). Chromium may return the value
 * directly, while Firefox returns a [value, exceptionInfo] tuple.
 */
function normalizeDevtoolsEvalResult<T>({
  evaluation,
}: {
  evaluation: unknown;
}): NormalizedDevtoolsEvalResult<T> {
  if (
    Array.isArray(evaluation) &&
    evaluation.length === 2 &&
    (evaluation[1] === undefined || isDevtoolsEvalError(evaluation[1]))
  ) {
    return {
      result: evaluation[0] as T | undefined,
      error: evaluation[1] as DevtoolsEvalError | undefined,
    };
  }

  // Chromium's promise wrapper returns the evaluated value directly, while
  // Firefox's WebExtension API returns [value, exceptionInfo].
  return {
    result: evaluation as T | undefined,
    error: undefined,
  };
}

const DEVTOOLS_ROOT_ID = "devtools-inspector-root";
const STYLE_ID = "element-inspector-devtools-styles";
const DEVTOOLS_PORT_NAME = "element-inspector-devtools";

const APPLY_NATIVE_SELECTION_RELEASE_MS = 120;
const MIRROR_NATIVE_SELECTION_RELEASE_MS = 150;

function getRuntimeResponseError(
  response: RuntimeResponse,
  fallback: string,
): string {
  return response && "error" in response ? response.error : fallback;
}

class DevtoolsInspectorPanel {
  private rootEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private modeBadgeEl: HTMLElement | null = null;
  private selectorEl: HTMLElement | null = null;
  private metaEl: HTMLElement | null = null;
  private listenerOutputEl: HTMLElement | null = null;

  private theme: Theme = "light";
  private currentState: InspectorState | null = null;
  private lastStateSignature = "";
  private isSyncing = false;
  private listenerRequestId = 0;

  private devtoolsPort: extensionApi.Runtime.Port | null = null;
  private nativeSelectionSyncTimer: number | null = null;

  /**
   * Last selector read from native DevTools $0.
   * Used to avoid repeatedly sending the same native selection into the inspector.
   */
  private lastNativeSelector = "";

  /**
   * Last selector mirrored from our inspector into native DevTools via inspect(element).
   * Used to prevent repeatedly calling native inspect() for the same selected element.
   */
  private lastMirroredSelector = "";

  /**
   * True while a native DevTools selection is being applied into our inspector.
   *
   * Flow:
   * native DevTools $0 changes -> inspectSelectedDevtoolsElement("native-devtools")
   * -> content inspector updates.
   *
   * During this, we must not mirror the same state back into native DevTools.
   */
  private isApplyingNativeDevtoolsSelection = false;

  /**
   * True while our inspector selection is being mirrored into native DevTools.
   *
   * Flow:
   * custom picker / dock selection -> syncSelectedElementToNativeDevtools()
   * -> inspect(element)
   * -> native DevTools may fire onSelectionChanged.
   *
   * That onSelectionChanged is an echo and must be ignored.
   */
  private isMirroringSelectionToNativeDevtools = false;

  public init(): void {
    this.injectStyles();
    this.ensureDocumentShell();
    this.bindActions();
    this.connectDevtoolsPort();
    this.bindNativeInspectorSelectionEvents();

    void this.restoreTheme();

    void this.syncState({
      silent: true,
      forceRender: true,
    });

    this.scheduleNativeInspectorSync({
      silent: true,
      reason: "initial-native-selection",
    });
  }

  private injectStyles(): void {
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = `${THEME_CSS}\n${DEVTOOLS_PANEL_CSS}`;
  }

  private ensureDocumentShell(): void {
    document.documentElement.classList.add(`theme-${this.theme}`);

    const app = document.getElementById("app");

    if (!app) {
      throw new Error("Missing #app mount element.");
    }

    app.innerHTML = `
      <main class="devtools-inspector theme-${this.theme}" id="${DEVTOOLS_ROOT_ID}">
        <header class="devtools-toolbar">
          <div class="devtools-title-wrap">
            <div class="devtools-title-row">
              <div class="devtools-mark">⌖</div>

              <div>
                <h1 class="devtools-title">Element Inspector</h1>

                <span
                  class="devtools-mode-badge"
                  data-role="mode-badge"
                  data-state="idle"
                >
                  Idle
                </span>
              </div>
            </div>

            <div class="devtools-subtitle">
              Syncs with the native Elements panel and controls the docked page inspector.
            </div>
          </div>

          <div class="devtools-actions">
            <button
              class="btn btn-primary"
              type="button"
              data-action="start-picking"
            >
              Select on page
            </button>

            <button
              class="btn btn-secondary"
              type="button"
              data-action="inspect-selected"
              title="Inspect the element currently selected in the browser Elements panel"
            >
              Inspect selected element
            </button>

            <button
              class="btn btn-secondary"
              type="button"
              data-action="sync"
            >
              Refresh
            </button>

            <button
              class="btn btn-ghost"
              type="button"
              data-action="stop-picking"
            >
              Stop inspecting
            </button>
          </div>
        </header>

        <section class="devtools-panel-body">
          <section class="selected-card selection-card">
            <div class="selected-card-header">
              <div>
                <div class="card-title">Current selection</div>
                <div class="card-subtitle">
                  Choose an element in the Elements panel or select one directly on the page.
                </div>
              </div>
            </div>

            <div class="selector-box" data-role="selector">—</div>

            <div class="selection-meta" data-role="meta">
              No element selected.
            </div>

            <div class="selection-actions">
              <button
                class="btn btn-secondary"
                type="button"
                data-action="copy-selector"
              >
                Copy CSS selector
              </button>

              <button
                class="btn btn-secondary"
                type="button"
                data-action="copy-html"
              >
                Copy HTML
              </button>
            </div>

          </section>

          <section class="selected-card listener-card">
            <div class="selected-card-header">
              <div>
                <div class="card-title">Native event listeners</div>
                <div class="card-subtitle">
                  Exact DevTools listeners when supported; document-start observations otherwise.
                </div>
              </div>
            </div>
            <div class="listener-output" data-role="listener-output">Select an element to inspect its listeners.</div>
          </section>
        </section>

        <div
          class="devtools-status"
          data-role="status"
          role="status"
          aria-live="polite"
        ></div>
      </main>
    `;

    this.rootEl = document.getElementById(DEVTOOLS_ROOT_ID);
    this.statusEl = document.querySelector<HTMLElement>('[data-role="status"]');

    this.modeBadgeEl = document.querySelector<HTMLElement>(
      '[data-role="mode-badge"]',
    );

    this.selectorEl = document.querySelector<HTMLElement>(
      '[data-role="selector"]',
    );

    this.metaEl = document.querySelector<HTMLElement>('[data-role="meta"]');

    this.listenerOutputEl = document.querySelector<HTMLElement>(
      '[data-role="listener-output"]',
    );

    this.renderState(null);
  }

  private bindActions(): void {
    document
      .querySelectorAll<HTMLElement>("[data-action]")
      .forEach((button) => {
        button.onclick = () => {
          const action = button.getAttribute(
            "data-action",
          ) as DevtoolsPanelAction | null;

          if (!action) {
            return;
          }

          switch (action) {
            case "start-picking": {
              void this.startPicking();
              break;
            }

            case "stop-picking": {
              void this.stopPicking();
              break;
            }

            case "inspect-selected": {
              void this.inspectSelectedDevtoolsElement({
                silent: false,
                source: "devtools-panel",
                action: "element-inspected",
                openDock: true,
              });
              break;
            }

            case "sync": {
              void this.syncState({
                silent: false,
                forceRender: true,
              });

              this.scheduleNativeInspectorSync({
                silent: false,
                reason: "manual-sync",
              });

              break;
            }

            case "copy-selector": {
              void this.copyCurrentSelector();
              break;
            }

            case "copy-html": {
              void this.copyCurrentHtml();
              break;
            }
          }
        };
      });
  }

  private connectDevtoolsPort(): void {
    const tabId = this.getTabId();

    if (typeof tabId !== "number") {
      return;
    }

    try {
      const port = extensionApi.runtime.connect({
        name: DEVTOOLS_PORT_NAME,
      });

      this.devtoolsPort = port;

      const connectMessage: DevtoolsConnectMessage = {
        type: MESSAGE.DEVTOOLS_CONNECT,
        tabId,
      };

      port.postMessage(connectMessage);

      port.onMessage.addListener((message: unknown) => {
        this.handlePortMessage(message);
      });

      port.onDisconnect.addListener(() => {
        if (this.devtoolsPort === port) {
          this.devtoolsPort = null;
        }
      });
    } catch (error) {
      log("DevTools port connect failed", error, "warn");
    }
  }

  private handlePortMessage(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }

    const typedMessage = message as
      | InspectorStateChangedMessage
      | ThemeChangedMessage;

    if (typedMessage.type === MESSAGE.THEME_CHANGED) {
      if (typedMessage.theme === "light" || typedMessage.theme === "dark") {
        this.setTheme(typedMessage.theme);
      }

      return;
    }

    if (typedMessage.type !== MESSAGE.STATE_CHANGED) {
      return;
    }

    if (!this.isInspectorState(typedMessage.state)) {
      return;
    }

    this.applyIncomingState(
      typedMessage.state,
      typedMessage.source ?? "programmatic",
      typedMessage.action ?? "state-sync",
    );
  }

  private bindNativeInspectorSelectionEvents(): void {
    const onSelectionChanged =
      extensionApi.devtools?.panels?.elements?.onSelectionChanged;

    if (!onSelectionChanged?.addListener) {
      return;
    }

    onSelectionChanged.addListener(() => {
      if (this.isMirroringSelectionToNativeDevtools) {
        return;
      }

      this.scheduleNativeInspectorSync({
        silent: true,
        reason: "native-selection-changed",
      });
    });
  }

  private scheduleNativeInspectorSync(options: {
    silent: boolean;
    reason: DevtoolsSelectionSyncReason;
  }): void {
    if (this.currentState?.inspectModeEnabled) {
      return;
    }

    if (this.isMirroringSelectionToNativeDevtools) {
      return;
    }

    if (this.nativeSelectionSyncTimer !== null) {
      window.clearTimeout(this.nativeSelectionSyncTimer);
    }

    this.nativeSelectionSyncTimer = window.setTimeout(
      () => {
        this.nativeSelectionSyncTimer = null;

        if (this.currentState?.inspectModeEnabled) {
          return;
        }

        if (this.isMirroringSelectionToNativeDevtools) {
          return;
        }

        void this.inspectSelectedDevtoolsElement({
          silent: options.silent,
          source: "native-devtools",
          action: "element-inspected",
          openDock: false,
        });
      },
      options.reason === "initial-native-selection" ? 150 : 80,
    );
  }

  private async startPicking(): Promise<void> {
    const tabId = this.getTabId();

    if (typeof tabId !== "number") {
      this.showStatus("No inspected tab found.");
      return;
    }

    this.clearNativeSelectionSyncTimer();

    const response = await this.sendRuntimeCommand({
      type: MESSAGE.START,
      tabId,
      source: "devtools-panel",
      action: "picker-started",
    });

    if (!response?.ok) {
      this.showStatus(
        getRuntimeResponseError(response, "Could not start picker."),
      );
      return;
    }

    await this.syncState({
      silent: true,
      forceRender: true,
    });

    this.showStatus("Picker started. Click an element on the page.");
  }

  private async stopPicking(): Promise<void> {
    const tabId = this.getTabId();

    if (typeof tabId !== "number") {
      this.showStatus("No inspected tab found.");
      return;
    }

    this.clearNativeSelectionSyncTimer();

    const response = await this.sendRuntimeCommand({
      type: MESSAGE.STOP,
      tabId,
      source: "devtools-panel",
      action: "inspector-stopped",
    });

    if (!response?.ok) {
      this.showStatus(
        getRuntimeResponseError(response, "Could not stop picker."),
      );
      return;
    }

    await this.syncState({
      silent: true,
      forceRender: true,
    });

    this.showStatus("Picker stopped.");
  }

  private async inspectSelectedDevtoolsElement(options: {
    silent?: boolean;
    source: "devtools-panel" | "native-devtools";
    action: InspectorStateAction;
    openDock: boolean;
  }): Promise<void> {
    if (this.currentState?.inspectModeEnabled) {
      await this.stopPicking();
    }

    if (
      options.source === "native-devtools" &&
      this.isMirroringSelectionToNativeDevtools
    ) {
      return;
    }

    const tabId = this.getTabId();

    if (typeof tabId !== "number") {
      if (!options.silent) {
        this.showStatus("No inspected tab found.");
      }

      return;
    }

    const selector = await this.getSelectorForDevtoolsSelectedElement();

    if (!selector) {
      if (!options.silent) {
        this.showStatus(
          "No Elements selection found. Open the Elements panel, select an element, then try again.",
        );
      }

      return;
    }

    if (
      options.source === "native-devtools" &&
      selector === this.lastNativeSelector
    ) {
      return;
    }

    this.lastNativeSelector = selector;

    if (options.source === "native-devtools") {
      this.isApplyingNativeDevtoolsSelection = true;
    }

    try {
      const response = await this.sendRuntimeCommand({
        type: MESSAGE.INSPECT_SELECTOR,
        tabId,
        selector,
        source: options.source,
        action: options.action,
        openDock: options.openDock,
        updateDockIfOpen: true,
        emitState: true,
      });

      if (!response?.ok) {
        if (!options.silent) {
          this.showStatus(
            getRuntimeResponseError(response, "Could not inspect selection."),
          );
        }

        return;
      }

      if (!options.silent) {
        this.showStatus("Selection synced.");
      }
    } finally {
      if (options.source === "native-devtools") {
        window.setTimeout(() => {
          this.isApplyingNativeDevtoolsSelection = false;
        }, APPLY_NATIVE_SELECTION_RELEASE_MS);
      }
    }
  }

  private async syncState(options: {
    silent: boolean;
    forceRender?: boolean;
  }): Promise<void> {
    if (this.isSyncing) {
      return;
    }

    const tabId = this.getTabId();

    if (typeof tabId !== "number") {
      if (!options.silent) {
        this.showStatus("No inspected tab found.");
      }

      return;
    }

    this.isSyncing = true;

    try {
      const response = await this.sendRuntimeCommand({
        type: MESSAGE.GET_STATE,
        tabId,
        source: "devtools-panel",
        action: "state-sync",
      });

      if (!response?.ok) {
        if (!options.silent) {
          this.showStatus(
            getRuntimeResponseError(response, "Could not sync state."),
          );
        }

        return;
      }

      if (this.isInspectorState(response.state)) {
        if (options.forceRender) {
          this.lastStateSignature = "";
        }

        this.applyIncomingState(response.state, "devtools-panel", "state-sync");
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private async sendRuntimeCommand(
    command: RuntimeCommand,
  ): Promise<RuntimeResponse> {
    try {
      return (await extensionApi.runtime.sendMessage(
        command,
      )) as RuntimeResponse;
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not communicate with extension background.",
      };
    }
  }

  private isInspectorState(value: unknown): value is InspectorState {
    if (!value || typeof value !== "object") {
      return false;
    }

    const state = value as Partial<InspectorState>;

    return (
      typeof state.inspectModeEnabled === "boolean" &&
      typeof state.dockOpen === "boolean" &&
      typeof state.hasSelection === "boolean" &&
      typeof state.activeTab === "string"
    );
  }

  private applyIncomingState(
    state: InspectorState,
    source: InspectorInspectSource = INSPECT_SOURCE.PROGRAMMATIC,
    action: InspectorStateAction = "state-sync",
  ): void {
    this.currentState = state;
    this.renderStateIfChanged(state);
    void this.refreshNativeListeners(state);

    if (this.shouldSkipNativeDevtoolsMirror(state, source, action)) {
      return;
    }

    void this.syncSelectedElementToNativeDevtools(state);
  }

  private shouldSkipNativeDevtoolsMirror(
    state: InspectorState,
    source: InspectorInspectSource,
    action: InspectorStateAction,
  ): boolean {
    if (state.inspectModeEnabled) {
      return true;
    }

    if (!state.hasSelection) {
      return true;
    }

    if (this.isApplyingNativeDevtoolsSelection) {
      return true;
    }

    if (this.isMirroringSelectionToNativeDevtools) {
      return true;
    }

    if (source === "native-devtools") {
      return true;
    }

    if (
      action === "picker-started" ||
      action === "picker-stopped" ||
      action === "inspector-stopped" ||
      action === "dock-hidden" ||
      action === "dock-opened" ||
      action === "state-sync"
    ) {
      return true;
    }

    return false;
  }

  private renderStateIfChanged(state: InspectorState): void {
    const nextSignature = this.getStateSignature(state);

    if (nextSignature === this.lastStateSignature) {
      return;
    }

    this.lastStateSignature = nextSignature;
    this.renderState(state);
  }

  private clearNativeSelectionSyncTimer(): void {
    if (this.nativeSelectionSyncTimer === null) {
      return;
    }

    window.clearTimeout(this.nativeSelectionSyncTimer);
    this.nativeSelectionSyncTimer = null;
  }

  private renderState(state: InspectorState | null): void {
    const isPicking = Boolean(state?.inspectModeEnabled);
    const hasSelection = Boolean(state?.hasSelection);

    if (this.modeBadgeEl) {
      this.modeBadgeEl.dataset.state = isPicking ? "active" : "idle";
      this.modeBadgeEl.textContent = isPicking
        ? "Picking"
        : hasSelection
          ? "Selected"
          : "Idle";
    }

    if (this.rootEl) {
      this.rootEl.dataset.inspectorState = isPicking ? "active" : "idle";

      this.setActionDisabled({ action: "start-picking", disabled: isPicking });
      this.setActionDisabled({ action: "stop-picking", disabled: !isPicking });
      this.setActionDisabled({ action: "copy-selector", disabled: !hasSelection });
      this.setActionDisabled({ action: "copy-html", disabled: !hasSelection });
    }

    if (this.selectorEl) {
      this.selectorEl.textContent =
        state?.selectedSelectorPath || state?.selectedSelector || "—";
    }

    if (this.metaEl) {
      if (!state) {
        this.metaEl.textContent = "No state synced yet.";
      } else if (!hasSelection) {
        this.metaEl.textContent = isPicking
          ? "Picker is active. Click an element on the inspected page."
          : "No element selected.";
      } else {
        const dockText = state.dockOpen ? "Dock open" : "Dock hidden";
        this.metaEl.textContent = `${dockText} · Active tab: ${state.activeTab}`;
      }
    }

  }

  private setActionDisabled({
    action,
    disabled,
  }: {
    action: DevtoolsPanelAction;
    disabled: boolean;
  }): void {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-action="${action}"]`,
    );

    if (button) {
      button.disabled = disabled;
    }
  }

  private getStateSignature(state: InspectorState): string {
    return JSON.stringify({
      inspectModeEnabled: state.inspectModeEnabled,
      dockOpen: state.dockOpen,
      hasSelection: state.hasSelection,
      selectedSelector: state.selectedSelector,
      selectedSelectorPath: state.selectedSelectorPath,
      activeTab: state.activeTab,
    });
  }

  private async copyCurrentSelector(): Promise<void> {
    const selector =
      this.currentState?.selectedSelectorPath ||
      this.currentState?.selectedSelector ||
      "";

    if (!selector) {
      this.showStatus("No selector to copy.");
      return;
    }

    try {
      await this.copyText({ text: selector });
      this.showStatus("Selector copied.");
    } catch {
      this.showStatus("Could not copy selector.");
    }
  }

  private async copyCurrentHtml(): Promise<void> {
    const html = this.currentState?.selectedOuterHTML ?? "";

    if (!html) {
      this.showStatus("No HTML to copy.");
      return;
    }

    try {
      await this.copyText({ text: html });
      this.showStatus("HTML copied.");
    } catch {
      this.showStatus("Could not copy HTML.");
    }
  }

  private async copyText({ text }: { text: string }): Promise<void> {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Some DevTools panel contexts reject the async Clipboard API.
      }
    }

    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    Object.assign(textArea.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
    });
    document.body.appendChild(textArea);
    textArea.select();

    const copied = document.execCommand("copy");
    textArea.remove();

    if (!copied) {
      throw new Error("Clipboard write was rejected.");
    }
  }

  private async refreshNativeListeners(state: InspectorState): Promise<void> {
    const selector = state.selectedSelectorPath || state.selectedSelector;
    const requestId = ++this.listenerRequestId;

    if (!this.listenerOutputEl) return;
    if (!state.hasSelection || !selector) {
      this.listenerOutputEl.textContent = "Select an element to inspect its listeners.";
      return;
    }

    this.listenerOutputEl.textContent = "Loading event listeners…";
    const discovery = await this.evaluateInInspectedWindow<ListenerDiscovery>(
      buildNativeListenerExpression({ selector }),
    );

    const resolvedDiscovery = discovery
      ? await resolveListenerSourceMaps({ discovery })
      : null;

    if (requestId !== this.listenerRequestId) return;

    if (resolvedDiscovery) {
      this.listenerOutputEl.innerHTML = renderListenerDiscovery({
        discovery: resolvedDiscovery,
      });
    } else {
      this.listenerOutputEl.textContent = "Could not retrieve event listeners.";
    }
  }

  private async evaluateInInspectedWindow<T>(
    expression: string,
  ): Promise<T | null> {
    const inspectedWindow = extensionApi.devtools?.inspectedWindow;

    if (!inspectedWindow?.eval) {
      log("DevTools inspectedWindow.eval is unavailable.", undefined, "error");
      return null;
    }

    try {
      const evaluation = await inspectedWindow.eval(expression);
      const { result, error } = normalizeDevtoolsEvalResult<T>({
        evaluation,
      });

      if (error?.isError || error?.isException) {
        const devtoolsError = new Error(
          error.value || error.description || error.code || "DevTools evaluation failed.",
        );

        devtoolsError.name = "DevToolsEvalError";

        throw devtoolsError;
      }

      return result ?? null;
    } catch (error) {
      log("DevTools evaluation failed", error, "error");

      return null;
    }
  }

  private getTabId(): number | null {
    const tabId = extensionApi.devtools?.inspectedWindow?.tabId;

    return typeof tabId === "number" ? tabId : null;
  }

  private async restoreTheme(): Promise<void> {
    const result = await extensionApi.storage.local.get("theme");
    const maybeTheme = result.theme;

    if (maybeTheme === "light" || maybeTheme === "dark") {
      this.setTheme(maybeTheme);
    }
  }

  private setTheme(theme: "light" | "dark"): void {
    this.theme = theme;

    const root = document.documentElement;

    root.classList.toggle("theme-light", theme === "light");
    root.classList.toggle("theme-dark", theme === "dark");

    this.rootEl?.classList.toggle("theme-light", theme === "light");
    this.rootEl?.classList.toggle("theme-dark", theme === "dark");
  }

  private showStatus(message: string): void {
    if (!this.statusEl) {
      return;
    }

    this.statusEl.textContent = message;
    this.statusEl.classList.add("show");

    window.setTimeout(() => {
      this.statusEl?.classList.remove("show");
    }, 4000);
  }

  private async getSelectorForDevtoolsSelectedElement(): Promise<
    string | null
  > {
    const expression = `
      (() => {
        const element = $0;

        if (!element || !(element instanceof Element)) {
          return null;
        }

        const cssEscape = (value) => {
          if (window.CSS && typeof window.CSS.escape === "function") {
            return window.CSS.escape(value);
          }

          return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
        };

        const shortSelector = (el) => {
          const tag = el.tagName.toLowerCase();

          if (el.id) {
            return tag + "#" + cssEscape(el.id);
          }

          const classes = Array.from(el.classList || [])
            .filter(Boolean)
            .slice(0, 3)
            .map((className) => "." + cssEscape(className))
            .join("");

          return tag + classes;
        };

        const uniqueSelector = (el) => {
          if (el.id) {
            return "#" + cssEscape(el.id);
          }

          const path = [];
          let current = el;

          while (
            current &&
            current instanceof Element &&
            current !== document.documentElement
          ) {
            let part = shortSelector(current);
            const parent = current.parentElement;

            if (parent) {
              const siblings = Array.from(parent.children).filter(
                (sibling) => sibling.tagName === current.tagName,
              );

              if (siblings.length > 1) {
                part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
              }
            }

            path.unshift(part);

            const selector = path.join(" > ");

            try {
              if (document.querySelector(selector) === el) {
                return selector;
              }
            } catch {}

            current = parent;
          }

          path.unshift("html");
          return path.join(" > ");
        };

        return uniqueSelector(element);
      })();
    `;

    const result = await this.evaluateInInspectedWindow<string | null>(
      expression,
    );

    return typeof result === "string" && result ? result : null;
  }

  private async syncSelectedElementToNativeDevtools(
    state: InspectorState,
  ): Promise<void> {
    const selector = state.selectedSelectorPath || state.selectedSelector;

    if (!selector) {
      return;
    }

    if (selector === this.lastMirroredSelector) {
      return;
    }

    if (state.inspectModeEnabled) {
      return;
    }

    if (this.isApplyingNativeDevtoolsSelection) {
      return;
    }

    if (this.isMirroringSelectionToNativeDevtools) {
      return;
    }

    this.lastMirroredSelector = selector;
    this.isMirroringSelectionToNativeDevtools = true;

    const expression = `
      (() => {
        try {
          const element = document.querySelector(${JSON.stringify(selector)});

          if (!element) {
            return false;
          }

          inspect(element);
          return true;
        } catch {
          return false;
        }
      })();
    `;

    try {
      const mirrored =
        await this.evaluateInInspectedWindow<boolean>(expression);

      if (!mirrored) {
        this.lastMirroredSelector = "";
      }
    } finally {
      window.setTimeout(() => {
        this.isMirroringSelectionToNativeDevtools = false;
      }, MIRROR_NATIVE_SELECTION_RELEASE_MS);
    }
  }
}

new DevtoolsInspectorPanel().init();
