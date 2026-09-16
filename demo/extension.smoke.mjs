import puppeteer from "puppeteer";
import path from "node:path";
import { promises as fs } from "node:fs";
import chalk from "chalk";
import { hideDemoCaption, showDemoCaption } from "./demo-caption.mjs";
import { installDemoCursorOverlay } from "./demo-cursor-overlay.mjs";
import createExampleInspectionScenario from "./scenarios/example-inspection.mjs";
import createGoogleJavaScriptScenario from "./scenarios/google-javascript.mjs";
import createCssomRulesScenario from "./scenarios/cssom-rules.mjs";

// ============================================================================
// Constants
// ============================================================================

const InspectorTab = Object.freeze({
  INFO: "info",
  TREE: "tree",
  HTML: "html",
  CSS: "css",
  COMPUTED: "computed",
  VARS: "vars",
  JS: "js",
  PREVIEW: "preview",
});

const DockPosition = Object.freeze({
  FLOAT: "float",
  LEFT: "left",
  RIGHT: "right",
  BOTTOM: "bottom",
  UNKNOWN: "unknown",
});

const ProcessSignal = Object.freeze({
  INTERRUPT: "SIGINT",
  TERMINATE: "SIGTERM",
  HANGUP: "SIGHUP",
});

const SignalLabel = Object.freeze({
  [ProcessSignal.INTERRUPT]: "Ctrl+C",
  [ProcessSignal.TERMINATE]: "SIGTERM",
  [ProcessSignal.HANGUP]: "SIGHUP",
});

// ============================================================================
// UI
// ============================================================================

const UI = {
  inspector: {
    hostId: "__simple_element_inspector_host__",
    activeCursorClass: "__moya_element_inspector_active__",

    selector: {
      panel: ".panel",
      selectorLabel: ".selector",

      activeTab: '.tab-btn[data-state="active"]',
      activePanel: ".tab-panel.active, .tab-panel[data-state='active']",

      loading: ".inspector-loading",

      resizeCorner: '[data-role="resize-corner"]',
      resizeEdge: '[data-role="resize-edge"]',

      tab: (name) => `[data-tab="${name}"]`,

      codePenCandidates: [
        '[data-action="codepen"]',
        '[data-role="codepen"]',
        ".codepen-btn",
        ".codepen-button",
        'a[href*="codepen.io"]',
      ],
    },

    className: {
      active: "active",

      dock: {
        [DockPosition.FLOAT]: "dock-float",
        [DockPosition.LEFT]: "dock-left",
        [DockPosition.RIGHT]: "dock-right",
        [DockPosition.BOTTOM]: "dock-bottom",
      },
    },
  },

  popup: {
    selector: {
      toggleInspector: "#toggle-inspector",
    },
  },
};

// ============================================================================
// Configuration
// ============================================================================

//const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

const demoMode = process.argv.includes("--demo");
const closeWhenFinished = demoMode || process.argv.includes("--ci");

const CONFIG = {
  extensionPath: path.resolve("dist"),

  artifact: {
    screenshots: path.resolve("demo", "artifacts", "screenshots"),

    demoVideo: path.resolve(
      "demo",
      "artifacts",
      "demo",
      "element-inspector-demo.webm",
    ),
  },

  test: {
    example: {
      url: "https://example.com",
      elementSelector: "h1",
    },

    google: {
      url: "https://www.google.com/",

      targets: [
        {
          name: "search field",
          selector: 'textarea[name="q"], input[name="q"]',
        },
        {
          name: "Google Search button",
          selector: 'input[name="btnK"]',
        },
        {
          name: "I'm Feeling Lucky button",
          selector: 'input[name="btnI"]',
        },
      ],
    },
  },

  browser: {
    windowWidth: 1400,
    windowHeight: 1000,
  },

  timeout: {
    popup: 10_000,
    picker: 10_000,
    inspector: 10_000,
    tabActivation: 5_000,
    tabLoading: 30_000,
    codePen: 10_000,
  },

  delay: {
    pageReady: 1_500,
    hover: 300,
    selection: 300,
    screenshot: 200,
    externalPage: 1_000,
  },

  resize: {
    deltaX: -100,
    deltaY: -80,
    steps: 24,
    stepDelay: 45,
    holdDelay: 250,
    settleDelay: 400,
    minimumChange: 20,
  },

  screenshot: {
    fullPage: false,
    clearOnStart: true,
  },

  contentPreviewLength: 180,
};

