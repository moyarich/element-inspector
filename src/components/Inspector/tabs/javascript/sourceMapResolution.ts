import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import extensionApi from "webextension-polyfill";

import type {
  DiscoveredListener,
  ListenerDiscovery,
} from "./nativeListenerRetrieval";

const FETCH_RESOURCE_MESSAGE = "ELEMENT_INSPECTOR_FETCH_RESOURCE";
const SOURCE_MAP_URL_PATTERN = /[#@]\s*sourceMappingURL\s*=\s*([^\s*]+)/g;

type FetchResourceResponse =
  | { ok: true; body: string; finalUrl?: string }
  | { ok: false; error: string };

type GeneratedLocation = {
  source: string;
  line: number;
  column: number;
};

const resourceCache = new Map<string, Promise<FetchResourceResponse>>();
const traceMapCache = new Map<string, Promise<TraceMap | null>>();

/**
 * Converts generated listener locations to authored source locations when the
 * generated script exposes an accessible source map. Generated coordinates
 * remain available when fetching or tracing fails.
 */
export async function resolveListenerSourceMaps({
  discovery,
}: {
  discovery: ListenerDiscovery;
}): Promise<ListenerDiscovery> {
  const listeners = await Promise.all(
    discovery.listeners.map(async (listener) => {
      const generated = getGeneratedLocation(listener);
      if (!generated) return listener;

      const map = await getTraceMap({ scriptUrl: generated.source });
      if (!map) return withGeneratedLocation({ listener, generated });

      const original = originalPositionFor(map, {
        line: generated.line,
        column: generated.column,
      });
      if (
        !original.source ||
        original.source.startsWith("data:") ||
        original.line === null ||
        original.column === null
      ) {
        return withGeneratedLocation({ listener, generated });
      }

      return {
        ...withGeneratedLocation({ listener, generated }),
        originalSource: original.source,
        originalLineNumber: original.line,
        originalColumnNumber: original.column,
        originalName: original.name ?? undefined,
      };
    }),
  );

  return { ...discovery, listeners };
}

function withGeneratedLocation({
  listener,
  generated,
}: {
  listener: DiscoveredListener;
  generated: GeneratedLocation;
}): DiscoveredListener {
  return {
    ...listener,
    source: generated.source,
    lineNumber: generated.line - 1,
    columnNumber: generated.column,
  };
}

function getGeneratedLocation(
  listener: DiscoveredListener,
): GeneratedLocation | null {
  if (
    listener.source &&
    typeof listener.lineNumber === "number" &&
    typeof listener.columnNumber === "number"
  ) {
    return {
      source: listener.source,
      line: listener.lineNumber + 1,
      column: listener.columnNumber,
    };
  }

  for (const line of listener.registrationStack?.split("\n") ?? []) {
    if (line.includes("listener-tracker")) continue;
    const match = line.match(/((?:https?|file|blob):\/\/[^\s)]+):(\d+):(\d+)/);
    if (!match) continue;
    return {
      source: match[1],
      line: Number(match[2]),
      column: Math.max(0, Number(match[3]) - 1),
    };
  }

  return null;
}

async function getTraceMap({
  scriptUrl,
}: {
  scriptUrl: string;
}): Promise<TraceMap | null> {
  const cached = traceMapCache.get(scriptUrl);
  if (cached) return cached;

  const request = (async () => {
    const script = await fetchResource({ url: scriptUrl });
    if (!script.ok) return null;

    const sourceMapReference = getSourceMapReference(script.body);
    if (!sourceMapReference) return null;

    const mapUrl = resolveSourceMapUrl({
      sourceMapReference,
      scriptUrl: script.finalUrl ?? scriptUrl,
    });
    if (!mapUrl) return null;

    const sourceMap = await fetchResource({ url: mapUrl });
    if (!sourceMap.ok) return null;

    try {
      return new TraceMap(sourceMap.body, sourceMap.finalUrl ?? mapUrl);
    } catch {
      return null;
    }
  })();

  traceMapCache.set(scriptUrl, request);
  return request;
}

function getSourceMapReference(source: string): string | null {
  let reference: string | null = null;
  for (const match of source.matchAll(SOURCE_MAP_URL_PATTERN)) {
    reference = match[1] ?? reference;
  }
  return reference;
}

function resolveSourceMapUrl({
  sourceMapReference,
  scriptUrl,
}: {
  sourceMapReference: string;
  scriptUrl: string;
}): string | null {
  if (sourceMapReference.startsWith("data:")) return sourceMapReference;
  try {
    return new URL(sourceMapReference, scriptUrl).href;
  } catch {
    return null;
  }
}

async function fetchResource({
  url,
}: {
  url: string;
}): Promise<FetchResourceResponse> {
  const cached = resourceCache.get(url);
  if (cached) return cached;

  const request = (
    extensionApi.runtime.sendMessage({
      type: FETCH_RESOURCE_MESSAGE,
      url,
    }) as Promise<unknown>
  )
    .then((response): FetchResourceResponse => {
      if (
        response &&
        typeof response === "object" &&
        "ok" in response &&
        typeof (response as { ok?: unknown }).ok === "boolean"
      ) {
        return response as FetchResourceResponse;
      }
      return { ok: false, error: "Invalid resource response." };
    })
    .catch((error: unknown): FetchResourceResponse => ({
      ok: false,
      error: error instanceof Error ? error.message : "Resource fetch failed.",
    }));

  resourceCache.set(url, request);
  return request;
}
