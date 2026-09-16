import extensionApi from "webextension-polyfill";

import type {
  InspectorInspectSource,
  InspectorStateAction,
  Theme,
} from "./components/Inspector/Inspector";

type RuntimePort = extensionApi.Runtime.Port;

const MESSAGE = {
  START: "ELEMENT_INSPECTOR_START",
  STOP: "ELEMENT_INSPECTOR_STOP",
  GET_STATE: "ELEMENT_INSPECTOR_GET_STATE",
  GET_VIEW_MODEL: "ELEMENT_INSPECTOR_GET_VIEW_MODEL",
  INSPECT_SELECTOR: "ELEMENT_INSPECTOR_INSPECT_SELECTOR",
  SET_TREE_DEPTH: "ELEMENT_INSPECTOR_SET_TREE_DEPTH",
  TOGGLE_TREE_CHILDREN: "ELEMENT_INSPECTOR_TOGGLE_TREE_CHILDREN",
  STATE_CHANGED: "ELEMENT_INSPECTOR_STATE_CHANGED",
  THEME_CHANGED: "ELEMENT_INSPECTOR_THEME_CHANGED",
  DEVTOOLS_CONNECT: "ELEMENT_INSPECTOR_DEVTOOLS_CONNECT",
  FETCH_RESOURCE: "ELEMENT_INSPECTOR_FETCH_RESOURCE",
} as const;

type StartCommandMessage = {
  type: typeof MESSAGE.START;
  tabId?: number;
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
};

type StopCommandMessage = {
  type: typeof MESSAGE.STOP;
  tabId?: number;
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
};

type GetStateCommandMessage = {
  type: typeof MESSAGE.GET_STATE;
  tabId?: number;
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
};

type GetViewModelCommandMessage = {
  type: typeof MESSAGE.GET_VIEW_MODEL;
  tabId?: number;
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
};

type InspectSelectorCommandMessage = {
  type: typeof MESSAGE.INSPECT_SELECTOR;
  tabId?: number;
  selector?: string;
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
  openDock?: boolean;
  updateDockIfOpen?: boolean;
  emitState?: boolean;
};

type SetTreeDepthCommandMessage = {
  type: typeof MESSAGE.SET_TREE_DEPTH;
  tabId?: number;
  depth?: number;
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
};

type ToggleTreeChildrenCommandMessage = {
  type: typeof MESSAGE.TOGGLE_TREE_CHILDREN;
  tabId?: number;
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
};

type InspectorCommandMessage =
  | StartCommandMessage
  | StopCommandMessage
  | GetStateCommandMessage
  | GetViewModelCommandMessage
  | InspectSelectorCommandMessage
  | SetTreeDepthCommandMessage
  | ToggleTreeChildrenCommandMessage;

type InspectorStateChangedMessage = {
  type: typeof MESSAGE.STATE_CHANGED;
  tabId?: number;
  source?: InspectorInspectSource;
  action?: InspectorStateAction;
  state?: unknown;
  viewModel?: unknown;
};

type ThemeChangedMessage = {
  type: typeof MESSAGE.THEME_CHANGED;
  theme: Theme;
};

type FetchResourceMessage = {
  type: typeof MESSAGE.FETCH_RESOURCE;
  url?: string;
};

type FetchResourceResponse =
  | {
      ok: true;
      body: string;
      contentType: string;
      finalUrl: string;
    }
  | {
      ok: false;
      error: string;
    };

type InspectorResponse =
  | {
      ok: true;
      state?: unknown;
      viewModel?: unknown;
    }
  | {
      ok: false;
      error: string;
    };

type BackgroundResponse = InspectorResponse | FetchResourceResponse;

type MessageSenderLike = {
  tab?: {
    id?: number;
  };
};

const devtoolsPortsByTabId = new Map<number, Set<RuntimePort>>();

type RestrictedPageType = {
  name: string;
  scheme?: string;
  host?: string;
};

