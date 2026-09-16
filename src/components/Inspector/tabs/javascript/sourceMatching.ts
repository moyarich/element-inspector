import extensionApi from "webextension-polyfill";

import { getSelectorPath } from "../../../../utils/selectors";

const FETCH_RESOURCE_MESSAGE = "ELEMENT_INSPECTOR_FETCH_RESOURCE";
const SCRIPT_FETCH_CONCURRENCY = 6;

const MAX_ANCESTOR_DEPTH = 8;
const MAX_DESCENDANT_CANDIDATES = 16;
const MAX_SEARCH_EVIDENCE = 32;
const MAX_OCCURRENCES_PER_PATTERN = 8;
const MAX_REGIONS_PER_SCRIPT = 12;
const MAX_SCRIPT_RESULTS = 5;

const GENERIC_CONTEXT_RADIUS = 1_500;
const MAX_REGION_LENGTH = 80_000;

const MIN_MULTI_EVIDENCE_SCORE = 13;
const HIGH_CONFIDENCE_SCORE = 16;
const STRONG_PATTERN_WEIGHT = 10;

const COMPONENT_TRAVERSAL_BONUS = 8;
const MAX_COMPONENT_TRAVERSAL_DEPTH = 2;
const MAX_COMPONENT_REFS_PER_MODULE = 32;

type FetchResourceResponse =
  | {
      ok: true;
      body: string;
      contentType?: string;
      finalUrl?: string;
    }
  | {
      ok: false;
      error: string;
    };

type ScriptBlock = {
  type: string;
  src: string | null;
  content: string;
  label?: string;
  fetchError?: string;
};

type EvidenceScope = "target" | "ancestor" | "descendant";

type EvidenceKind =
  | "dom-property"
  | "dom-selector"
  | "dom-api"
  | "html-attribute"
  | "framework-prop";

type SearchPattern = {
  text: string;
  label: string;
  kind: EvidenceKind;
  weight: number;
  strong: boolean;
};

type SearchEvidence = {
  key: string;
  label: string;
  value: string;
  scope: EvidenceScope;
  attributeName: string;
  patterns: SearchPattern[];
};

type EvidenceHit = {
  evidence: SearchEvidence;
  pattern: SearchPattern;
  index: number;
};

type MatchedEvidence = {
  evidence: SearchEvidence;
  pattern: SearchPattern;
};

type TextBounds = {
  start: number;
  end: number;
};

type AssociationRelationship =
  | "direct-dom-match"
  | "probable-render-owner"
  | "ancestor-render-owner"
  | "descendant-render-owner"
  | "associated-module";

type ScriptRegionCandidate = {
  block: ScriptBlock;
  start: number;
  end: number;
  content: string;
  moduleName: string | null;
  matchedEvidence: MatchedEvidence[];
  score: number;
  confidence: "HIGH" | "MEDIUM";
  relationship: AssociationRelationship;
  parentModuleName?: string;
  traversalDepth?: number;
};

type ModuleDefinition = {
  name: string;
  block: ScriptBlock;
  start: number;
  end: number;
  content: string;
};

type RenderedModuleReference = {
  name: string;
  index: number;
};

const resourceCache = new Map<string, Promise<FetchResourceResponse>>();

async function fetchResource(url: string): Promise<FetchResourceResponse> {
  const cached = resourceCache.get(url);

  if (cached) {
    return cached;
  }

  const request = (
    extensionApi.runtime.sendMessage({
      type: FETCH_RESOURCE_MESSAGE,
      url,
    }) as Promise<unknown>
  )
    .then((response: unknown): FetchResourceResponse => {
      if (
        response &&
        typeof response === "object" &&
        "ok" in response &&
        typeof (response as { ok?: unknown }).ok === "boolean"
      ) {
        return response as FetchResourceResponse;
      }

      return {
        ok: false,
        error: "Background returned an invalid resource response.",
      };
    })
    .catch(
      (error: unknown): FetchResourceResponse => ({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not fetch JavaScript resource.",
      }),
    );

  resourceCache.set(url, request);
  return request;
}

function isJavascriptScriptType(script: HTMLScriptElement): boolean {
  const rawType = script.getAttribute("type")?.trim().toLowerCase() ?? "";

  if (!rawType || rawType === "module") {
    return true;
  }

  const mimeType = rawType.split(";", 1)[0]?.trim() ?? "";

  return (
    mimeType === "text/javascript" ||
    mimeType === "application/javascript" ||
    mimeType === "text/ecmascript" ||
    mimeType === "application/ecmascript" ||
    mimeType === "application/x-javascript"
  );
}

async function readScriptBlock(
  script: HTMLScriptElement,
): Promise<ScriptBlock | null> {
  if (!isJavascriptScriptType(script)) {
    return null;
  }

  const type = script.type || "text/javascript";

  if (script.src) {
    const result = await fetchResource(script.src);

    if (!result.ok) {
      return {
        type,
        src: script.src,
        content: `/* Could not fetch: ${script.src} -- ${result.error} */`,
        fetchError: result.error,
      };
    }

    return {
      type,
      src: result.finalUrl || script.src,
      content: result.body,
    };
  }

  const content = script.textContent || "";

  if (!content.trim()) {
    return null;
  }

  return {
    type,
    src: null,
    content,
  };
}

