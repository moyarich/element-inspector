import { getElementSelector } from "../../../../utils/selectors";
import {
  getFontFaceRulesByFamilies,
  getCssPropertyRulesByNames,
  getKeyframesRulesByNames,
  getMatchingCssRules,
  type CssFontFaceMatch,
  type CssKeyframesMatch,
  type CssRuleMatch,
  type CssPropertyRuleMatch,
} from "./cssRules";
import {
  absolutizeCssUrls,
  extractCssAssetUrls,
} from "./cssUrls";

const IGNORED_ANIMATION_NAMES = new Set([
  "none",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
]);

const COMPUTED_ASSET_PROPERTIES = [
  "background-image",
  "border-image-source",
  "content",
  "cursor",
  "filter",
  "list-style-image",
  "mask-border-source",
  "mask-image",
  "offset-path",
  "shape-outside",
  "-webkit-mask-box-image-source",
  "-webkit-mask-image",
] as const;

const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

type ElementCssMatch = {
  element: Element;
  inlineCss: string;
  rules: CssRuleMatch[];
};

function splitCssDeclarations({ cssText }: { cssText: string }): string[] {
  const declarations: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let parenthesisDepth = 0;

  for (let index = 0; index < cssText.length; index += 1) {
    const character = cssText[index];

    if (quote) {
      current += character;

      if (character === "\\") {
        const nextCharacter = cssText[index + 1];

        if (nextCharacter !== undefined) {
          current += nextCharacter;
          index += 1;
        }
      } else if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "(") {
      parenthesisDepth += 1;
      current += character;
      continue;
    }

    if (character === ")") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      current += character;
      continue;
    }

    if (character === ";" && parenthesisDepth === 0) {
      if (current.trim()) {
        declarations.push(current.trim());
      }

      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    declarations.push(current.trim());
  }

  return declarations;
}

function formatCssProps(cssText: string): string {
  return splitCssDeclarations({ cssText })
    .map((declaration) => `  ${declaration};`)
    .join("\n");
}

function getDeclarationProperty({ declaration }: { declaration: string }): string {
  const colonIndex = declaration.indexOf(":");

  return colonIndex === -1
    ? ""
    : declaration.slice(0, colonIndex).trim().toLowerCase();
}

