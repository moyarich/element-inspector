export type DiscoveredListener = {
  target: string;
  type: string;
  handler: string;
  capture: boolean;
  passive: boolean;
  once: boolean;
  registrationStack?: string;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  originalSource?: string;
  originalLineNumber?: number;
  originalColumnNumber?: number;
  originalName?: string;
};

export type ListenerDiscovery = {
  source: "native" | "tracker" | "unavailable";
  listeners: DiscoveredListener[];
};

/**
 * Builds a self-contained expression for the inspected page context, where
 * DevTools-only helpers such as getEventListeners() are available. Native
 * records are enriched with registration stacks captured at document_start.
 */
export function buildNativeListenerExpression({
  selector,
}: {
  selector: string;
}): string {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const element = document.querySelector(selector);
    if (!element) return { source: "unavailable", listeners: [] };
    const describe = (target) => target === element
      ? "selected element"
      : target === document ? "document"
      : target === window ? "window"
      : target.tagName ? target.tagName.toLowerCase() + (target.id ? "#" + target.id : "")
      : "ancestor";
    const serialize = (target, type, listener) => ({
      target: describe(target),
      type,
      handler: String(listener.listener || listener.handler || listener),
      capture: Boolean(listener.useCapture || listener.capture),
      passive: Boolean(listener.passive),
      once: Boolean(listener.once),
      source: listener.sourceName || listener.url || listener.location?.url,
      lineNumber: listener.lineNumber ?? listener.location?.lineNumber,
      columnNumber: listener.columnNumber ?? listener.location?.columnNumber,
    });
    const tracker = window.__MOYA_EVENT_LISTENER_TRACKER__;
    const trackedListeners = tracker && typeof tracker.get === "function"
      ? tracker.get(element)
      : [];
    if (typeof getEventListeners === "function") {
      const listeners = [];
      const targets = [element, ...Array.from((function* () {
        let current = element.parentElement;
        while (current) { yield current; current = current.parentElement; }
      })()), document, window];
      for (const target of targets) {
        const byType = getEventListeners(target);
        for (const [type, entries] of Object.entries(byType)) {
          for (const entry of entries) listeners.push(serialize(target, type, entry));
        }
      }
      const unusedTrackedListeners = Array.isArray(trackedListeners)
        ? [...trackedListeners]
        : [];
      const mergedListeners = listeners.map((listener) => {
        if (listener.source) return listener;
        const matchIndex = unusedTrackedListeners.findIndex((tracked) =>
          tracked &&
          tracked.type === listener.type &&
          tracked.handler === listener.handler &&
          Boolean(tracked.capture) === listener.capture
        );
        if (matchIndex === -1) return listener;
        const tracked = unusedTrackedListeners.splice(matchIndex, 1)[0];
        return {
          ...listener,
          registrationStack: tracked.registrationStack,
          source: tracked.source,
          lineNumber: tracked.lineNumber,
          columnNumber: tracked.columnNumber,
        };
      });
      return { source: "native", listeners: mergedListeners };
    }
    return Array.isArray(trackedListeners)
      ? { source: "tracker", listeners: trackedListeners }
      : { source: "unavailable", listeners: [] };
  })()`;
}

export function renderListenerDiscovery({
  discovery,
}: {
  discovery: ListenerDiscovery;
}): string {
  if (!discovery.listeners.length) {
    const message = discovery.source === "unavailable"
      ? "Native listener retrieval is unavailable in this browser."
      : "No registered listeners found on the selected element or its ancestors.";
    return `<div class="listener-empty">${escapeHtml(message)}</div>`;
  }

  const broadFrameworkKeys = getBroadFrameworkListenerKeys({
    listeners: discovery.listeners,
  });
  const listeners = discovery.listeners.filter(
    (listener) => !broadFrameworkKeys.has(getFrameworkListenerKey(listener)),
  );

  if (!listeners.length) {
    return `<div class="listener-empty">No element-specific listeners found. Framework-wide root listeners were ignored.</div>`;
  }

  const direct = listeners.filter(
    ({ target }) => target === "selected element",
  );
  const delegated = listeners.filter(
    ({ target }) => target !== "selected element",
  );

  return `
    <div class="listener-summary">
      <span class="listener-source-badge">${escapeHtml(discovery.source)}</span>
      <span>${listeners.length} relevant registrations found</span>
    </div>
    ${renderListenerSection({ title: "Direct listeners", listeners: direct })}
    ${renderListenerSection({
      title: "Delegated ancestor listeners",
      listeners: delegated,
    })}
  `;
}

function getFrameworkListenerKey(listener: DiscoveredListener): string {
  return [listener.target, listener.handler, listener.capture].join("\u0000");
}

/**
 * Identifies framework-wide delegation by looking for one generated ancestor
 * handler registered for many event types. These registrations describe the
 * framework event system, not behavior owned by the selected element.
 */
function getBroadFrameworkListenerKeys({
  listeners,
}: {
  listeners: DiscoveredListener[];
}): Set<string> {
  const eventTypesByKey = new Map<string, Set<string>>();

  for (const listener of listeners) {
    if (
      listener.target === "selected element" ||
      !looksFrameworkGenerated(listener.handler)
    ) {
      continue;
    }

    const key = getFrameworkListenerKey(listener);
    const eventTypes = eventTypesByKey.get(key) ?? new Set<string>();
    eventTypes.add(listener.type);
    eventTypesByKey.set(key, eventTypes);
  }

  return new Set(
    Array.from(eventTypesByKey)
      .filter(([, eventTypes]) => eventTypes.size >= 12)
      .map(([key]) => key),
  );
}

function renderListenerSection({
  title,
  listeners,
}: {
  title: string;
  listeners: DiscoveredListener[];
}): string {
  if (!listeners.length) return "";

  const groups = new Map<string, DiscoveredListener[]>();
  for (const listener of listeners) {
    const key = [
      listener.target,
      listener.handler,
      listener.capture,
      listener.passive,
      listener.once,
      getListenerLocation(listener),
    ].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), listener]);
  }

  const entries = [...groups.values()].map((group) => {
    const listener = group[0];
    const eventTypes = [...new Set(group.map(({ type }) => type))].sort();
    const location = getListenerLocation(listener);
    const originalLocation = getOriginalListenerLocation(listener);
    const flags = [
      listener.capture ? "capture" : "bubble",
      listener.passive ? "passive" : "active",
      ...(listener.once ? ["once"] : []),
    ];
    const repeated = group.length > eventTypes.length
      ? `${group.length} registrations`
      : "";
    const frameworkGenerated = looksFrameworkGenerated(listener.handler);
    return `
      <article class="listener-item">
        <div class="listener-item-header">
          <div class="listener-events">
            ${eventTypes.map((type) => `<span class="listener-event-badge">${escapeHtml(type)}</span>`).join("")}
          </div>
          <span class="listener-target">${escapeHtml(listener.target)}</span>
        </div>
        <div class="listener-flags">
          ${flags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join("")}
          ${repeated ? `<span>${escapeHtml(repeated)}</span>` : ""}
          ${frameworkGenerated ? '<span class="listener-framework-badge">framework wrapper</span>' : ""}
        </div>
        <div class="listener-locations">
          ${originalLocation ? `<div><strong>Original</strong><code>${escapeHtml(originalLocation)}</code></div>` : ""}
          <div><strong>${originalLocation ? "Generated" : "Source"}</strong><code>${escapeHtml(location || "Browser did not expose a source location")}</code></div>
        </div>
        <pre class="listener-code"><code>${escapeHtml(listener.handler)}</code></pre>
      </article>
    `;
  });

  return `
    <section class="listener-section">
      <div class="listener-section-heading">
        <h3>${escapeHtml(title)}</h3>
        <span>${listeners.length}</span>
      </div>
      <div class="listener-list">${entries.join("")}</div>
    </section>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getOriginalListenerLocation(listener: DiscoveredListener): string {
  if (!listener.originalSource || isInlineDataUrl(listener.originalSource)) {
    return "";
  }
  const line = typeof listener.originalLineNumber === "number"
    ? `:${listener.originalLineNumber}`
    : "";
  const column = typeof listener.originalColumnNumber === "number"
    ? `:${listener.originalColumnNumber + 1}`
    : "";
  const name = listener.originalName ? ` (${listener.originalName})` : "";
  return `${listener.originalSource}${line}${column}${name}`;
}

function getListenerLocation(listener: DiscoveredListener): string {
  if (listener.source) {
    if (isInlineDataUrl(listener.source)) {
      return "Inline generated script";
    }

    const line = typeof listener.lineNumber === "number"
      ? `:${listener.lineNumber + 1}`
      : "";
    const column = typeof listener.columnNumber === "number"
      ? `:${listener.columnNumber + 1}`
      : "";
    return `${listener.source}${line}${column}`;
  }

  const stackLine = listener.registrationStack
    ?.split("\n")
    .map((line) => line.trim())
    .find(
      (line) =>
        /(?:https?|file|webpack|blob):/.test(line) &&
        !line.includes("listener-tracker"),
    );
  return stackLine?.replace(/^at\s+/, "") ?? "";
}

function isInlineDataUrl(value: string): boolean {
  return value.trimStart().toLowerCase().startsWith("data:");
}

function looksFrameworkGenerated(handler: string): boolean {
  const compact = handler.replace(/\s+/g, " ").trim();
  return (
    compact.length < 90 ||
    /^(?:function\s*\([a-z]\)|[a-z]=>)/.test(compact)
  );
}
