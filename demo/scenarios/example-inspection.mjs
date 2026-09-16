export default function createExampleInspectionScenario(dependencies) {
  const {
    CONFIG,
    DEMO_STEPS,
    activateInspector,
    assertInspector,
    delay,
    getInspectorSnapshot,
    getViewport,
    hideDemoStep,
    installDemoCursorOverlay,
    log,
    moveDemoMouseTo,
    openExtensionPopup,
    openInCodePen,
    openPage,
    printInspectorSnapshot,
    printTabResults,
    runInspectorWorkflow,
    showDemoStep,
    testFloatingDockResize,
    waitForInspectorHost,
    waitForPicker,
  } = dependencies;

  return async function runExampleInspectionScenario({
    browser,
    page,
    extension,
    extensionId,
    screenshots,
  }) {
    log.heading("Workflow");
    log.step("Opening test page...");
    await openPage(page, CONFIG.test.example.url);
    await installDemoCursorOverlay({ page });
    await showDemoStep({ page, step: DEMO_STEPS.INTRO });
    log.success("Page loaded");

    const viewport = await getViewport(page);
    log.value("Viewport", `${viewport.width} × ${viewport.height}`);
    log.value("Device Pixel Ratio", viewport.devicePixelRatio);
    await screenshots.capture(page, "page-loaded");

    const popup = await openExtensionPopup({
      browser,
      page,
      extension,
      extensionId,
    });
    await screenshots.capture(popup, "extension-popup");
    await showDemoStep({ page, step: DEMO_STEPS.ACTIVATE_PICKER });
    await activateInspector(popup);
    await page.bringToFront();
    await waitForPicker(page);
    await screenshots.capture(page, "picker-active");

    const targetSelector = CONFIG.test.example.elementSelector;
    log.step(`Hovering ${targetSelector}...`);
    await moveDemoMouseTo(page, targetSelector);
    const targetPoint = await page.evaluate((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : null;
    }, targetSelector);
    if (!targetPoint) {
      throw new Error(`Demo target not found: ${targetSelector}`);
    }

    await showDemoStep({
      page,
      step: DEMO_STEPS.HOVER_TARGET,
      anchor: targetPoint,
    });
    await delay(CONFIG.delay.hover);
    log.success(`${targetSelector} highlighted`);
    await screenshots.capture(page, "target-hover");

    log.step(`Selecting ${targetSelector}...`);
    await showDemoStep({
      page,
      step: DEMO_STEPS.SELECT_TARGET,
      anchor: targetPoint,
    });
    await page.mouse.down();
    await page.mouse.up();
    await delay(CONFIG.delay.selection);
    log.success(`${targetSelector} selected`);
    await waitForInspectorHost(page);
    await screenshots.capture(page, "element-selection-caption");
    await hideDemoStep({ page });
    await screenshots.capture(page, "element-selected-inspector-open");

    const inspector = await getInspectorSnapshot(page);
    log.heading("Inspector Results");
    printInspectorSnapshot(inspector);
    assertInspector(inspector);
    await testFloatingDockResize({ page, screenshots });

    const tabResults = await runInspectorWorkflow({ page, screenshots });
    printTabResults(tabResults);
    const codePenPage = await openInCodePen({ browser, page, screenshots });
    if (codePenPage !== page) await codePenPage.close();
  };
}
