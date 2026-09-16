import { createServer } from "node:http";

const fixture = `<!doctype html>
<style>
  @layer components {
    @supports (display: grid) {
      @media all {
        .target { border-top: 11px solid red; }
      }
    }
  }

  @scope (.scope) {
    .target { border-right: 12px solid red; }
  }

  @scope (.unrelated-scope) {
    .target { border-left: 91px solid red; }
  }

  @container card (width > 500px) {
    .target { border-bottom: 13px solid red; }
  }

  @container unrelated (width > 1px) {
    .target { margin-bottom: 92px; }
  }

  .component {
    display: grid;
    @media all { gap: 14px; }
    & > .target { padding-top: 15px; }
  }

  .target:hover { outline: 16px solid red; }
  .target::before { content: "pseudo"; width: 17px; }
  .target { letter-spacing: 18px; }
  .target { letter-spacing: 19px; }
</style>
<main class="component container scope" style="container: card / inline-size; width: 600px">
  <span class="target">CSSOM target</span>
</main>`;

export default function createCssomRulesScenario(dependencies) {
  const { UI, inspectSelector, log, openInspectorTab, openPage } = dependencies;

  return async function runCssomRulesScenario({ page, screenshots }) {
    log.heading("CSSOM at-rule workflow");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fixture);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("CSSOM fixture server did not expose a port.");
      }

      await openPage(page, `http://127.0.0.1:${address.port}/`);
      await inspectSelector(page, ".component");
      await openInspectorTab({ page, tabName: "css", screenshots });

      const cssText = await page.evaluate(({ hostId, activePanel }) => {
        const root = document.getElementById(hostId)?.shadowRoot;
        return root?.querySelector(activePanel)?.textContent ?? "";
      }, {
        hostId: UI.inspector.hostId,
        activePanel: UI.inspector.selector.activePanel,
      });

      const expected = [
        "border-top: 11px solid red",
        "border-right: 12px solid red",
        "border-bottom: 13px solid red",
        "gap: 14px",
        "padding-top: 15px",
        "16px",
        'content: "pseudo"',
      ];

      for (const token of expected) {
        if (!cssText.includes(token)) {
          throw new Error(`CSSOM rule was not discovered: ${token}`);
        }
      }

      for (const token of [
        "border-left: 91px solid red",
        "margin-bottom: 92px",
      ]) {
        if (cssText.includes(token)) {
          throw new Error(`Unrelated CSSOM rule was discovered: ${token}`);
        }
      }

      if (
        cssText.indexOf("letter-spacing: 18px") >
        cssText.indexOf("letter-spacing: 19px")
      ) {
        throw new Error("CSS rules were not retained in source order.");
      }

      log.success("Nested, scoped, container, and state CSS rules passed");
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  };
}
