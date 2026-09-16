import browserApi from "webextension-polyfill";

import type {
  InspectorInspectSource,
  InspectorState,
  InspectorStateAction,
  Theme,
} from "./components/Inspector/Inspector";

const MESSAGE = {
  START: "ELEMENT_INSPECTOR_START",
  STOP: "ELEMENT_INSPECTOR_STOP",
  GET_STATE: "ELEMENT_INSPECTOR_GET_STATE",
} as const;

const ACTIVE_CLASS = "is-active";

type PopupCommandMessage = {
  type: (typeof MESSAGE)[keyof typeof MESSAGE];
  source: InspectorInspectSource;
  action: InspectorStateAction;
};

type InspectorStateResponse =
  | {
      ok: true;
      state: InspectorState;
    }
  | {
      ok: false;
      error: string;
    };

type BasicCommandResponse =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

const popupShell = document.querySelector<HTMLElement>(".popup-shell");
const toggleButton =
  document.querySelector<HTMLButtonElement>("#toggle-inspector");
const statusText = document.querySelector<HTMLParagraphElement>("#status");
const themeToggle = document.querySelector<HTMLButtonElement>("#themeToggle");

const isTheme = (value: unknown): value is Theme =>
  value === "light" || value === "dark";

async function sendPopupCommand<TResponse>(
  message: PopupCommandMessage,
): Promise<TResponse | undefined> {
  return browserApi.runtime.sendMessage(message) as Promise<
    TResponse | undefined
  >;
}

function setInspectorActive(inspectModeEnabled: boolean): void {
  const label = toggleButton?.querySelector<HTMLElement>(".btn-label");
  const state = inspectModeEnabled ? "active" : "inactive";

  popupShell?.classList.toggle(ACTIVE_CLASS, inspectModeEnabled);
  popupShell?.setAttribute("data-inspector-state", state);

  toggleButton?.classList.toggle(ACTIVE_CLASS, inspectModeEnabled);
  toggleButton?.setAttribute("aria-pressed", String(inspectModeEnabled));

  if (toggleButton) {
    toggleButton.dataset.state = state;
  }

  if (label) {
    label.textContent = inspectModeEnabled
      ? "Stop Inspecting"
      : "Inspect Element";
  }
}

async function syncInspectorState(): Promise<InspectorState | null> {
  try {
    const response = await sendPopupCommand<InspectorStateResponse>({
      type: MESSAGE.GET_STATE,
      source: "popup",
      action: "state-sync",
    });

    if (!response?.ok) {
      setInspectorActive(false);
      statusText!.textContent =
        response?.error || "Refresh the page, then try again.";
      return null;
    }

    setInspectorActive(response.state.inspectModeEnabled);
    return response.state;
  } catch (error) {
    console.error(error);

    setInspectorActive(false);

    if (statusText) {
      statusText.textContent = "Refresh the page, then try again.";
    }

    return null;
  }
}

async function toggleInspector(): Promise<void> {
  if (!toggleButton) {
    return;
  }

  try {
    toggleButton.disabled = true;

    if (statusText) {
      statusText.textContent = "";
    }

    const stateBefore = await syncInspectorState();
    const isActive = Boolean(stateBefore?.inspectModeEnabled);

    const response = await sendPopupCommand<BasicCommandResponse>({
      type: isActive ? MESSAGE.STOP : MESSAGE.START,
      source: "popup",
      action: isActive ? "inspector-stopped" : "picker-started",
    });

    if (!response?.ok) {
      setInspectorActive(false);

      if (statusText) {
        statusText.textContent =
          response?.error || "Could not update inspector state.";
      }

      return;
    }

    const stateAfter = await syncInspectorState();

    if (!stateAfter) {
      return;
    }

    if (statusText) {
      statusText.textContent = "";
    }

    if (!isActive) {
      window.close();
    }
  } catch (error) {
    console.error(error);

    setInspectorActive(false);

    if (statusText) {
      statusText.textContent = "Refresh the page, then try again.";
    }
  } finally {
    toggleButton.disabled = false;
  }
}

async function toggleTheme(): Promise<void> {
  try {
    const result = await browserApi.storage.local.get("theme");
    const currentTheme = isTheme(result.theme) ? result.theme : "light";
    const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";

    await browserApi.storage.local.set({
      theme: nextTheme,
    });

    document.documentElement.classList.remove("theme-light", "theme-dark");
    document.documentElement.classList.add(`theme-${nextTheme}`);

    themeToggle?.setAttribute("aria-pressed", String(nextTheme === "dark"));
    themeToggle?.setAttribute(
      "title",
      nextTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
    );
  } catch (error) {
    console.error(error);

    if (statusText) {
      statusText.textContent = "Could not update theme.";
    }
  }
}

toggleButton?.addEventListener("click", () => {
  void toggleInspector();
});

themeToggle?.addEventListener("click", () => {
  void toggleTheme();
});

void browserApi.storage.local.get("theme").then((result) => {
  const theme = isTheme(result.theme) ? result.theme : "light";

  document.documentElement.classList.remove("theme-light", "theme-dark");
  document.documentElement.classList.add(`theme-${theme}`);

  themeToggle?.setAttribute("aria-pressed", String(theme === "dark"));
  themeToggle?.setAttribute(
    "title",
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
  );
});

void syncInspectorState();