// ============================================================================
// Inspector workflow
// ============================================================================

const WORKFLOW = [
  InspectorTab.INFO,
  InspectorTab.TREE,
  InspectorTab.HTML,
  InspectorTab.CSS,
  InspectorTab.COMPUTED,
  InspectorTab.VARS,
  InspectorTab.JS,
  InspectorTab.PREVIEW,
];

const DEMO_STEPS = Object.freeze({
  INTRO: {
    id: "intro",
    title: "Inspect any element",
    description: "Select a page element to explore its HTML, CSS, and context.",
    placement: "top-right",
    pointer: "bubble",
  },
  ACTIVATE_PICKER: {
    id: "activate-picker",
    title: "Element picker enabled",
    description: "Move the pointer over the page to choose an element.",
    placement: "top-right",
    pointer: "bubble",
  },
  HOVER_TARGET: {
    id: "hover-target",
    title: "Element highlighted",
    description: "The outline shows exactly what will be inspected.",
    placement: { side: "bottom", offset: 45 },
    pointer: "arrow",
  },
  SELECT_TARGET: {
    id: "select-target",
    title: "Inspect this element",
    description: "Click the highlighted element to open its details.",
    placement: { side: "bottom", offset: 45 },
    pointer: "arrow",
  },
  RESIZE_INSPECTOR: {
    id: "resize-inspector",
    title: "Resize the inspector",
    description: "Drag the corner to make more room for the page or panel.",
    placement: { side: "top", offset: 48 },
    pointer: "arrow",
  },
  OPEN_CODEPEN: {
    id: "open-codepen",
    title: "Continue in CodePen",
    description: "Export the captured element as an editable example.",
    placement: { side: "top", offset: 48 },
    pointer: "arrow",
  },
  TABS: Object.freeze(
    Object.fromEntries(
      WORKFLOW.map((tabName) => [
        tabName,
        {
          id: `open-${tabName}-tab`,
          title: `${tabName.toUpperCase()} details`,
          description: `Explore the captured ${tabName} information.`,
          placement: { side: "right", offset: 52 },
          pointer: "arrow",
          leadDelay: 900,
          readDelay: 1_100,
        },
      ]),
    ),
  ),
});

// ============================================================================
// Logging
// ============================================================================

const log = {
  info(message) {
    console.log(chalk.blue("ℹ"), chalk.blue(message));
  },

  success(message) {
    console.log(chalk.green("✔"), chalk.green.bold(message));
  },

  warning(message) {
    console.log(chalk.yellow("⚠"), chalk.yellow(message));
  },

  error(message) {
    console.error(chalk.red("✖"), chalk.red.bold(message));
  },

  step(message) {
    console.log(chalk.cyan("→"), chalk.white(message));
  },

  value(label, value) {
    console.log(chalk.gray(`${label}:`), chalk.magenta(String(value)));
  },

  heading(message) {
    console.log();
    console.log(chalk.bold.underline(message));
    console.log();
  },

  divider() {
    console.log(
      chalk.green.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"),
    );
  },
};

