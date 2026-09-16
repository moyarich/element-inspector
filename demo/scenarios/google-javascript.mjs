export default function createGoogleJavaScriptScenario(dependencies) {
  const {
    CONFIG,
    InspectorTab,
    inspectSelector,
    log,
    openInspectorTab,
    openPage,
    waitForVisibleSelector,
  } = dependencies;

  return async function runGoogleJavaScriptScenario({ page, screenshots }) {
    log.heading("Google Workflow");
    await openPage(page, CONFIG.test.google.url);
    await screenshots.capture(page, "google-page-loaded");

    for (const target of CONFIG.test.google.targets) {
      log.step(`Inspecting Google ${target.name}...`);
      await waitForVisibleSelector(page, target.selector);
      await inspectSelector(page, target.selector);
      const result = await openInspectorTab({
        page,
        tabName: InspectorTab.JS,
        screenshots,
      });
      if (!result.active) {
        throw new Error(`JavaScript tab did not activate for ${target.name}.`);
      }
    }

    log.success("Google inspector workflow passed");
  };
}
