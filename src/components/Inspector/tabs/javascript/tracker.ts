declare global {
  interface Window {
    __MOYA_EVENT_LISTENER_TRACKER__?: {
      get: (element: Element) => unknown[];
    };
  }
}

(() => {
  if (window.__MOYA_EVENT_LISTENER_TRACKER__) return;

  const listeners = new WeakMap<EventTarget, Array<{
    type: string;
    handler: EventListenerOrEventListenerObject;
    capture: boolean;
    passive: boolean;
    once: boolean;
    registrationStack: string;
  }>>();
  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const nativeRemoveEventListener = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (
    type: string,
    handler: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (handler) {
      const entries = listeners.get(this) ?? [];
      entries.push({
        type,
        handler,
        capture: typeof options === "boolean" ? options : Boolean(options?.capture),
        passive: typeof options === "object" && Boolean(options.passive),
        once: typeof options === "object" && Boolean(options.once),
        registrationStack: new Error("Listener registered").stack ?? "",
      });
      listeners.set(this, entries);
    }
    nativeAddEventListener.call(this, type, handler, options);
  };

  EventTarget.prototype.removeEventListener = function (
    type: string,
    handler: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (handler) {
      const capture =
        typeof options === "boolean" ? options : Boolean(options?.capture);
      const entries = listeners.get(this);

      if (entries) {
        listeners.set(
          this,
          entries.filter(
            (entry) =>
              entry.type !== type ||
              entry.handler !== handler ||
              entry.capture !== capture,
          ),
        );
      }
    }
    nativeRemoveEventListener.call(this, type, handler, options);
  };

  window.__MOYA_EVENT_LISTENER_TRACKER__ = {
    get(element: Element) {
      const targets: EventTarget[] = [];
      let current: Element | null = element;
      while (current) { targets.push(current); current = current.parentElement; }
      targets.push(document, window);

      return targets.flatMap((target) => (listeners.get(target) ?? []).map((listener) => ({
        target: target === element ? "selected element" : target === document ? "document" : target === window ? "window" : "ancestor",
        type: listener.type,
        handler: typeof listener.handler === "function" ? String(listener.handler) : String(listener.handler.handleEvent),
        capture: listener.capture,
        passive: listener.passive,
        once: listener.once,
        registrationStack: listener.registrationStack,
      })));
    },
  };
})();

export {};