// ============================================================================
// Generic helpers
// ============================================================================

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function printError(error) {
  if (error instanceof Error) {
    console.error(chalk.red(error.stack ?? error.message));

    return;
  }

  console.error(chalk.red(String(error)));
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ============================================================================
// Screenshot manager
// ============================================================================

function createScreenshotManager() {
  let sequence = 0;

  const paths = [];

  async function prepare() {
    if (CONFIG.screenshot.clearOnStart) {
      await fs.rm(CONFIG.artifact.screenshots, {
        recursive: true,
        force: true,
      });
    }

    await fs.mkdir(CONFIG.artifact.screenshots, {
      recursive: true,
    });

    log.value("Screenshots", CONFIG.artifact.screenshots);
  }

  async function capture(page, name) {
    sequence += 1;

    const number = String(sequence).padStart(2, "0");

    const fileName = `${number}-${slugify(name)}.png`;

    const filePath = path.join(CONFIG.artifact.screenshots, fileName);

    await delay(CONFIG.delay.screenshot);

    try {
      await page.screenshot({
        path: filePath,
        fullPage: CONFIG.screenshot.fullPage,
      });
    } catch (error) {
      log.error(`Unable to capture screenshot: ${fileName}`);

      throw error;
    }

    paths.push(filePath);

    log.success(`Screenshot: ${fileName}`);

    return filePath;
  }

  return {
    prepare,
    capture,

    get paths() {
      return [...paths];
    },

    get count() {
      return paths.length;
    },
  };
}

// ============================================================================
// Browser helpers
// ============================================================================

async function launchBrowser() {
  log.step("Launching Chrome...");

  return puppeteer.launch({
    headless: false,

    enableExtensions: true,

    defaultViewport: null,

    args: [
      `--window-size=${CONFIG.browser.windowWidth},${CONFIG.browser.windowHeight}`,
    ],

    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

async function getViewport(page) {
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
}

async function showDemoStep({ page, step, anchor }) {
  if (!demoMode) return;
  const placement =
    typeof step.placement === "string"
      ? step.placement
      : { ...step.placement, x: anchor.x, y: anchor.y };
  await showDemoCaption({
    page,
    caption: {
      id: step.id,
      title: step.title,
      description: step.description,
      placement,
      pointer: step.pointer,
    },
  });
  await delay(step.leadDelay ?? 700);
}

async function hideDemoStep({ page }) {
  if (!demoMode) return;
  await hideDemoCaption({ page });
  await delay(800);
}

async function moveDemoMouseTo(page, selector) {
  const point = await page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, selector);

  if (!point) throw new Error(`Demo target not found: ${selector}`);
  await page.mouse.move(point.x, point.y, { steps: demoMode ? 24 : 1 });
}

async function openPage(page, url) {
  await page.bringToFront();

  await page.goto(url, {
    waitUntil: "domcontentloaded",
  });

  await delay(CONFIG.delay.pageReady);
}

// ============================================================================
// Extension helpers
// ============================================================================

async function installExtension(browser) {
  log.step("Installing Element Inspector...");

  const extensionId = await browser.installExtension(CONFIG.extensionPath);

  const extensions = await browser.extensions();

  const extension = extensions.get(extensionId);

  if (!extension) {
    throw new Error("Element Inspector extension was not found.");
  }

  log.success("Extension installed");

  log.value("Extension ID", extensionId);
  log.value("Extension", extension.name);
  log.value("Version", extension.version);

  return {
    extensionId,
    extension,
  };
}

async function openExtensionPopup({ browser, page, extension, extensionId }) {
  log.step("Opening Element Inspector popup...");

  const popupTargetPromise = browser.waitForTarget(
    (target) => {
      const url = target.url();

      return (
        target.type() === "page" &&
        url.includes(extensionId) &&
        url.endsWith("popup.html")
      );
    },
    {
      timeout: CONFIG.timeout.popup,
    },
  );

  await page.triggerExtensionAction(extension);

  const target = await popupTargetPromise;

  const popup = await target.asPage();

  if (!popup) {
    throw new Error("Extension popup did not open.");
  }

  log.success("Popup opened");

  return popup;
}

async function activateInspector(popup) {
  log.step("Activating inspector...");

  await popup.waitForSelector(UI.popup.selector.toggleInspector, {
    visible: true,
  });

  await popup.click(UI.popup.selector.toggleInspector);

  log.success("Inspector activated");
}

// ============================================================================
// Inspector state
// ============================================================================

async function waitForInspectorHost(page) {
  await page.waitForSelector(`#${UI.inspector.hostId}`, {
    timeout: CONFIG.timeout.inspector,
  });
}

async function waitForPicker(page) {
  log.step("Waiting for picker mode...");

  await page.waitForFunction(
    (activeCursorClass) =>
      document.documentElement.classList.contains(activeCursorClass),
    {
      timeout: CONFIG.timeout.picker,
    },
    UI.inspector.activeCursorClass,
  );

  log.success("Picker mode confirmed");
}

async function getInspectorSnapshot(page) {
  return page.evaluate(
    ({ hostId, activeCursorClass, selector, className, unknownDock }) => {
      const host = document.getElementById(hostId);

      if (!host?.shadowRoot) {
        return null;
      }

      const root = host.shadowRoot;

      const panel = root.querySelector(selector.panel);

      if (!panel) {
        return {
          hostFound: true,
          shadowRootFound: true,
          panelFound: false,
        };
      }

      const selectorLabel = root.querySelector(selector.selectorLabel);

      const activeTab = root.querySelector(selector.activeTab);

      const resizeCorner = root.querySelector(selector.resizeCorner);

      const resizeEdge = root.querySelector(selector.resizeEdge);

      const rect = panel.getBoundingClientRect();

      let dock = unknownDock;

      for (const [position, dockClass] of Object.entries(className.dock)) {
        if (panel.classList.contains(dockClass)) {
          dock = position;

          break;
        }
      }

      return {
        hostFound: true,
        shadowRootFound: true,
        panelFound: true,

        panelDisplay: getComputedStyle(panel).display,

        panelWidth: Math.round(rect.width),

        panelHeight: Math.round(rect.height),

        panelLeft: Math.round(rect.left),

        panelTop: Math.round(rect.top),

        dock,

        selector: selectorLabel?.textContent?.trim() ?? null,

        activeTab: activeTab?.getAttribute("data-tab") ?? null,

        pickerActive:
          document.documentElement.classList.contains(activeCursorClass),

        resizeCornerFound: Boolean(resizeCorner),

        resizeEdgeFound: Boolean(resizeEdge),
      };
    },
    {
      hostId: UI.inspector.hostId,
      activeCursorClass: UI.inspector.activeCursorClass,
      selector: UI.inspector.selector,
      className: UI.inspector.className,
      unknownDock: DockPosition.UNKNOWN,
    },
  );
}

function assertInspector(snapshot) {
  if (!snapshot?.hostFound) {
    throw new Error("Inspector host was not created.");
  }

  if (!snapshot.shadowRootFound) {
    throw new Error("Inspector Shadow DOM was not created.");
  }

  if (!snapshot.panelFound) {
    throw new Error("Inspector panel was not created.");
  }

  if (snapshot.panelDisplay === "none") {
    throw new Error("Inspector dock did not open.");
  }

  if (!snapshot.selector) {
    throw new Error("Selected element selector was not displayed.");
  }
}

function printInspectorSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  log.value("Host found", snapshot.hostFound);

  log.value("Shadow root found", snapshot.shadowRootFound);

  log.value("Panel found", snapshot.panelFound);

  log.value("Panel display", snapshot.panelDisplay);

  log.value("Panel size", `${snapshot.panelWidth} × ${snapshot.panelHeight}`);

  log.value("Dock", snapshot.dock);
  log.value("Selector", snapshot.selector);
  log.value("Active tab", snapshot.activeTab);
  log.value("Picker active", snapshot.pickerActive);
  log.value("Resize corner", snapshot.resizeCornerFound);
  log.value("Resize edge", snapshot.resizeEdgeFound);
}

// ============================================================================
// Inspector tabs
// ============================================================================

async function clickInspectorTab(page, tabName) {
  const tabSelector = UI.inspector.selector.tab(tabName);

  if (demoMode) {
    const point = await page.evaluate(
      ({ hostId, tabSelector }) => {
        const button = document
          .getElementById(hostId)
          ?.shadowRoot?.querySelector(tabSelector);
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      { hostId: UI.inspector.hostId, tabSelector },
    );
    if (!point) throw new Error(`Tab "${tabName}" was not found.`);
    await page.mouse.move(point.x, point.y, { steps: 20 });
    await showDemoStep({
      page,
      step: DEMO_STEPS.TABS[tabName],
      anchor: point,
    });
    await page.mouse.down();
    await page.mouse.up();
    return;
  }

  const result = await page.evaluate(
    ({ hostId, tabSelector, tabName }) => {
      const root = document.getElementById(hostId)?.shadowRoot;

      if (!root) {
        return {
          success: false,
          reason: "Inspector Shadow DOM was not found.",
        };
      }

      const button = root.querySelector(tabSelector);

      if (!(button instanceof HTMLElement)) {
        return {
          success: false,
          reason: `Tab "${tabName}" was not found.`,
        };
      }

      button.click();

      return {
        success: true,
      };
    },
    {
      hostId: UI.inspector.hostId,
      tabSelector,
      tabName,
    },
  );

  if (!result.success) {
    throw new Error(
      result.reason ?? `Unable to open inspector tab: ${tabName}`,
    );
  }
}

async function waitForInspectorTabActive(page, tabName) {
  const tabSelector = UI.inspector.selector.tab(tabName);

  await page.waitForFunction(
    ({ hostId, tabSelector, activeClass }) => {
      const root = document.getElementById(hostId)?.shadowRoot;

      const button = root?.querySelector(tabSelector);

      if (!button) {
        return false;
      }

      return (
        button.classList.contains(activeClass) ||
        button.getAttribute("data-state") === "active"
      );
    },
    {
      timeout: CONFIG.timeout.tabActivation,
    },
    {
      hostId: UI.inspector.hostId,
      tabSelector,
      activeClass: UI.inspector.className.active,
    },
  );
}

async function waitForInspectorTabContent(page, tabName) {
  const tabSelector = UI.inspector.selector.tab(tabName);

  try {
    await page.waitForFunction(
      ({ hostId, tabSelector, loadingSelector, activeClass }) => {
        const root = document.getElementById(hostId)?.shadowRoot;

        if (!root) {
          return false;
        }

        const button = root.querySelector(tabSelector);

        const active =
          button?.classList.contains(activeClass) ||
          button?.getAttribute("data-state") === "active";

        return active && !root.querySelector(loadingSelector);
      },
      {
        timeout: CONFIG.timeout.tabLoading,
      },
      {
        hostId: UI.inspector.hostId,
        tabSelector,
        loadingSelector: UI.inspector.selector.loading,
        activeClass: UI.inspector.className.active,
      },
    );
  } catch {
    log.warning(
      `${tabName} tab is still loading after ${
        CONFIG.timeout.tabLoading / 1000
      } seconds.`,
    );
  }
}

async function readInspectorTab(page, tabName) {
  const tabSelector = UI.inspector.selector.tab(tabName);

  return page.evaluate(
    ({
      hostId,
      tabSelector,
      activePanelSelector,
      loadingSelector,
      activeClass,
      tabName,
      previewLength,
    }) => {
      const root = document.getElementById(hostId)?.shadowRoot;

      if (!root) {
        return null;
      }

      const button = root.querySelector(tabSelector);

      const activePanel = root.querySelector(activePanelSelector);

      const active =
        button?.classList.contains(activeClass) ||
        button?.getAttribute("data-state") === "active";

      return {
        tab: tabName,
        active,

        loading: Boolean(root.querySelector(loadingSelector)),

        text:
          activePanel?.textContent
            ?.replace(/\s+/g, " ")
            .trim()
            .slice(0, previewLength) ?? "",
      };
    },
    {
      hostId: UI.inspector.hostId,
      tabSelector,

      activePanelSelector: UI.inspector.selector.activePanel,

      loadingSelector: UI.inspector.selector.loading,

      activeClass: UI.inspector.className.active,

      tabName,

      previewLength: CONFIG.contentPreviewLength,
    },
  );
}

async function openInspectorTab({ page, tabName, screenshots }) {
  log.step(`Opening inspector tab: ${tabName}`);

  await clickInspectorTab(page, tabName);

  await waitForInspectorTabActive(page, tabName);

  await waitForInspectorTabContent(page, tabName);

  const state = await readInspectorTab(page, tabName);

  if (!state?.active) {
    throw new Error(`Inspector tab "${tabName}" did not become active.`);
  }

  log.success(`Inspector tab active: ${tabName}`);

  if (state.text) {
    log.value("Content", state.text);
  }

  await screenshots.capture(page, `inspector-tab-${tabName}-caption`);
  await delay(DEMO_STEPS.TABS[tabName].readDelay ?? 700);
  await hideDemoStep({ page });

  await screenshots.capture(page, `inspector-tab-${tabName}`);

  return state;
}

async function runInspectorWorkflow({ page, screenshots }) {
  log.heading("Inspector Workflow");

  const results = [];

  for (const tabName of WORKFLOW) {
    results.push(
      await openInspectorTab({
        page,
        tabName,
        screenshots,
      }),
    );
  }

  return results;
}

function printTabResults(results) {
  log.heading("Tab Test Results");

  for (const result of results) {
    const status = result.active ? chalk.green("PASS") : chalk.red("FAIL");

    console.log(`${status} ${result.tab}`);
  }
}

// ============================================================================
// Floating dock resize
// ============================================================================

async function getFloatingResizeState(page) {
  return page.evaluate(
    ({ hostId, panelSelector, resizeCornerSelector, floatingClass }) => {
      const root = document.getElementById(hostId)?.shadowRoot;

      if (!root) {
        return null;
      }

      const panel = root.querySelector(panelSelector);

      const handle = root.querySelector(resizeCornerSelector);

      if (!panel || !handle) {
        return null;
      }

      const panelRect = panel.getBoundingClientRect();

      const handleRect = handle.getBoundingClientRect();

      return {
        floating: panel.classList.contains(floatingClass),

        panel: {
          width: panelRect.width,
          height: panelRect.height,
        },

        handle: {
          x: handleRect.left + handleRect.width / 2,

          y: handleRect.top + handleRect.height / 2,
        },
      };
    },
    {
      hostId: UI.inspector.hostId,

      panelSelector: UI.inspector.selector.panel,

      resizeCornerSelector: UI.inspector.selector.resizeCorner,

      floatingClass: UI.inspector.className.dock[DockPosition.FLOAT],
    },
  );
}

async function getInspectorPanelSize(page) {
  return page.evaluate(
    ({ hostId, panelSelector }) => {
      const panel = document
        .getElementById(hostId)
        ?.shadowRoot?.querySelector(panelSelector);

      if (!panel) {
        return null;
      }

      const rect = panel.getBoundingClientRect();

      return {
        width: rect.width,
        height: rect.height,
      };
    },
    {
      hostId: UI.inspector.hostId,

      panelSelector: UI.inspector.selector.panel,
    },
  );
}

async function testFloatingDockResize({ page, screenshots }) {
  log.heading("Dock Resize Test");

  const before = await getFloatingResizeState(page);

  if (!before) {
    throw new Error("Could not locate dock resize corner.");
  }

  if (!before.floating) {
    log.warning("Panel is not floating. Floating resize test skipped.");

    return;
  }

  log.value(
    "Before",
    `${Math.round(before.panel.width)} × ${Math.round(before.panel.height)}`,
  );

  await screenshots.capture(page, "dock-before-resize");

  await page.mouse.move(before.handle.x, before.handle.y, { steps: 20 });
  await showDemoStep({
    page,
    step: DEMO_STEPS.RESIZE_INSPECTOR,
    anchor: before.handle,
  });

  await screenshots.capture(page, "dock-resize-caption");

  await page.mouse.down({
    button: "left",
  });

  await delay(CONFIG.resize.holdDelay);

  for (let step = 1; step <= CONFIG.resize.steps; step += 1) {
    const progress = step / CONFIG.resize.steps;
    await page.mouse.move(
      before.handle.x + CONFIG.resize.deltaX * progress,
      before.handle.y + CONFIG.resize.deltaY * progress,
    );
    await delay(CONFIG.resize.stepDelay);
  }

  await delay(CONFIG.resize.holdDelay);

  await page.mouse.up({
    button: "left",
  });

  await delay(CONFIG.resize.settleDelay);
  await hideDemoStep({ page });

  const after = await getInspectorPanelSize(page);

  if (!after) {
    throw new Error("Unable to read panel after resize.");
  }

  log.value(
    "After",
    `${Math.round(after.width)} × ${Math.round(after.height)}`,
  );

  const widthChange = Math.abs(before.panel.width - after.width);

  const heightChange = Math.abs(before.panel.height - after.height);

  const resized =
    widthChange > CONFIG.resize.minimumChange ||
    heightChange > CONFIG.resize.minimumChange;

  if (!resized) {
    throw new Error(
      [
        "Dock resize did not change its dimensions.",

        `Before: ${Math.round(before.panel.width)} × ${Math.round(
          before.panel.height,
        )}`,

        `After: ${Math.round(after.width)} × ${Math.round(after.height)}`,
      ].join(" "),
    );
  }

  log.success("Floating dock resize works.");

  await screenshots.capture(page, "dock-after-resize");
}

// ============================================================================
// CodePen
// ============================================================================

async function getCodePenControl(page) {
  return page.evaluate(
    ({ hostId, candidates }) => {
      const root = document.getElementById(hostId)?.shadowRoot;

      if (!root) {
        return null;
      }

      let control = null;

      for (const selector of candidates) {
        control = root.querySelector(selector);

        if (control) {
          break;
        }
      }

      if (!control) {
        const elements = [
          ...root.querySelectorAll('button, a, [role="button"]'),
        ];

        control =
          elements.find((element) =>
            element.textContent?.toLowerCase().includes("codepen"),
          ) ?? null;
      }

      if (!control) {
        return null;
      }

      const rect = control.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      return {
        x: rect.left + rect.width / 2,

        y: rect.top + rect.height / 2,

        text: control.textContent?.replace(/\s+/g, " ").trim() ?? "",

        href: control instanceof HTMLAnchorElement ? control.href : null,
      };
    },
    {
      hostId: UI.inspector.hostId,

      candidates: UI.inspector.selector.codePenCandidates,
    },
  );
}

async function openInCodePen({ browser, page, screenshots }) {
  log.heading("CodePen Test");

  log.step("Finding Open in CodePen control...");

  const control = await getCodePenControl(page);

  if (!control) {
    throw new Error("Open in CodePen control was not found.");
  }

  log.success("Open in CodePen control found");

  if (control.text) {
    log.value("Control", control.text);
  }

  if (control.href) {
    log.value("Target", control.href);
  }

  await page.mouse.move(control.x, control.y, { steps: 20 });
  await showDemoStep({
    page,
    step: DEMO_STEPS.OPEN_CODEPEN,
    anchor: control,
  });

  await screenshots.capture(page, "preview-before-codepen");

  const existingTargets = new Set(browser.targets());

  const newPagePromise = browser
    .waitForTarget(
      (target) => target.type() === "page" && !existingTargets.has(target),
      {
        timeout: CONFIG.timeout.codePen,
      },
    )
    .catch(() => null);

  const navigationPromise = page
    .waitForNavigation({
      waitUntil: "domcontentloaded",

      timeout: CONFIG.timeout.codePen,
    })
    .catch(() => null);

  await page.mouse.click(control.x, control.y);

  const newTarget = await newPagePromise;

  if (newTarget) {
    const codePenPage = await newTarget.asPage();

    if (!codePenPage) {
      throw new Error(
        "CodePen target opened but could not be accessed as a page.",
      );
    }

    await codePenPage.bringToFront();

    await delay(CONFIG.delay.externalPage);

    log.success("CodePen opened in a new tab");

    log.value("CodePen URL", codePenPage.url());

    await screenshots.capture(codePenPage, "codepen");

    return codePenPage;
  }

  const navigation = await navigationPromise;

  if (navigation) {
    await delay(CONFIG.delay.externalPage);

    log.success("CodePen opened in the current tab");

    log.value("CodePen URL", page.url());

    await screenshots.capture(page, "codepen");

    return page;
  }

  throw new Error(
    "Open in CodePen was clicked, but no new page or navigation was detected.",
  );
}

// ============================================================================
// Programmatic inspection
// ============================================================================

async function inspectSelector(page, selector) {
  await page.evaluate((selector) => {
    window.postMessage(
      {
        type: "__MOYA_INSPECTOR_INSPECT_SELECTOR__",

        source: "programmatic",

        selector,

        openDock: true,
      },
      "*",
    );
  }, selector);

  await delay(CONFIG.delay.selection);

  await waitForInspectorHost(page);
}

async function waitForVisibleSelector(page, selector) {
  await page.waitForFunction(
    (selector) =>
      Array.from(document.querySelectorAll(selector)).some((element) => {
        const rect = element.getBoundingClientRect();

        const style = getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      }),
    {
      timeout: CONFIG.timeout.inspector,
    },
    selector,
  );
}

// ============================================================================
// Demo recording
// ============================================================================

async function startDemoRecorder(page) {
  if (!demoMode) {
    return null;
  }

  await fs.mkdir(path.dirname(CONFIG.artifact.demoVideo), {
    recursive: true,
  });

  return page.screencast({
    path: CONFIG.artifact.demoVideo,

    fps: 30,
  });
}

async function stopDemoRecorder(recorder) {
  if (!recorder) {
    return;
  }

  await recorder.stop();

  log.value("Demo video", CONFIG.artifact.demoVideo);
}

// ============================================================================
// Reporting
// ============================================================================

async function printFinalState(page) {
  const inspector = await getInspectorSnapshot(page);

  log.heading("Final Inspector State");

  if (!inspector) {
    return;
  }

  log.value("Dock", inspector.dock);

  log.value("Size", `${inspector.panelWidth} × ${inspector.panelHeight}`);

  log.value("Selector", inspector.selector);

  log.value("Active tab", inspector.activeTab);
}

function printScreenshotSummary(screenshots) {
  log.heading("Screenshots");

  for (const screenshotPath of screenshots.paths) {
    console.log(chalk.gray("•"), screenshotPath);
  }
}

function printSuccess(screenshots) {
  console.log();

  log.divider();

  log.success("Element Inspector smoke test passed");

  log.divider();

  console.log();

  log.value("Screenshots captured", screenshots.count);
}

function printFailure(error, screenshots) {
  console.log();

  log.error("Element Inspector test failed");

  printError(error);

  console.log();

  log.value("Screenshots captured before failure", screenshots.count);

  log.value("Screenshot directory", CONFIG.artifact.screenshots);
}

// ============================================================================
// Browser lifecycle
// ============================================================================

function createBrowserLifecycle(browser) {
  let disconnected = false;
  let shuttingDown = false;

  let resolveClosed;

  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  browser.on("disconnected", () => {
    disconnected = true;
    resolveClosed();
  });

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    const label = SignalLabel[signal] ?? signal;

    console.log();

    log.warning(`${label} received.`);

    if (disconnected) {
      log.info("Chrome is already closed.");

      return;
    }

    log.step("Closing Chrome...");

    try {
      await browser.close();

      log.success("Chrome closed.");
    } catch (error) {
      log.error("Failed to close Chrome cleanly.");

      printError(error);
    }
  }

  function registerSignals() {
    for (const signal of Object.values(ProcessSignal)) {
      process.once(signal, () => {
        void shutdown(signal);
      });
    }
  }

  return {
    closed,
    shutdown,
    registerSignals,

    get disconnected() {
      return disconnected;
    },

    get shuttingDown() {
      return shuttingDown;
    },
  };
}

// ============================================================================
// Smoke test
// ============================================================================

const scenarioDependencies = {
  CONFIG,
  DEMO_STEPS,
  InspectorTab,
  UI,
  activateInspector,
  assertInspector,
  delay,
  getInspectorSnapshot,
  getViewport,
  hideDemoStep,
  inspectSelector,
  installDemoCursorOverlay,
  log,
  moveDemoMouseTo,
  openExtensionPopup,
  openInCodePen,
  openInspectorTab,
  openPage,
  printInspectorSnapshot,
  printTabResults,
  runInspectorWorkflow,
  showDemoStep,
  testFloatingDockResize,
  waitForInspectorHost,
  waitForPicker,
  waitForVisibleSelector,
};

const runExampleInspectionScenario =
  createExampleInspectionScenario(scenarioDependencies);
const runGoogleJavaScriptScenario =
  createGoogleJavaScriptScenario(scenarioDependencies);
const runCssomRulesScenario = createCssomRulesScenario(scenarioDependencies);

async function runSmokeTest({ browser, screenshots, runtime }) {
  const { extensionId, extension } = await installExtension(browser);

  const page = await browser.newPage();

  runtime.page = page;

  runtime.demoRecorder = await startDemoRecorder(page);

  await runExampleInspectionScenario({
    browser,
    page,
    extension,
    extensionId,
    screenshots,
  });

  if (!demoMode) {
    await runCssomRulesScenario({ page, screenshots });
    await runGoogleJavaScriptScenario({
      page,
      screenshots,
    });
  }

  await printFinalState(page);

  printScreenshotSummary(screenshots);

  printSuccess(screenshots);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const screenshots = createScreenshotManager();

  await screenshots.prepare();

  const browser = await launchBrowser();

  const lifecycle = createBrowserLifecycle(browser);

  lifecycle.registerSignals();

  const runtime = {
    page: null,
    demoRecorder: null,
  };

  let testFailed = false;

  try {
    await runSmokeTest({
      browser,
      screenshots,
      runtime,
    });

    if (runtime.demoRecorder) {
      await stopDemoRecorder(runtime.demoRecorder);

      runtime.demoRecorder = null;
    }

    if (closeWhenFinished) {
      await browser.close();
    } else {
      log.info("Chrome will remain open.");

      log.info("Close Chrome or press Ctrl+C when you are finished.");
    }
  } catch (error) {
    testFailed = true;

    printFailure(error, screenshots);

    if (runtime.demoRecorder) {
      await runtime.demoRecorder.stop().catch(() => {});

      runtime.demoRecorder = null;
    }

    if (closeWhenFinished) {
      await browser.close();
    }

    /*
     * In normal mode Chrome remains open
     * after failure for manual debugging.
     */
  }

  await lifecycle.closed;

  console.log();

  if (!lifecycle.shuttingDown) {
    log.info("Chrome closed.");
  }

  process.exitCode = closeWhenFinished && testFailed ? 1 : 0;
}

await main();
