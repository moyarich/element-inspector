
import extensionApi from "webextension-polyfill";

import { Inspector } from "../Inspector/Inspector";
import type {
  InspectElementOptions,
  InspectorInspectSource,
  InspectorStateAction,
  Theme,
} from "../Inspector/Inspector";

declare global {
  interface Window {
    __MOYARICH_ELEMENT_INSPECTOR_CONTENT_LOADED__?: boolean;
  }
}

const MESSAGE = {
  START: "ELEMENT_INSPECTOR_START",
  STOP: "ELEMENT_INSPECTOR_STOP",
  GET_STATE: "ELEMENT_INSPECTOR_GET_STATE",
  GET_VIEW_MODEL: "ELEMENT_INSPECTOR_GET_VIEW_MODEL",
  INSPECT_SELECTOR: "ELEMENT_INSPECTOR_INSPECT_SELECTOR",
  SET_TREE_DEPTH: "ELEMENT_INSPECTOR_SET_TREE_DEPTH",
  TOGGLE_TREE_CHILDREN: "ELEMENT_INSPECTOR_TOGGLE_TREE_CHILDREN",
  THEME_CHANGED: "ELEMENT_INSPECTOR_THEME_CHANGED",
} as const;

type RuntimeMessage =
  | {
      type: typeof MESSAGE.START;
      source?: InspectorInspectSource;
      action?: InspectorStateAction;
    }
  | {
      type: typeof MESSAGE.STOP;
      source?: InspectorInspectSource;
      action?: InspectorStateAction;
    }
  | {
      type: typeof MESSAGE.GET_STATE;
    }
  | {
      type: typeof MESSAGE.GET_VIEW_MODEL;
    }
  | {
      type: typeof MESSAGE.INSPECT_SELECTOR;
      selector: string;
      source?: InspectorInspectSource;
      action?: InspectorStateAction;
      openDock?: boolean;
      updateDockIfOpen?: boolean;
      emitState?: boolean;
    }
  | {
      type: typeof MESSAGE.SET_TREE_DEPTH;
      depth: number;
    }
  | {
      type: typeof MESSAGE.TOGGLE_TREE_CHILDREN;
    }
  | {
      type: typeof MESSAGE.THEME_CHANGED;
      theme: Theme;
    };

type RuntimeResponse =
  | {
      ok: true;
      state?: unknown;
      viewModel?: unknown;
    }
  | {
      ok: false;
      error: string;
    };

const inspector = new Inspector();

function getInspectOptions(
  message: Extract<RuntimeMessage, { type: typeof MESSAGE.INSPECT_SELECTOR }>,
): InspectElementOptions {
  return {
    source: message.source ?? "programmatic",
    action: message.action ?? "element-inspected",
    openDock: message.openDock ?? true,
    updateDockIfOpen: message.updateDockIfOpen ?? true,
    emitState: message.emitState ?? true,
  };
}

function handleRuntimeMessage(message: RuntimeMessage): RuntimeResponse {
  switch (message.type) {
    case MESSAGE.START: {
      inspector.start(message.source ?? "programmatic");

      return {
        ok: true,
      };
    }

    case MESSAGE.STOP: {
      inspector.stop(message.source ?? "programmatic");

      return {
        ok: true,
      };
    }

    case MESSAGE.GET_STATE: {
      return {
        ok: true,
        state: inspector.getState(),
      };
    }

    case MESSAGE.GET_VIEW_MODEL: {
      return {
        ok: true,
        viewModel: inspector.getViewModel(),
      };
    }

    case MESSAGE.INSPECT_SELECTOR: {
      if (!message.selector || typeof message.selector !== "string") {
        return {
          ok: false,
          error: "Missing selector.",
        };
      }

      const inspected = inspector.inspectSelector(
        message.selector,
        getInspectOptions(message),
      );

      if (!inspected) {
        return {
          ok: false,
          error: `No element found for selector: ${message.selector}`,
        };
      }

      return {
        ok: true,
      };
    }

    case MESSAGE.SET_TREE_DEPTH: {
      inspector.setTreeDepth(message.depth);

      return {
        ok: true,
      };
    }

    case MESSAGE.TOGGLE_TREE_CHILDREN: {
      inspector.toggleTreeChildren();

      return {
        ok: true,
      };
    }

    case MESSAGE.THEME_CHANGED: {
      inspector.setTheme(message.theme);

      return {
        ok: true,
      };
    }

    default: {
      return {
        ok: false,
        error: "Unknown inspector message.",
      };
    }
  }
}

function bindRuntimeMessages(): void {
  extensionApi.runtime.onMessage.addListener(
    async (message: unknown): Promise<RuntimeResponse | undefined> => {
      const type = (message as { type?: unknown } | null)?.type;

      switch (type) {
        case MESSAGE.START:
        case MESSAGE.STOP:
        case MESSAGE.GET_STATE:
        case MESSAGE.GET_VIEW_MODEL:
        case MESSAGE.INSPECT_SELECTOR:
        case MESSAGE.SET_TREE_DEPTH:
        case MESSAGE.TOGGLE_TREE_CHILDREN:
        case MESSAGE.THEME_CHANGED: {
          try {
            return handleRuntimeMessage(message as RuntimeMessage);
          } catch (error) {
            console.error(
              "[Moyarich] Element inspector message failed:",
              error,
            );

            return {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown inspector runtime error.",
            };
          }
        }

        default: {
          return undefined;
        }
      }
    },
  );
}

function bindWindowMessages(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;

    if (!data || typeof data !== "object") {
      return;
    }

    switch (data.type) {
      case "__MOYA_INSPECTOR_START_PICKING__": {
        inspector.start(data.source ?? "programmatic");
        break;
      }

      case "__MOYA_INSPECTOR_STOP_PICKING__": {
        inspector.stop(data.source ?? "programmatic");
        break;
      }

      case "__MOYA_INSPECTOR_INSPECT_SELECTOR__": {
        if (typeof data.selector === "string") {
          inspector.inspectSelector(data.selector, {
            source: data.source ?? "programmatic",
            action: data.action ?? "element-inspected",
            openDock: data.openDock ?? true,
            updateDockIfOpen: data.updateDockIfOpen ?? true,
            emitState: data.emitState ?? true,
          });
        }

        break;
      }

      default: {
        break;
      }
    }
  });
}

if (!window.__MOYARICH_ELEMENT_INSPECTOR_CONTENT_LOADED__) {
  window.__MOYARICH_ELEMENT_INSPECTOR_CONTENT_LOADED__ = true;

  bindRuntimeMessages();
  bindWindowMessages();
}

export {};