function getNestedScripts(targetEl: Element): HTMLScriptElement[] {
  const scripts: HTMLScriptElement[] = [];

  if (
    targetEl instanceof HTMLScriptElement &&
    isJavascriptScriptType(targetEl)
  ) {
    scripts.push(targetEl);
  }

  scripts.push(
    ...Array.from(
      targetEl.querySelectorAll<HTMLScriptElement>("script"),
    ).filter(isJavascriptScriptType),
  );

  return scripts;
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  if (!items.length) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

function getEventHandlerPropertyNames(targetEl: Element): string[] {
  const names = new Set<string>();
  let current: object | null = targetEl;
  let depth = 0;

  while (current && depth < 8) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (/^on[a-z]/i.test(name)) {
        names.add(name);
      }
    }

    current = Object.getPrototypeOf(current) as object | null;
    depth += 1;
  }

  return Array.from(names).sort();
}

function getInlineJavascriptInfo(targetEl: Element): string {
  const sections: string[] = [];
  const htmlEl = targetEl as HTMLElement & Record<string, unknown>;

  const inlineEventNames = targetEl
    .getAttributeNames()
    .filter((name) => /^on/i.test(name));

  const inlineEvents = inlineEventNames.map(
    (name) => `${name} = ${JSON.stringify(targetEl.getAttribute(name) || "")}`,
  );

  const inlineEventNameSet = new Set(
    inlineEventNames.map((name) => name.toLowerCase()),
  );

  const propHandlers = getEventHandlerPropertyNames(targetEl)
    .filter((name) => !inlineEventNameSet.has(name.toLowerCase()))
    .map((name) => {
      try {
        const value = htmlEl[name];

        return typeof value === "function"
          ? `${name} = ${String(value)}`
          : null;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value));

  if (inlineEvents.length) {
    sections.push(
      "/* Direct inline event attributes */",
      inlineEvents.join("\n"),
    );
  }

  if (propHandlers.length) {
    sections.push(
      "/* Direct DOM event handler properties */",
      propHandlers.join("\n"),
    );
  }

  return sections.join("\n\n");
}

function isLikelyGeneratedIdentifier(value: string): boolean {
  return (
    /^_R_/i.test(value) ||
    /^mount[_-]/i.test(value) ||
    /^react[-_:]/i.test(value) ||
    /^[a-f\d]{16,}$/i.test(value) ||
    /^[A-Za-z_]+_\d+_\d+_[A-Za-z0-9]+$/.test(value)
  );
}

function isUsefulValue(
  value: string | null,
  minimumLength = 3,
): value is string {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();

  return (
    trimmed.length >= minimumLength &&
    trimmed.length <= 240 &&
    !/[\r\n]/.test(trimmed)
  );
}

function quoteSingle(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function addPattern(
  patterns: SearchPattern[],
  input: Omit<SearchPattern, "strong"> & { strong?: boolean },
): void {
  if (!input.text) {
    return;
  }

  const existing = patterns.find(
    (pattern) => pattern.text === input.text && pattern.kind === input.kind,
  );

  const next: SearchPattern = {
    ...input,
    strong: input.strong ?? input.weight >= STRONG_PATTERN_WEIGHT,
  };

  if (!existing) {
    patterns.push(next);
    return;
  }

  if (next.weight > existing.weight) {
    existing.weight = next.weight;
    existing.label = next.label;
    existing.strong = next.strong;
  }
}

function buildObjectPropertyPatterns(
  property: string,
  value: string,
  weight: number,
  label: string,
): SearchPattern[] {
  const patterns: SearchPattern[] = [];
  const jsonValue = JSON.stringify(value);
  const singleValue = quoteSingle(value);
  const isIdentifier = /^[A-Za-z_$][\w$]*$/.test(property);

  if (isIdentifier) {
    addPattern(patterns, {
      text: `${property}:${jsonValue}`,
      label,
      kind: "dom-property",
      weight,
    });

    addPattern(patterns, {
      text: `${property}: ${jsonValue}`,
      label,
      kind: "dom-property",
      weight,
    });

    addPattern(patterns, {
      text: `${property}:${singleValue}`,
      label,
      kind: "dom-property",
      weight,
    });

    addPattern(patterns, {
      text: `${property}: ${singleValue}`,
      label,
      kind: "dom-property",
      weight,
    });
  }

  const quotedProperty = JSON.stringify(property);

  addPattern(patterns, {
    text: `${quotedProperty}:${jsonValue}`,
    label,
    kind: "dom-property",
    weight,
  });

  addPattern(patterns, {
    text: `${quotedProperty}: ${jsonValue}`,
    label,
    kind: "dom-property",
    weight,
  });

  return patterns;
}

function buildHtmlAttributePatterns(
  attributeName: string,
  value: string,
  weight: number,
  label: string,
): SearchPattern[] {
  return [
    {
      text: `${attributeName}="${value}"`,
      label,
      kind: "html-attribute",
      weight,
      strong: weight >= STRONG_PATTERN_WEIGHT,
    },
    {
      text: `${attributeName}='${value}'`,
      label,
      kind: "html-attribute",
      weight,
      strong: weight >= STRONG_PATTERN_WEIGHT,
    },
  ];
}

function buildAttributeSelectorPatterns(
  attributeName: string,
  value: string,
  weight: number,
  label: string,
): SearchPattern[] {
  const patterns: SearchPattern[] = [];
  const selectorDouble = `[${attributeName}="${value}"]`;
  const selectorSingle = `[${attributeName}='${value}']`;

  for (const selector of [selectorDouble, selectorSingle]) {
    const jsonSelector = JSON.stringify(selector);
    const singleSelector = quoteSingle(selector);

    for (const api of [
      "querySelector",
      "querySelectorAll",
      "matches",
      "closest",
    ]) {
      addPattern(patterns, {
        text: `${api}(${jsonSelector})`,
        label,
        kind: "dom-selector",
        weight,
      });

      addPattern(patterns, {
        text: `${api}(${singleSelector})`,
        label,
        kind: "dom-selector",
        weight,
      });
    }
  }

  return patterns;
}

function buildIdPatterns(
  value: string,
  baseWeight: number,
  label: string,
): SearchPattern[] {
  const patterns: SearchPattern[] = [];

  for (const pattern of buildObjectPropertyPatterns(
    "id",
    value,
    baseWeight,
    label,
  )) {
    addPattern(patterns, pattern);
  }

  for (const pattern of buildHtmlAttributePatterns(
    "id",
    value,
    Math.max(baseWeight - 1, 1),
    label,
  )) {
    addPattern(patterns, pattern);
  }

  const jsonValue = JSON.stringify(value);
  const singleValue = quoteSingle(value);

  addPattern(patterns, {
    text: `getElementById(${jsonValue})`,
    label,
    kind: "dom-api",
    weight: Math.max(baseWeight, 11),
  });

  addPattern(patterns, {
    text: `getElementById(${singleValue})`,
    label,
    kind: "dom-api",
    weight: Math.max(baseWeight, 11),
  });

  const selector = `#${value}`;
  const jsonSelector = JSON.stringify(selector);
  const singleSelector = quoteSingle(selector);

  for (const api of [
    "querySelector",
    "querySelectorAll",
    "matches",
    "closest",
  ]) {
    addPattern(patterns, {
      text: `${api}(${jsonSelector})`,
      label,
      kind: "dom-selector",
      weight: Math.max(baseWeight - 1, 10),
    });

    addPattern(patterns, {
      text: `${api}(${singleSelector})`,
      label,
      kind: "dom-selector",
      weight: Math.max(baseWeight - 1, 10),
    });
  }

  // Important: there is intentionally NO bare `value` and NO bare `#value`
  // pattern here. `login_form` must not match `login_form_last_resort_recovery`.

  return patterns;
}

function buildClassPatterns(
  value: string,
  baseWeight: number,
  label: string,
): SearchPattern[] {
  const patterns = [
    ...buildObjectPropertyPatterns("className", value, baseWeight, label),
    ...buildHtmlAttributePatterns(
      "class",
      value,
      Math.max(baseWeight - 1, 1),
      label,
    ),
  ];
  const selector = `.${value}`;
  const selectorLiterals = [JSON.stringify(selector), quoteSingle(selector)];

  for (const selectorLiteral of selectorLiterals) {
    addPattern(patterns, {
      text: selectorLiteral,
      label,
      kind: "dom-selector",
      weight: baseWeight,
    });

    for (const api of ["querySelector", "querySelectorAll", "matches", "closest"]) {
      addPattern(patterns, {
        text: `${api}(${selectorLiteral})`,
        label,
        kind: "dom-selector",
        weight: Math.max(baseWeight, 11),
      });
    }
  }

  for (const valueLiteral of [JSON.stringify(value), quoteSingle(value)]) {
    for (const api of ["getElementsByClassName", "contains", "toggle"]) {
      addPattern(patterns, {
        text: `${api}(${valueLiteral})`,
        label,
        kind: "dom-api",
        weight: Math.max(baseWeight, 10),
      });
    }
  }

  return patterns;
}

function getEvidenceBaseWeight(
  scope: EvidenceScope,
  attributeName: string,
  element: Element,
  value: string,
): number {
  if (attributeName === "id") {
    if (isLikelyGeneratedIdentifier(value)) {
      return scope === "target" ? 7 : 5;
    }

    if (scope === "target") {
      return 14;
    }

    if (scope === "ancestor" && element.tagName === "FORM") {
      return 14;
    }

    return scope === "ancestor" ? 11 : 9;
  }

  if (attributeName === "class") {
    return scope === "target" ? 10 : scope === "ancestor" ? 7 : 6;
  }

  if (
    attributeName === "data-testid" ||
    attributeName === "data-test" ||
    attributeName === "data-qa"
  ) {
    return scope === "target" ? 13 : scope === "ancestor" ? 11 : 10;
  }

  if (
    attributeName === "data-action" ||
    attributeName === "data-controller"
  ) {
    return scope === "target" ? 13 : scope === "ancestor" ? 11 : 9;
  }

  if (attributeName === "aria-controls") {
    return scope === "target" ? 12 : scope === "ancestor" ? 10 : 9;
  }

  if (attributeName === "data-role") {
    return scope === "target" ? 10 : scope === "ancestor" ? 9 : 8;
  }

  if (attributeName === "name") {
    return scope === "target" ? 9 : scope === "ancestor" ? 6 : 7;
  }

  if (attributeName === "aria-label") {
    return scope === "target" ? 8 : 6;
  }

  if (attributeName === "placeholder") {
    return scope === "target" ? 7 : 5;
  }

  if (attributeName === "autocomplete") {
    return scope === "target" ? 6 : 4;
  }

  return 0;
}

function buildEvidencePatterns(
  attributeName: string,
  value: string,
  baseWeight: number,
  label: string,
): SearchPattern[] {
  const patterns: SearchPattern[] = [];

  if (attributeName === "id") {
    return buildIdPatterns(value, baseWeight, label);
  }

  if (attributeName === "class") {
    return buildClassPatterns(value, baseWeight, label);
  }

  // Compilers often retain stable attribute values while removing the
  // surrounding DOM API or template syntax. Match the complete quoted value,
  // never a bare substring. IDs remain restricted to DOM-shaped patterns.
  if (attributeName !== "id") {
    for (const literal of [JSON.stringify(value), quoteSingle(value)]) {
      addPattern(patterns, {
        text: literal,
        label,
        kind: "framework-prop",
        weight: baseWeight,
      });
    }
  }

  for (const pattern of buildObjectPropertyPatterns(
    attributeName,
    value,
    baseWeight,
    label,
  )) {
    addPattern(patterns, pattern);
  }

  for (const pattern of buildHtmlAttributePatterns(
    attributeName,
    value,
    Math.max(baseWeight - 1, 1),
    label,
  )) {
    addPattern(patterns, pattern);
  }

  for (const pattern of buildAttributeSelectorPatterns(
    attributeName,
    value,
    Math.max(baseWeight - 1, 1),
    label,
  )) {
    addPattern(patterns, pattern);
  }

  if (attributeName === "name") {
    const jsonValue = JSON.stringify(value);
    const singleValue = quoteSingle(value);

    addPattern(patterns, {
      text: `getElementsByName(${jsonValue})`,
      label,
      kind: "dom-api",
      weight: baseWeight,
    });

    addPattern(patterns, {
      text: `getElementsByName(${singleValue})`,
      label,
      kind: "dom-api",
      weight: baseWeight,
    });
  }

  return patterns;
}

function addEvidence(
  evidenceByKey: Map<string, SearchEvidence>,
  input: Omit<SearchEvidence, "key">,
): void {
  const key = [
    input.scope,
    input.attributeName.toLowerCase(),
    input.value.trim().toLowerCase(),
  ].join(":");

  if (!input.value.trim() || !input.patterns.length) {
    return;
  }

  const existing = evidenceByKey.get(key);

  if (!existing) {
    evidenceByKey.set(key, {
      ...input,
      key,
    });
    return;
  }

  for (const pattern of input.patterns) {
    addPattern(existing.patterns, pattern);
  }
}

function addElementEvidence(
  evidenceByKey: Map<string, SearchEvidence>,
  element: Element,
  scope: EvidenceScope,
  depth = 0,
): void {
  const attributes = [
    "id",
    "class",
    "data-testid",
    "data-test",
    "data-qa",
    "data-role",
    "data-action",
    "data-controller",
    "aria-controls",
    "name",
    "aria-label",
    "placeholder",
    "autocomplete",
  ] as const;

  for (const attributeName of attributes) {
    const rawValue =
      attributeName === "id" ? element.id : element.getAttribute(attributeName);

    if (attributeName === "class") {
      const classNames = Array.from(element.classList)
        .filter((className) => isUsefulValue(className, 3))
        .filter((className) => !isLikelyGeneratedIdentifier(className))
        .slice(0, 6);

      for (const className of classNames) {
        const baseWeight = getEvidenceBaseWeight(
          scope,
          attributeName,
          element,
          className,
        );
        const scopeLabel =
          scope === "target"
            ? "target"
            : scope === "ancestor"
              ? `ancestor +${depth}`
              : "descendant";
        const label = `${scopeLabel} class=${JSON.stringify(className)}`;

        addEvidence(evidenceByKey, {
          label,
          value: className,
          scope,
          attributeName,
          patterns: buildClassPatterns(className, baseWeight, label),
        });
      }

      continue;
    }

    if (!isUsefulValue(rawValue, attributeName === "id" ? 2 : 3)) {
      continue;
    }

    const value = rawValue.trim();
    const baseWeight = getEvidenceBaseWeight(
      scope,
      attributeName,
      element,
      value,
    );

    if (!baseWeight) {
      continue;
    }

    const scopeLabel =
      scope === "target"
        ? "target"
        : scope === "ancestor"
          ? `ancestor +${depth}`
          : "descendant";

    const elementLabel =
      scope === "ancestor" && element.tagName === "FORM"
        ? "form ancestor"
        : scopeLabel;

    const label = `${elementLabel} ${attributeName}=${JSON.stringify(value)}`;

    addEvidence(evidenceByKey, {
      label,
      value,
      scope,
      attributeName,
      patterns: buildEvidencePatterns(attributeName, value, baseWeight, label),
    });
  }
}

function getAncestorElements(targetEl: Element): Element[] {
  const ancestors: Element[] = [];
  let current = targetEl.parentElement;
  let depth = 0;

  while (current && depth < MAX_ANCESTOR_DEPTH) {
    ancestors.push(current);
    current = current.parentElement;
    depth += 1;
  }

  return ancestors;
}

function getDescendantCandidateElements(targetEl: Element): Element[] {
  return Array.from(
    targetEl.querySelectorAll(
      "[id],[class],[data-testid],[data-test],[data-qa],[data-role],[data-action],[data-controller],[aria-controls],[name],[aria-label]",
    ),
  ).slice(0, MAX_DESCENDANT_CANDIDATES);
}

function getEvidencePriority(evidence: SearchEvidence): number {
  return evidence.patterns.reduce(
    (max, pattern) => Math.max(max, pattern.weight),
    0,
  );
}

function buildScriptSearchEvidence(targetEl: Element): SearchEvidence[] {
  const evidenceByKey = new Map<string, SearchEvidence>();

  addElementEvidence(evidenceByKey, targetEl, "target");

  getAncestorElements(targetEl).forEach((element, index) => {
    addElementEvidence(evidenceByKey, element, "ancestor", index + 1);
  });

  for (const element of getDescendantCandidateElements(targetEl)) {
    addElementEvidence(evidenceByKey, element, "descendant");
  }

  return Array.from(evidenceByKey.values())
    .sort(
      (a, b) =>
        getEvidencePriority(b) - getEvidencePriority(a) ||
        a.value.localeCompare(b.value),
    )
    .slice(0, MAX_SEARCH_EVIDENCE);
}

function findOccurrences(
  text: string,
  needle: string,
  maxOccurrences: number,
): number[] {
  if (!needle) {
    return [];
  }

  const indexes: number[] = [];
  let fromIndex = 0;

  while (indexes.length < maxOccurrences) {
    const index = text.indexOf(needle, fromIndex);

    if (index === -1) {
      break;
    }

    indexes.push(index);
    fromIndex = index + Math.max(needle.length, 1);
  }

  return indexes;
}

function collectEvidenceHits(
  content: string,
  evidence: SearchEvidence[],
): EvidenceHit[] {
  const hits: EvidenceHit[] = [];
  const seen = new Set<string>();

  for (const item of evidence) {
    for (const pattern of item.patterns) {
      for (const index of findOccurrences(
        content,
        pattern.text,
        MAX_OCCURRENCES_PER_PATTERN,
      )) {
        const key = `${item.key}:${pattern.kind}:${pattern.text}:${index}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        hits.push({
          evidence: item,
          pattern,
          index,
        });
      }
    }
  }

  return hits.sort(
    (a, b) =>
      b.pattern.weight - a.pattern.weight ||
      a.index - b.index ||
      b.pattern.text.length - a.pattern.text.length,
  );
}

function getFacebookModuleBounds(
  content: string,
  index: number,
): TextBounds | null {
  const previousModuleStart = content.lastIndexOf("\n__d(", index);

  let start = previousModuleStart >= 0 ? previousModuleStart + 1 : -1;

  if (start === -1 && content.startsWith("__d(")) {
    start = 0;
  }

  if (start === -1) {
    return null;
  }

  const nextModuleStart = content.indexOf("\n__d(", index + 1);
  const end = nextModuleStart >= 0 ? nextModuleStart + 1 : content.length;

  if (index < start || index >= end) {
    return null;
  }

  if (end - start > MAX_REGION_LENGTH) {
    return null;
  }

  return { start, end };
}

function getGenericContextBounds(
  content: string,
  index: number,
  matchLength: number,
): TextBounds {
  return {
    start: Math.max(0, index - GENERIC_CONTEXT_RADIUS),
    end: Math.min(content.length, index + matchLength + GENERIC_CONTEXT_RADIUS),
  };
}

function getRelevantRegionBounds(
  content: string,
  hit: EvidenceHit,
): TextBounds {
  return (
    getFacebookModuleBounds(content, hit.index) ??
    getGenericContextBounds(content, hit.index, hit.pattern.text.length)
  );
}

function overlapRatio(a: TextBounds, b: TextBounds): number {
  const overlap = Math.max(
    0,
    Math.min(a.end, b.end) - Math.max(a.start, b.start),
  );

  if (!overlap) {
    return 0;
  }

  return overlap / Math.min(a.end - a.start, b.end - b.start);
}

function getBestPatternMatchInRegion(
  regionText: string,
  evidence: SearchEvidence,
): SearchPattern | null {
  let best: SearchPattern | null = null;

  for (const pattern of evidence.patterns) {
    if (!regionText.includes(pattern.text)) {
      continue;
    }

    if (
      !best ||
      pattern.weight > best.weight ||
      (pattern.weight === best.weight && pattern.text.length > best.text.length)
    ) {
      best = pattern;
    }
  }

  return best;
}

function getEvidenceMatchedInRegion(
  regionText: string,
  evidence: SearchEvidence[],
): MatchedEvidence[] {
  const matches: MatchedEvidence[] = [];

  for (const item of evidence) {
    const pattern = getBestPatternMatchInRegion(regionText, item);

    if (pattern) {
      matches.push({
        evidence: item,
        pattern,
      });
    }
  }

  return matches.sort(
    (a, b) =>
      b.pattern.weight - a.pattern.weight ||
      a.evidence.label.localeCompare(b.evidence.label),
  );
}

function getRegionScore(matchedEvidence: MatchedEvidence[]): number {
  // Only the strongest matching pattern for each piece of DOM evidence counts.
  // This prevents `id:"login_form"` and `id: "login_form"` from double-scoring.
  return matchedEvidence.reduce(
    (total, match) => total + match.pattern.weight,
    0,
  );
}

function hasTargetEvidence(matchedEvidence: MatchedEvidence[]): boolean {
  return matchedEvidence.some((match) => match.evidence.scope === "target");
}

function hasStrongDomEvidence(matchedEvidence: MatchedEvidence[]): boolean {
  return matchedEvidence.some(
    (match) =>
      match.pattern.strong &&
      (match.pattern.kind === "dom-property" ||
        match.pattern.kind === "dom-selector" ||
        match.pattern.kind === "dom-api" ||
        match.pattern.kind === "html-attribute"),
  );
}

function hasStrongTargetEvidence(matchedEvidence: MatchedEvidence[]): boolean {
  return matchedEvidence.some(
    (match) =>
      match.evidence.scope === "target" &&
      match.pattern.strong &&
      (match.pattern.kind === "dom-property" ||
        match.pattern.kind === "dom-selector" ||
        match.pattern.kind === "dom-api" ||
        match.pattern.kind === "html-attribute"),
  );
}

function hasStrongNonClassEvidence(
  matchedEvidence: MatchedEvidence[],
): boolean {
  return matchedEvidence.some(
    (match) =>
      match.evidence.attributeName !== "class" && match.pattern.strong,
  );
}

function shouldKeepRegion(
  matchedEvidence: MatchedEvidence[],
  score: number,
): boolean {
  if (!matchedEvidence.length) {
    return false;
  }

  // An ancestor class frequently identifies a broad layout container and can
  // occur throughout a minified application bundle. It is useful for ranking,
  // but must not qualify a region without target or non-class evidence.
  if (
    hasStrongDomEvidence(matchedEvidence) &&
    (hasStrongTargetEvidence(matchedEvidence) ||
      hasStrongNonClassEvidence(matchedEvidence))
  ) {
    return true;
  }

  if (
    matchedEvidence.length === 1 &&
    matchedEvidence[0].evidence.scope === "target" &&
    matchedEvidence[0].pattern.weight >= 9
  ) {
    return true;
  }

  return (
    matchedEvidence.length >= 2 &&
    score >= MIN_MULTI_EVIDENCE_SCORE &&
    hasTargetEvidence(matchedEvidence)
  );
}

function getRegionConfidence(
  matchedEvidence: MatchedEvidence[],
  score: number,
): "HIGH" | "MEDIUM" {
  const strongCount = matchedEvidence.filter(
    (match) => match.pattern.strong,
  ).length;

  if (
    score >= HIGH_CONFIDENCE_SCORE ||
    strongCount >= 2 ||
    matchedEvidence.some((match) => match.pattern.weight >= 13)
  ) {
    return "HIGH";
  }

  return "MEDIUM";
}

function getModuleName(regionText: string): string | null {
  const facebookModule = regionText.match(/__d\(\s*["']([^"']+)["']\s*,/);

  if (facebookModule?.[1]) {
    return facebookModule[1];
  }

  const namedDefine = regionText.match(/\bdefine\(\s*["']([^"']+)["']\s*,/);

  return namedDefine?.[1] ?? null;
}

function getCandidateRelationship(
  matchedEvidence: MatchedEvidence[],
): AssociationRelationship {
  if (matchedEvidence.some((match) => match.evidence.scope === "target")) {
    return "direct-dom-match";
  }

  if (matchedEvidence.some((match) => match.evidence.scope === "ancestor")) {
    return "ancestor-render-owner";
  }

  if (matchedEvidence.some((match) => match.evidence.scope === "descendant")) {
    return "descendant-render-owner";
  }

  return "associated-module";
}

function getRelationshipPriority(
  relationship: AssociationRelationship,
): number {
  switch (relationship) {
    case "probable-render-owner":
      return 5;
    case "direct-dom-match":
      return 4;
    case "ancestor-render-owner":
      return 3;
    case "descendant-render-owner":
      return 2;
    default:
      return 1;
  }
}

function getModuleDefinitionsFromBlock(block: ScriptBlock): ModuleDefinition[] {
  if (!block.content || block.fetchError) {
    return [];
  }

  const starts: Array<{ name: string; start: number }> = [];
  const patterns = [
    /(?:^|\n)__d\(\s*["']([^"']+)["']\s*,/g,
    /(?:^|\n)define\(\s*["']([^"']+)["']\s*,/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(block.content)) !== null) {
      const rawStart = match.index;
      const start = block.content[rawStart] === "\n" ? rawStart + 1 : rawStart;

      if (match[1]) {
        starts.push({
          name: match[1],
          start,
        });
      }

      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
  }

  starts.sort((a, b) => a.start - b.start);

  return starts
    .map((entry, index): ModuleDefinition | null => {
      const end =
        index + 1 < starts.length
          ? starts[index + 1].start
          : block.content.length;

      if (end <= entry.start || end - entry.start > MAX_REGION_LENGTH) {
        return null;
      }

      const content = block.content.slice(entry.start, end).trim();

      if (!content) {
        return null;
      }

      return {
        name: entry.name,
        block,
        start: entry.start,
        end,
        content,
      };
    })
    .filter((definition): definition is ModuleDefinition =>
      Boolean(definition),
    );
}

function buildModuleIndex(
  blocks: ScriptBlock[],
): Map<string, ModuleDefinition[]> {
  const index = new Map<string, ModuleDefinition[]>();

  for (const block of blocks) {
    for (const definition of getModuleDefinitionsFromBlock(block)) {
      const definitions = index.get(definition.name) ?? [];
      definitions.push(definition);
      index.set(definition.name, definitions);
    }
  }

  return index;
}

function isLikelyComponentModuleName(name: string): boolean {
  return (
    /\.react(?:$|[./])/i.test(name) ||
    /(?:Component|Input|Button|Form|Field|View|Modal|Dialog|Menu|Select|Checkbox|Radio|Switch|TextArea|Textarea|Link|Pressable)$/i.test(
      name,
    )
  );
}

function getRenderedModuleReferences(
  moduleText: string,
): RenderedModuleReference[] {
  const references: RenderedModuleReference[] = [];
  const seen = new Set<string>();

  // Common compiled React shapes:
  //   jsx(r("SomeComponent.react"), {...})
  //   jsxs(n("SomeComponent.react"), {...})
  //   createElement(o("SomeComponent.react"), {...})
  const loaderWrappedRender =
    /\b(?:jsx|jsxs|createElement)\(\s*[A-Za-z_$][\w$]*\(\s*["']([^"']+)["']\s*\)\s*,/g;

  let match: RegExpExecArray | null;

  while ((match = loaderWrappedRender.exec(moduleText)) !== null) {
    const name = match[1];

    if (!name || !isLikelyComponentModuleName(name)) {
      continue;
    }

    const key = `${name}:${match.index}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    references.push({
      name,
      index: match.index,
    });

    if (references.length >= MAX_COMPONENT_REFS_PER_MODULE) {
      break;
    }
  }

  return references;
}

function getTraversedComponentConfidence(
  parent: ScriptRegionCandidate,
  matchedEvidence: MatchedEvidence[],
  score: number,
): "HIGH" | "MEDIUM" {
  if (parent.confidence === "HIGH" && hasTargetEvidence(matchedEvidence)) {
    return "HIGH";
  }

  return getRegionConfidence(matchedEvidence, score);
}

function findRenderedComponentCandidates(
  seedCandidates: ScriptRegionCandidate[],
  evidence: SearchEvidence[],
  moduleIndex: Map<string, ModuleDefinition[]>,
): ScriptRegionCandidate[] {
  const results: ScriptRegionCandidate[] = [];
  const queue = seedCandidates
    .filter(
      (candidate) =>
        candidate.moduleName !== null && candidate.confidence === "HIGH",
    )
    .map((candidate) => ({
      candidate,
      depth: 1,
    }));

  const visitedEdges = new Set<string>();

  while (queue.length) {
    const current = queue.shift();

    if (!current || current.depth > MAX_COMPONENT_TRAVERSAL_DEPTH) {
      continue;
    }

    const parent = current.candidate;

    if (!parent.moduleName) {
      continue;
    }

    for (const reference of getRenderedModuleReferences(parent.content)) {
      const edgeKey = `${parent.moduleName}->${reference.name}`;

      if (visitedEdges.has(edgeKey)) {
        continue;
      }

      visitedEdges.add(edgeKey);

      const definitions = moduleIndex.get(reference.name) ?? [];

      for (const definition of definitions) {
        const matchedEvidence = getEvidenceMatchedInRegion(
          definition.content,
          evidence,
        );
        const baseScore = getRegionScore(matchedEvidence);

        // A traversed child must independently match the selected element.
        // The parent->child render edge is only a confidence boost; it is not
        // enough by itself to include unrelated dependencies.
        if (
          !matchedEvidence.length ||
          !hasTargetEvidence(matchedEvidence) ||
          !shouldKeepRegion(matchedEvidence, baseScore)
        ) {
          continue;
        }

        const score = baseScore + COMPONENT_TRAVERSAL_BONUS;
        const candidate: ScriptRegionCandidate = {
          block: definition.block,
          start: definition.start,
          end: definition.end,
          content: definition.content,
          moduleName: definition.name,
          matchedEvidence,
          score,
          confidence: getTraversedComponentConfidence(
            parent,
            matchedEvidence,
            score,
          ),
          relationship: "probable-render-owner",
          parentModuleName: parent.moduleName,
          traversalDepth: current.depth,
        };

        results.push(candidate);

        if (current.depth < MAX_COMPONENT_TRAVERSAL_DEPTH) {
          queue.push({
            candidate,
            depth: current.depth + 1,
          });
        }
      }
    }
  }

  return results;
}

function mergeCandidates(
  candidates: ScriptRegionCandidate[],
): ScriptRegionCandidate[] {
  const byRegion = new Map<string, ScriptRegionCandidate>();

  for (const candidate of candidates) {
    const sourceKey = candidate.block.src ?? "inline";
    const key = `${sourceKey}:${candidate.start}:${candidate.end}`;
    const existing = byRegion.get(key);

    if (!existing) {
      byRegion.set(key, candidate);
      continue;
    }

    const candidatePriority = getRelationshipPriority(candidate.relationship);
    const existingPriority = getRelationshipPriority(existing.relationship);

    if (
      candidatePriority > existingPriority ||
      (candidatePriority === existingPriority &&
        candidate.score > existing.score)
    ) {
      byRegion.set(key, candidate);
    }
  }

  return Array.from(byRegion.values());
}

function extractCandidateRegions(
  block: ScriptBlock,
  evidence: SearchEvidence[],
): ScriptRegionCandidate[] {
  if (!block.content || block.fetchError) {
    return [];
  }

  const hits = collectEvidenceHits(block.content, evidence);

  if (!hits.length) {
    return [];
  }

  const selectedBounds: TextBounds[] = [];

  for (const hit of hits) {
    const bounds = getRelevantRegionBounds(block.content, hit);

    if (
      selectedBounds.some(
        (existing) =>
          (existing.start === bounds.start && existing.end === bounds.end) ||
          overlapRatio(existing, bounds) >= 0.8,
      )
    ) {
      continue;
    }

    selectedBounds.push(bounds);

    if (selectedBounds.length >= MAX_REGIONS_PER_SCRIPT) {
      break;
    }
  }

  return selectedBounds
    .map((bounds): ScriptRegionCandidate | null => {
      const content = block.content.slice(bounds.start, bounds.end).trim();

      if (!content) {
        return null;
      }

      const matchedEvidence = getEvidenceMatchedInRegion(content, evidence);
      const score = getRegionScore(matchedEvidence);

      if (!shouldKeepRegion(matchedEvidence, score)) {
        return null;
      }

      return {
        block,
        start: bounds.start,
        end: bounds.end,
        content,
        moduleName: getModuleName(content),
        matchedEvidence,
        score,
        confidence: getRegionConfidence(matchedEvidence, score),
        relationship: getCandidateRelationship(matchedEvidence),
      };
    })
    .filter((candidate): candidate is ScriptRegionCandidate =>
      Boolean(candidate),
    );
}

function renderEvidenceComment(candidate: ScriptRegionCandidate): string {
  const evidenceLines = candidate.matchedEvidence.map(
    ({ evidence, pattern }) =>
      ` *   +${pattern.weight} [${pattern.kind}] ${evidence.label}`,
  );

  return [
    "/*",
    ` * Association: ${candidate.confidence}`,
    ` * Score: ${candidate.score}`,
    candidate.moduleName ? ` * Module: ${candidate.moduleName}` : null,
    ` * Relationship: ${candidate.relationship}`,
    candidate.parentModuleName
      ? ` * Rendered by: ${candidate.parentModuleName}`
      : null,
    candidate.traversalDepth
      ? ` * Component depth: ${candidate.traversalDepth}`
      : null,
    " * Evidence:",
    ...evidenceLines,
    " */",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function candidateToScriptBlock(candidate: ScriptRegionCandidate): ScriptBlock {
  const labelParts = [
    `${candidate.confidence} confidence JavaScript association`,
    `relationship: ${candidate.relationship}`,
  ];

  if (candidate.moduleName) {
    labelParts.push(`module: ${candidate.moduleName}`);
  }

  return {
    type: candidate.block.type,
    src: candidate.block.src,
    label: labelParts.join(" · "),
    content: `${renderEvidenceComment(candidate)}\n${candidate.content}`,
  };
}

async function extractElementScripts(
  targetEl: Element,
): Promise<ScriptBlock[]> {
  const directBlocks: ScriptBlock[] = [];
  const seenDirect = new Set<string>();

  const addDirectBlock = (block: ScriptBlock | null): void => {
    if (!block?.content.trim()) {
      return;
    }

    const key = block.src
      ? `src:${block.src}`
      : `inline:${block.type}:${block.content}`;

    if (seenDirect.has(key)) {
      return;
    }

    seenDirect.add(key);
    directBlocks.push(block);
  };

  const nestedScripts = getNestedScripts(targetEl);
  const nestedBlocks = await mapWithConcurrency(
    nestedScripts,
    SCRIPT_FETCH_CONCURRENCY,
    readScriptBlock,
  );

  for (const block of nestedBlocks) {
    if (!block) {
      continue;
    }

    addDirectBlock({
      ...block,
      label: block.src
        ? "Script located inside selected subtree"
        : "Inline script located inside selected subtree",
    });
  }

  const evidence = buildScriptSearchEvidence(targetEl);

  if (!evidence.length) {
    return directBlocks;
  }

  const nestedScriptSet = new Set(nestedScripts);

  const pageScripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>("script"),
  ).filter(
    (script) => !nestedScriptSet.has(script) && isJavascriptScriptType(script),
  );

  const pageBlocks = await mapWithConcurrency(
    pageScripts,
    SCRIPT_FETCH_CONCURRENCY,
    readScriptBlock,
  );

  const readablePageBlocks = pageBlocks.filter((block): block is ScriptBlock =>
    Boolean(block),
  );

  const primaryCandidates = readablePageBlocks.flatMap((block) =>
    extractCandidateRegions(block, evidence),
  );

  const moduleIndex = buildModuleIndex(readablePageBlocks);
  const renderedComponentCandidates = findRenderedComponentCandidates(
    primaryCandidates,
    evidence,
    moduleIndex,
  );

  const candidates = mergeCandidates([
    ...primaryCandidates,
    ...renderedComponentCandidates,
  ]).sort(
    (a, b) =>
      getRelationshipPriority(b.relationship) -
        getRelationshipPriority(a.relationship) ||
      b.score - a.score ||
      Number(hasTargetEvidence(b.matchedEvidence)) -
        Number(hasTargetEvidence(a.matchedEvidence)) ||
      b.matchedEvidence.length - a.matchedEvidence.length ||
      a.content.length - b.content.length,
  );

  const associatedBlocks = candidates
    .slice(0, MAX_SCRIPT_RESULTS)
    .map(candidateToScriptBlock);

  return [...directBlocks, ...associatedBlocks];
}

function combineScripts(scriptBlocks: ScriptBlock[]): string {
  return scriptBlocks
    .map((script) => {
      const header = script.label
        ? `/* ${script.label} */`
        : script.src
          ? `/* Source: ${script.src} */`
          : "/* Inline script */";

      const source = script.src ? `\n/* Source: ${script.src} */` : "";

      return `${header}${source}\n${script.content}`;
    })
    .join("\n\n");
}

/**
 * Extracts JavaScript that can be reasonably associated with the selected
 * element.
 *
 * Important behavior:
 * - bare DOM ids are NEVER searched as plain substrings;
 * - id evidence must appear in DOM-shaped syntax such as:
 *     id:"login_form"
 *     getElementById("login_form")
 *     querySelector("#login_form")
 *     id="login_form"
 * - generic values such as name="email" are also searched structurally;
 * - scoring is based on the strongest pattern for each distinct piece of DOM
 *   evidence, avoiding duplicate score inflation;
 * - matches are scored within a local module/code region instead of across the
 *   entire bundle;
 * - high-confidence modules are inspected for rendered child components;
 * - child component definitions are promoted only when they independently
 *   match the selected element's structural DOM evidence;
 * - relationships distinguish direct matches, probable render owners, and
 *   ancestor render owners;
 * - only medium/high-confidence regions are returned.
 *
 * This analyzes JavaScript delivered to the browser. Recovering original
 * TypeScript/JSX still requires source maps when available.
 */
export async function getSourceMatchingText(el: Element): Promise<string> {
  const selectorPath = getSelectorPath(el);
  const directJavascript = getInlineJavascriptInfo(el);
  const scriptBlocks = await extractElementScripts(el);
  const extractedScripts = combineScripts(scriptBlocks);

  const sections = [directJavascript, extractedScripts].filter((value) =>
    value.trim(),
  );

  if (!sections.length) {
    return [
      "/* No confidently associated JavaScript was found for this element. */",
      `/* Selector path: ${selectorPath} */`,
      "/* Bare page-wide id/name word matches are intentionally ignored. */",
      "/* Framework handlers may be delegated or compiled without stable DOM identifiers. */",
      "/* Original TypeScript/JSX may require source-map support. */",
    ].join("\n");
  }

  return sections.join("\n\n");
}