const RESTRICTED_PAGE_TYPES: Record<string, RestrictedPageType> = {
  ABOUT: { name: "Firefox about", scheme: "about:" },
  MOZ_EXTENSION: { name: "Firefox extension files", scheme: "moz-extension:" },
  CHROME: { name: "Chrome browser", scheme: "chrome://" },
  EDGE: { name: "Edge browser", scheme: "edge://" },
  DEVTOOLS: { name: "DevTools", scheme: "devtools://" },
  VIEW_SOURCE: { name: "View source", scheme: "view-source:" },
  CHROME_WEB_STORE: {
    name: "Chrome Web Store",
    host: "chromewebstore.google.com",
  },
};

function isMissingReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("Could not establish connection") ||
    message.includes("Receiving end does not exist") ||
    message.includes("No matching message handler")
  );
}

function waitForContentScript({ delayMs }: { delayMs: number }): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

/**
 * Loads the content bootstrap into pages that were already open when the
 * extension was installed or reloaded, then waits for its dynamic import to
 * register the runtime message listener.
 */
async function injectContentScriptAndRetry({
  tabId,
  message,
}: {
  tabId: number;
  message: Omit<InspectorCommandMessage, "tabId"> & {
    source: InspectorInspectSource;
    action: InspectorStateAction;
  };
}): Promise<InspectorResponse> {
  try {
    await extensionApi.scripting.executeScript({
      target: { tabId },
      files: ["content-wrapper.js"],
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not load the page inspector: ${error.message}`
          : "Could not load the page inspector.",
    };
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return (await extensionApi.tabs.sendMessage(
        tabId,
        message,
      )) as InspectorResponse;
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not communicate with the page inspector.",
        };
      }

      await waitForContentScript({ delayMs: 50 });
    }
  }

  return {
    ok: false,
    error: "The page inspector did not finish loading. Try the action again.",
  };
}

async function getTargetTabId(tabId?: number): Promise<number | null> {
  if (typeof tabId === "number") {
    return tabId;
  }

  const tabs = await extensionApi.tabs.query({
    active: true,
    currentWindow: true,
  });

  return typeof tabs[0]?.id === "number" ? tabs[0].id : null;
}

function getDefaultSourceForCommand(
  message: InspectorCommandMessage,
): InspectorInspectSource {
  if (message.source) {
    return message.source;
  }

  switch (message.type) {
    case MESSAGE.START:
    case MESSAGE.STOP:
      return "popup";

    case MESSAGE.INSPECT_SELECTOR:
      return "programmatic";

    case MESSAGE.SET_TREE_DEPTH:
    case MESSAGE.TOGGLE_TREE_CHILDREN:
      return "dock";

    case MESSAGE.GET_STATE:
    case MESSAGE.GET_VIEW_MODEL:
    default:
      return "programmatic";
  }
}

function getDefaultActionForCommand(
  message: InspectorCommandMessage,
): InspectorStateAction {
  if (message.action) {
    return message.action;
  }

  switch (message.type) {
    case MESSAGE.START:
      return "picker-started";

    case MESSAGE.STOP:
      return "inspector-stopped";

    case MESSAGE.GET_STATE:
    case MESSAGE.GET_VIEW_MODEL:
      return "state-sync";

    case MESSAGE.INSPECT_SELECTOR:
      return "element-inspected";

    case MESSAGE.SET_TREE_DEPTH:
      return "tree-depth-changed";

    case MESSAGE.TOGGLE_TREE_CHILDREN:
      return "tree-children-toggled";

    default:
      return "state-sync";
  }
}

async function forwardToContentScript(
  message: InspectorCommandMessage,
): Promise<InspectorResponse> {
  const { tabId: requestedTabId, ...rawForwardedMessage } = message;
  const targetTabId = await getTargetTabId(requestedTabId);

  if (typeof targetTabId !== "number") {
    return {
      ok: false,
      error: "No active page found.",
    };
  }

  const forwardedMessage = {
    ...rawForwardedMessage,
    source: getDefaultSourceForCommand(message),
    action: getDefaultActionForCommand(message),
  };

  try {
    const response = await extensionApi.tabs.sendMessage(
      targetTabId,
      forwardedMessage,
    );

    return response as InspectorResponse;
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not send message to content script.",
      };
    }

    try {
      const tab = await extensionApi.tabs.get(targetTabId);
      const url = tab.url ?? "";

      const restrictedPageType = Object.values(RESTRICTED_PAGE_TYPES).find(
        ({ scheme, host }) => {
          if (scheme && url.startsWith(scheme)) {
            return true;
          }

          if (!host) {
            return false;
          }

          try {
            return new URL(url).host === host;
          } catch {
            return false;
          }
        },
      );

      if (restrictedPageType) {
        return {
          ok: false,
          error: `Inspector is not available on ${restrictedPageType.name} pages.`,
        };
      }

      return injectContentScriptAndRetry({
        tabId: targetTabId,
        message: forwardedMessage,
      });
    } catch {
      return {
        ok: false,
        error: "Could not access the inspected page.",
      };
    }
  }
}

function isFetchableResourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "data:"
    );
  } catch {
    return false;
  }
}

async function fetchResource(
  message: FetchResourceMessage,
): Promise<FetchResourceResponse> {
  const url = typeof message.url === "string" ? message.url.trim() : "";

  if (!url) {
    return {
      ok: false,
      error: "Missing resource URL.",
    };
  }

  if (!isFetchableResourceUrl(url)) {
    return {
      ok: false,
      error: `Unsupported resource URL: ${url}`,
    };
  }

  try {
    const response = await fetch(url, {
      credentials: "include",
      cache: "force-cache",
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    return {
      ok: true,
      body: await response.text(),
      contentType: response.headers.get("content-type") || "",
      finalUrl: response.url || url,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not fetch resource.",
    };
  }
}

async function broadcastThemeChanged(theme: Theme): Promise<void> {
  const message: ThemeChangedMessage = {
    type: MESSAGE.THEME_CHANGED,
    theme,
  };

  const tabs = await extensionApi.tabs.query({});

  await Promise.allSettled(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map(async (tab) => {
        try {
          await extensionApi.tabs.sendMessage(tab.id as number, message);
        } catch (error) {
          if (!isMissingReceiverError(error)) {
            console.warn(
              "[Element Inspector] Failed to send theme to tab",
              tab.id,
              error,
            );
          }
        }
      }),
  );

  for (const [tabId, ports] of devtoolsPortsByTabId.entries()) {
    for (const port of ports) {
      try {
        port.postMessage(message);
      } catch {
        ports.delete(port);
      }
    }

    if (ports.size === 0) {
      devtoolsPortsByTabId.delete(tabId);
    }
  }
}

const messageHandlers = {
  [MESSAGE.STATE_CHANGED]: async (
    message: InspectorStateChangedMessage,
    sender: MessageSenderLike,
  ) => {
    const sourceTabId =
      typeof message.tabId === "number"
        ? message.tabId
        : typeof sender.tab?.id === "number"
          ? sender.tab.id
          : undefined;

    if (typeof sourceTabId !== "number") {
      return { ok: true } satisfies InspectorResponse;
    }

    const ports = devtoolsPortsByTabId.get(sourceTabId);

    if (!ports?.size) {
      return { ok: true } satisfies InspectorResponse;
    }

    const forwardedMessage: InspectorStateChangedMessage = {
      ...message,
      tabId: sourceTabId,
      source: message.source ?? "programmatic",
      action: message.action ?? "state-sync",
    };

    for (const port of ports) {
      try {
        port.postMessage(forwardedMessage);
      } catch {
        ports.delete(port);
      }
    }

    if (ports.size === 0) {
      devtoolsPortsByTabId.delete(sourceTabId);
    }

    return { ok: true } satisfies InspectorResponse;
  },

  [MESSAGE.START]: forwardToContentScript,
  [MESSAGE.STOP]: forwardToContentScript,
  [MESSAGE.GET_STATE]: forwardToContentScript,
  [MESSAGE.GET_VIEW_MODEL]: forwardToContentScript,
  [MESSAGE.TOGGLE_TREE_CHILDREN]: forwardToContentScript,

  [MESSAGE.INSPECT_SELECTOR]: async (
    message: InspectSelectorCommandMessage,
  ) => {
    if (typeof message.selector !== "string" || !message.selector) {
      return {
        ok: false,
        error: "Missing selector.",
      } satisfies InspectorResponse;
    }

    return forwardToContentScript(message);
  },

  [MESSAGE.SET_TREE_DEPTH]: async (message: SetTreeDepthCommandMessage) => {
    if (typeof message.depth !== "number") {
      return {
        ok: false,
        error: "Missing tree depth.",
      } satisfies InspectorResponse;
    }

    return forwardToContentScript(message);
  },
} as const;

extensionApi.runtime.onConnect.addListener((port) => {
  if (port.name !== "element-inspector-devtools") {
    return;
  }

  port.onMessage.addListener((message: unknown) => {
    const { type, tabId } = (message ?? {}) as {
      type?: unknown;
      tabId?: unknown;
    };

    if (type !== MESSAGE.DEVTOOLS_CONNECT || typeof tabId !== "number") {
      return;
    }

    let ports = devtoolsPortsByTabId.get(tabId);

    if (!ports) {
      ports = new Set<RuntimePort>();
      devtoolsPortsByTabId.set(tabId, ports);
    }

    ports.add(port);

    port.onDisconnect.addListener(() => {
      const currentPorts = devtoolsPortsByTabId.get(tabId);

      if (!currentPorts) {
        return;
      }

      currentPorts.delete(port);

      if (currentPorts.size === 0) {
        devtoolsPortsByTabId.delete(tabId);
      }
    });
  });
});

extensionApi.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  const nextTheme = changes.theme?.newValue;

  if (nextTheme !== "light" && nextTheme !== "dark") {
    return;
  }

  void broadcastThemeChanged(nextTheme);
});

extensionApi.runtime.onMessage.addListener(
  async (
    message: unknown,
    sender: MessageSenderLike,
  ): Promise<BackgroundResponse | undefined> => {
    const type = (message as { type?: unknown } | null)?.type;

    if (type === MESSAGE.FETCH_RESOURCE) {
      return fetchResource(message as FetchResourceMessage);
    }

    if (type === MESSAGE.STATE_CHANGED) {
      return messageHandlers[MESSAGE.STATE_CHANGED](
        message as InspectorStateChangedMessage,
        sender,
      );
    }

    if (type === MESSAGE.INSPECT_SELECTOR) {
      return messageHandlers[MESSAGE.INSPECT_SELECTOR](
        message as InspectSelectorCommandMessage,
      );
    }

    if (type === MESSAGE.SET_TREE_DEPTH) {
      return messageHandlers[MESSAGE.SET_TREE_DEPTH](
        message as SetTreeDepthCommandMessage,
      );
    }

    if (type === MESSAGE.START) {
      return messageHandlers[MESSAGE.START](message as StartCommandMessage);
    }

    if (type === MESSAGE.STOP) {
      return messageHandlers[MESSAGE.STOP](message as StopCommandMessage);
    }

    if (type === MESSAGE.GET_STATE) {
      return messageHandlers[MESSAGE.GET_STATE](
        message as GetStateCommandMessage,
      );
    }

    if (type === MESSAGE.GET_VIEW_MODEL) {
      return messageHandlers[MESSAGE.GET_VIEW_MODEL](
        message as GetViewModelCommandMessage,
      );
    }

    if (type === MESSAGE.TOGGLE_TREE_CHILDREN) {
      return messageHandlers[MESSAGE.TOGGLE_TREE_CHILDREN](
        message as ToggleTreeChildrenCommandMessage,
      );
    }

    return undefined;
  },
);