function addReferencedCustomProperties({
  cssText,
  names,
}: {
  cssText: string;
  names: Set<string>;
}): void {
  const variablePattern = /var\(\s*(--[\w-]+)/g;

  for (const match of cssText.matchAll(variablePattern)) {
    names.add(match[1]);
  }
}

/**
 * Removes framework custom-property initializers that cannot contribute to
 * the selected subtree. Dependencies are followed transitively so composed
 * declarations such as Tailwind shadows and filters remain functional.
 */
function pruneUnusedCustomPropertyDeclarations({
  rules,
  inlineBlocks,
}: {
  rules: CssRuleMatch[];
  inlineBlocks: string[];
}): CssRuleMatch[] {
  const referencedNames = new Set<string>();
  const declarationsByRule = rules.map((rule) =>
    splitCssDeclarations({ cssText: rule.cssText }),
  );

  for (const inlineBlock of inlineBlocks) {
    addReferencedCustomProperties({
      cssText: inlineBlock,
      names: referencedNames,
    });
  }

  for (const declarations of declarationsByRule) {
    for (const declaration of declarations) {
      if (!getDeclarationProperty({ declaration }).startsWith("--")) {
        addReferencedCustomProperties({
          cssText: declaration,
          names: referencedNames,
        });
      }
    }
  }

  let previousSize = -1;

  while (previousSize !== referencedNames.size) {
    previousSize = referencedNames.size;

    for (const declarations of declarationsByRule) {
      for (const declaration of declarations) {
        const property = getDeclarationProperty({ declaration });

        if (!property.startsWith("--") || !referencedNames.has(property)) {
          continue;
        }

        addReferencedCustomProperties({
          cssText: declaration,
          names: referencedNames,
        });
      }
    }
  }

  return rules.map((rule, index) => {
      const declarations = declarationsByRule[index].filter((declaration) => {
        const property = getDeclarationProperty({ declaration });

        return !property.startsWith("--") || referencedNames.has(property);
      });

      return {
        ...rule,
        cssText: declarations.join("; "),
      };
    });
}

export function getInlineCss(el: Element): string {
  const style = el.getAttribute("style");

  if (!style) {
    return "";
  }

  const absoluteStyle = absolutizeCssUrls(
    style,
    el.ownerDocument.baseURI,
  );

  return `${getElementSelector(el)} {\n${formatCssProps(absoluteStyle)}\n}`;
}

function indent(text: string, count: number): string {
  return text
    .split("\n")
    .map((line) => `${" ".repeat(count)}${line}`)
    .join("\n");
}

function renderRuleBody({ rule }: { rule: CssRuleMatch }): string {
  return `${rule.selectorText} {\n${formatCssProps(rule.cssText)}\n}`;
}

type CssRuleEntry = { rule: CssRuleMatch; content: string };

function renderRuleEntriesAtDepth({
  entries,
  depth,
}: {
  entries: CssRuleEntry[];
  depth: number;
}): string {
  const blocks: string[] = [];
  const layerEntriesByPrefix = new Map<string, CssRuleEntry[]>();
  const emittedLayers = new Set<string>();

  for (const entry of entries) {
    const wrapperPrefix = entry.rule.wrapperPrefixes[depth];

    if (!wrapperPrefix || !/^@layer(?:\s|$)/.test(wrapperPrefix)) continue;

    const layerEntries = layerEntriesByPrefix.get(wrapperPrefix) ?? [];
    layerEntries.push(entry);
    layerEntriesByPrefix.set(wrapperPrefix, layerEntries);
  }

  for (let index = 0; index < entries.length; ) {
    const entry = entries[index];
    const wrapperPrefix = entry.rule.wrapperPrefixes[depth];

    if (!wrapperPrefix) {
      blocks.push(entry.content);
      index += 1;
      continue;
    }

    const collectedLayerEntries = layerEntriesByPrefix.get(wrapperPrefix);

    if (collectedLayerEntries) {
      index += 1;

      if (emittedLayers.has(wrapperPrefix)) continue;

      emittedLayers.add(wrapperPrefix);
      blocks.push(
        `${wrapperPrefix} {\n${indent(
          renderRuleEntriesAtDepth({
            entries: collectedLayerEntries,
            depth: depth + 1,
          }),
          2,
        )}\n}`,
      );
      continue;
    }

    const groupedEntries: CssRuleEntry[] = [];

    while (
      index < entries.length &&
      entries[index].rule.wrapperPrefixes[depth] === wrapperPrefix
    ) {
      groupedEntries.push(entries[index]);
      index += 1;
    }

    blocks.push(
      `${wrapperPrefix} {\n${indent(
        renderRuleEntriesAtDepth({ entries: groupedEntries, depth: depth + 1 }),
        2,
      )}\n}`,
    );
  }

  return blocks.join("\n\n");
}

/** Preserves every nested at-rule wrapper around matched style rules. */
function renderRuleEntries({ entries }: { entries: CssRuleEntry[] }): string {
  return renderRuleEntriesAtDepth({ entries, depth: 0 });
}

function renderRuleBlocks({ rules }: { rules: CssRuleMatch[] }): string {
  return renderRuleEntries({
    entries: rules.map((rule) => ({
      rule,
      content: renderRuleBody({ rule }),
    })),
  });
}

function getRuleKey({ rule }: { rule: CssRuleMatch }): string {
  return `${rule.wrapperPrefixes.join("|||")}|||${rule.selectorText}|||${rule.cssText}`;
}

function getUniqueRules({ rules }: { rules: CssRuleMatch[] }): CssRuleMatch[] {
  const ruleMap = new Map<string, CssRuleMatch>();

  for (const rule of rules) {
    const key = getRuleKey({ rule });

    if (!ruleMap.has(key)) {
      ruleMap.set(key, rule);
    }
  }

  // CSSOM traversal already returns stylesheet source order. Keeping that
  // order is essential when equally-specific rules (such as utility classes)
  // rely on the cascade to determine the rendered value.
  return Array.from(ruleMap.values()).sort(
    (first, second) => first.sourceOrder - second.sourceOrder,
  );
}

function renderCssScope({
  elements,
  matchesByElement,
  heading,
}: {
  elements: Element[];
  matchesByElement: Map<Element, ElementCssMatch>;
  heading: string;
}): string {
  const inlineBlocks: string[] = [];
  const associatedRules = new Map<
    string,
    { rule: CssRuleMatch; elements: Element[] }
  >();

  for (const element of elements) {
    const match = matchesByElement.get(element);

    if (!match) {
      continue;
    }

    if (match.inlineCss) {
      inlineBlocks.push(
        `/* Inline: ${getElementSelector(element)} */\n${match.inlineCss}`,
      );
    }

    for (const rule of match.rules) {
      const key = getRuleKey({ rule });
      const associatedRule = associatedRules.get(key);

      if (associatedRule) {
        associatedRule.elements.push(element);
      } else {
        associatedRules.set(key, { rule, elements: [element] });
      }
    }
  }

  const ruleEntries = Array.from(associatedRules.values()).map(
    ({ rule, elements: matchingElements }) => {
      const selectors = matchingElements.map(getElementSelector);
      const visibleSelectors = selectors.slice(0, 8);
      const remainingCount = selectors.length - visibleSelectors.length;
      const matchList = [
        ...visibleSelectors.map((selector) => `   - ${selector}`),
        ...(remainingCount > 0
          ? [`   - …and ${remainingCount} more descendant(s)`]
          : []),
      ].join("\n");

      return {
        rule,
        content: `/* Matches:\n${matchList}\n*/\n${renderRuleBody({ rule })}`,
      };
    },
  );
  const renderedRules = renderRuleEntries({ entries: ruleEntries });

  const blocks = [
    `/* ${heading} */`,
    ...inlineBlocks,
    renderedRules,
  ];

  if (!inlineBlocks.length && !ruleEntries.length) {
    blocks.push("/* No accessible inline or matched stylesheet rules. */");
  }

  return blocks.join("\n\n");
}

function renderWrappedAtRule(
  cssText: string,
  wrapperPrefixes: string[],
): string {
  return wrapperPrefixes.reduceRight(
    (block, wrapperPrefix) =>
      `${wrapperPrefix} {\n${indent(block, 2)}\n}`,
    cssText,
  );
}

function renderKeyframesBlock(rule: CssKeyframesMatch): string {
  return renderWrappedAtRule(rule.cssText, rule.wrapperPrefixes);
}

function renderFontFaceBlock(rule: CssFontFaceMatch): string {
  return renderWrappedAtRule(rule.cssText, rule.wrapperPrefixes);
}

function renderPropertyBlock(rule: CssPropertyRuleMatch): string {
  return renderWrappedAtRule(rule.cssText, rule.wrapperPrefixes);
}

function splitCssList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      current += character;

      if (character === "\\") {
        const nextCharacter = value[index + 1];

        if (nextCharacter !== undefined) {
          current += nextCharacter;
          index += 1;
        }

        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ")") {
      depth = Math.max(0, depth - 1);
      current += character;
      continue;
    }

    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function normalizeQuotedIdentifier(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function addAnimationNamesFromValue(
  value: string | null | undefined,
  names: Set<string>,
): void {
  if (!value) {
    return;
  }

  for (const rawName of splitCssList(value)) {
    const name = normalizeQuotedIdentifier(rawName);
    const lowerName = name.toLowerCase();

    if (
      !name ||
      IGNORED_ANIMATION_NAMES.has(lowerName) ||
      lowerName.startsWith("var(")
    ) {
      continue;
    }

    names.add(name);
  }
}

function addAnimationNamesFromStyleText(
  styleText: string | null | undefined,
  names: Set<string>,
): void {
  if (!styleText) {
    return;
  }

  const declaration = document.createElement("div").style;
  declaration.cssText = styleText;

  addAnimationNamesFromValue(declaration.animationName, names);
  addAnimationNamesFromValue(
    declaration.getPropertyValue("-webkit-animation-name"),
    names,
  );
}

function addAnimationNamesFromComputedStyle(
  style: CSSStyleDeclaration,
  names: Set<string>,
): void {
  addAnimationNamesFromValue(style.animationName, names);
  addAnimationNamesFromValue(
    style.getPropertyValue("-webkit-animation-name"),
    names,
  );
}

function addFontFamiliesFromValue(
  value: string | null | undefined,
  families: Set<string>,
): void {
  if (!value) {
    return;
  }

  for (const rawFamily of splitCssList(value)) {
    const family = normalizeQuotedIdentifier(rawFamily).toLowerCase();

    if (!family || GENERIC_FONT_FAMILIES.has(family)) {
      continue;
    }

    families.add(family);
  }
}

function collectAssetUrlsFromStyle(
  style: CSSStyleDeclaration,
  baseUrl: string,
  assetUrls: Set<string>,
): void {
  for (const property of COMPUTED_ASSET_PROPERTIES) {
    const value = style.getPropertyValue(property);

    if (!value || !/url\s*\(/i.test(value)) {
      continue;
    }

    const absoluteValue = absolutizeCssUrls(value, baseUrl);

    for (const assetUrl of extractCssAssetUrls(absoluteValue)) {
      assetUrls.add(assetUrl);
    }
  }

  // Custom properties may carry URL tokens used by another declaration.
  for (const property of Array.from(style)) {
    if (!property.startsWith("--")) {
      continue;
    }

    const value = style.getPropertyValue(property);

    if (!value || !/url\s*\(/i.test(value)) {
      continue;
    }

    const absoluteValue = absolutizeCssUrls(value, baseUrl);

    for (const assetUrl of extractCssAssetUrls(absoluteValue)) {
      assetUrls.add(assetUrl);
    }
  }
}

function collectElementStyleDependencies(
  element: Element,
  animationNames: Set<string>,
  fontFamilies: Set<string>,
  computedAssetUrls: Set<string>,
): void {
  addAnimationNamesFromStyleText(
    element.getAttribute("style"),
    animationNames,
  );

  const computed = window.getComputedStyle(element);
  addAnimationNamesFromComputedStyle(computed, animationNames);
  addFontFamiliesFromValue(computed.fontFamily, fontFamilies);
  collectAssetUrlsFromStyle(
    computed,
    element.ownerDocument.baseURI,
    computedAssetUrls,
  );

  for (const pseudoElement of ["::before", "::after"]) {
    try {
      const pseudoStyle = window.getComputedStyle(element, pseudoElement);
      addAnimationNamesFromComputedStyle(pseudoStyle, animationNames);
      addFontFamiliesFromValue(pseudoStyle.fontFamily, fontFamilies);
      collectAssetUrlsFromStyle(
        pseudoStyle,
        element.ownerDocument.baseURI,
        computedAssetUrls,
      );
    } catch {
      // Some document contexts do not expose pseudo-element computed styles.
    }
  }
}

function renderAssetManifest(assetUrls: string[]): string {
  if (!assetUrls.length) {
    return "";
  }

  return [
    `/* Resolved CSS asset URLs (${assetUrls.length})`,
    ...assetUrls.map((url, index) => `   ${index + 1}. ${url}`),
    "*/",
  ].join("\n");
}

function getReferencedCustomPropertyNames({
  cssText,
}: {
  cssText: string;
}): Set<string> {
  const names = new Set<string>();
  addReferencedCustomProperties({ cssText, names });

  return names;
}

/**
 * Collects portable CSS for the selected element and its descendants. The
 * readable result preserves rule ownership, while the preview result removes
 * duplicate and unused framework infrastructure.
 */
export function getCssBundle(rootEl: Element): {
  cssText: string;
  previewCssText: string;
  assetUrls: string[];
} {
  const descendantElements = Array.from(rootEl.querySelectorAll("*"));
  const targetElements = [rootEl, ...descendantElements];

  const matchesByElement = new Map<Element, ElementCssMatch>();
  const targetRules: CssRuleMatch[] = [];
  const animationNames = new Set<string>();
  const fontFamilies = new Set<string>();
  const computedAssetUrls = new Set<string>();

  for (const el of targetElements) {
    const inlineCss = getInlineCss(el);
    const rules = getUniqueRules({ rules: getMatchingCssRules(el) });

    matchesByElement.set(el, { element: el, inlineCss, rules });
    targetRules.push(...rules);

    collectElementStyleDependencies(
      el,
      animationNames,
      fontFamilies,
      computedAssetUrls,
    );

    for (const rule of rules) {
      addAnimationNamesFromStyleText(rule.cssText, animationNames);
    }
  }

  const uniqueRules = getUniqueRules({ rules: targetRules });
  const inlineBlocks = targetElements
    .map((element) => matchesByElement.get(element)?.inlineCss ?? "")
    .filter(Boolean);
  const prunedRules = pruneUnusedCustomPropertyDeclarations({
    rules: uniqueRules,
    inlineBlocks,
  });
  const prunedRulesByOriginalKey = new Map(
    uniqueRules.map((rule, index) => [
      getRuleKey({ rule }),
      prunedRules[index],
    ]),
  );
  const rules = prunedRules.filter((rule) => rule.cssText);

  for (const match of matchesByElement.values()) {
    match.rules = match.rules
      .map((rule) => prunedRulesByOriginalKey.get(getRuleKey({ rule })))
      .filter((rule): rule is CssRuleMatch => Boolean(rule?.cssText));
  }

  const keyframesRules = getKeyframesRulesByNames(
    animationNames,
    rootEl.ownerDocument,
  );

  const fontFaceRules = getFontFaceRulesByFamilies(
    fontFamilies,
    rootEl.ownerDocument,
  );

  const renderedRules = renderRuleBlocks({ rules });
  const renderedKeyframes = keyframesRules
    .map(renderKeyframesBlock)
    .join("\n\n");
  const renderedFontFaces = fontFaceRules
    .map(renderFontFaceBlock)
    .join("\n\n");
  const cssBeforePropertyRules = [
    renderedFontFaces,
    inlineBlocks.join("\n"),
    renderedRules,
    renderedKeyframes,
  ]
    .filter(Boolean)
    .join("\n");
  const propertyRules = getCssPropertyRulesByNames(
    getReferencedCustomPropertyNames({ cssText: cssBeforePropertyRules }),
    rootEl.ownerDocument,
  );
  const renderedProperties = propertyRules
    .map(renderPropertyBlock)
    .join("\n\n");

  const previewCssText = [
    renderedFontFaces,
    renderedProperties,
    inlineBlocks.join("\n"),
    renderedRules,
    renderedKeyframes,
  ]
    .filter(Boolean)
    .join("\n");

  const assetUrls = Array.from(
    new Set([
      ...extractCssAssetUrls(previewCssText),
      ...computedAssetUrls,
    ]),
  ).sort();
  const sections: string[] = [];
  const assetManifest = renderAssetManifest(assetUrls);

  if (assetManifest) {
    sections.push(assetManifest);
  }

  if (fontFaceRules.length) {
    sections.push(
      "/* Referenced font-face rules with absolute src URLs */",
      renderedFontFaces,
    );
  }

  sections.push(
    renderCssScope({
      elements: [rootEl],
      matchesByElement,
      heading: `Selected container: ${getElementSelector(rootEl)}`,
    }),
  );

  if (descendantElements.length) {
    sections.push(
      renderCssScope({
        elements: descendantElements,
        matchesByElement,
        heading: `Descendant elements (${descendantElements.length})`,
      }),
    );
  }

  if (keyframesRules.length) {
    sections.push(
      `/* Referenced animation keyframes: ${Array.from(animationNames)
        .sort()
        .join(", ")} */`,
      renderedKeyframes,
    );
  } else if (animationNames.size) {
    sections.push(
      `/* Animation names were detected, but their @keyframes rules were not accessible: ${Array.from(
        animationNames,
      )
        .sort()
        .join(", ")} */`,
    );
  }

  sections.push(
    "/* Relative url(...) references were resolved against each owning stylesheet. */",
    "/* Cross-origin stylesheet contents can still be blocked by the browser CSSOM. */",
  );

  return {
    cssText: sections.join("\n\n"),
    previewCssText,
    assetUrls,
  };
}
